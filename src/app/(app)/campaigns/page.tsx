import { and, asc, count, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { campaign, contact, contactTag, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { IconSearch } from "@/components/icons";
import { getCurrentMember } from "@/lib/current-member";
import { campaignCounts } from "@/lib/campaign-messages";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { resolveAudience } from "./audience";
import { unpackSpec, type CampaignStats } from "./spec";
import { CampaignRowMenu } from "./CampaignRowMenu";
import { DueBanner } from "./DueBanner";
import { RangePicker } from "./RangePicker";
import { CampIcon, StatusBadge, campStatus, whenLabel, type CampStatus } from "./ui";

// Recipient counts change whenever anyone edits a contact, and "due" is a
// question about the clock — never serve this page from a cache.
export const dynamic = "force-dynamic";

/** Campaign history rows rendered — newest first. */
const CAMPAIGN_HISTORY_LIMIT = 200;

/** `?q=` / `?from=` / `?to=` may arrive repeated; take the first. */
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const MANAGERS = new Set(["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER"]);

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const sp = await searchParams;
  const t = await getDict();
  const L = t.camp;

  const q = one(sp.q).trim();
  const from = one(sp.from);
  const to = one(sp.to);
  const statusFilter = one(sp.status);

  const filters = [eq(campaign.companyId, me.companyId)];
  if (q) filters.push(ilike(campaign.name, `%${q}%`));
  if (from) filters.push(gte(campaign.createdAt, new Date(`${from}T00:00:00+08:00`)));
  if (to) filters.push(lte(campaign.createdAt, new Date(`${to}T23:59:59+08:00`)));

  const [rows, tagCounts, [reachable]] = await Promise.all([
    db
      .select({
        id: campaign.id,
        name: campaign.name,
        templateName: campaign.templateName,
        audience: campaign.audience,
        status: campaign.status,
        scheduleAt: campaign.scheduleAt,
        stats: campaign.stats,
        requiresApproval: campaign.requiresApproval,
        approvedByMemberId: campaign.approvedByMemberId,
        createdAt: campaign.createdAt,
        // "Has its time passed" is a clock question; Postgres answers it, on
        // the same clock `schedule_at` was written against.
        isDue: sql<boolean>`(${campaign.status} = 'scheduled' and ${campaign.scheduleAt} <= now())`,
      })
      .from(campaign)
      .where(and(...filters))
      .orderBy(desc(campaign.createdAt))
      .limit(CAMPAIGN_HISTORY_LIMIT),
    // Reachable people per tag, with the same exclusions the send applies.
    db
      .select({ name: tag.name, color: tag.color, n: count(contact.id) })
      .from(tag)
      .leftJoin(contactTag, eq(contactTag.tagId, tag.id))
      .leftJoin(
        contact,
        and(eq(contact.id, contactTag.contactId), eq(contact.blocked, false), eq(contact.marketingOptIn, true))
      )
      .where(eq(tag.companyId, me.companyId))
      .groupBy(tag.id, tag.name, tag.color)
      .orderBy(asc(tag.name)),
    db
      .select({ n: count() })
      .from(contact)
      .where(and(eq(contact.companyId, me.companyId), eq(contact.blocked, false), eq(contact.marketingOptIn, true))),
  ]);

  const tagBy = new Map(tagCounts.map((r) => [r.name, r]));
  const counts = await campaignCounts(rows.map((r) => r.id));

  type Row = (typeof rows)[number] & { s: CampStatus; waiting: boolean };
  const all: Row[] = rows.map((r) => {
    const s = campStatus(r.status, !!r.isDue);
    const open = s === "draft" || s === "scheduled" || s === "due";
    return { ...r, s, waiting: open && r.requiresApproval && !r.approvedByMemberId };
  });

  const n = (k: CampStatus) => all.filter((r) => r.s === k).length;
  const shown = all.filter((r) => {
    if (!statusFilter) return true;
    if (statusFilter === "approval") return r.waiting;
    if (statusFilter === "sent") return r.s === "sent" || r.s === "sending";
    return r.s === statusFilter;
  });
  const due = all.filter((r) => r.s === "due");

  // Who each row reaches. Sent rows say who they matched at send time; unsent
  // rows are counted now. An attribute audience has no SQL shortcut, so it runs
  // the real resolver — only for the few unsent rows on screen.
  const attrCounts = new Map<string, number>();
  await Promise.all(
    shown
      .filter((r) => r.s !== "sent" && r.s !== "failed" && r.s !== "sending")
      .map(async (r) => {
        const spec = unpackSpec(r.audience);
        if (spec?.audience.kind === "attribute") {
          const res = await resolveAudience(db, me.companyId, spec.audience);
          attrCounts.set(r.id, res.recipients.length);
        }
      })
  );

  const audienceOf = (r: Row) => {
    const spec = unpackSpec(r.audience);
    const stats = (r.stats as CampaignStats | null) ?? {};
    const a = spec?.audience;
    let label = L.everyone;
    let dot: string | null = null;
    let people: number | null = reachable?.n ?? null;
    if (a?.kind === "tag" && a.tag) {
      const tg = tagBy.get(a.tag);
      label = fmt(L.tagAud, { tag: a.tag });
      dot = tg?.color ?? "var(--color-border-strong)";
      people = tg?.n ?? 0;
    } else if (a?.kind === "attribute" && a.attrKey) {
      label = a.attrValue ? `${a.attrKey} = ${a.attrValue}` : a.attrKey;
      people = attrCounts.get(r.id) ?? null;
    } else if (!spec) {
      // Rows from before the composer stored a spec carry only a label.
      const legacy = (r.audience ?? {}) as { kind?: string; value?: string };
      if (legacy.kind === "tag" && legacy.value) label = fmt(L.tagAud, { tag: legacy.value });
    }
    if (r.s === "sent" || r.s === "failed" || r.s === "sending") people = stats.total ?? people;
    return { label, dot, people };
  };

  const canApprove = MANAGERS.has(me.role);
  const cols = "grid-cols-[minmax(0,2.3fr)_minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_36px]";

  return (
    <>
      <SecondaryMenu
        title={t.nav.campaigns}
        groups={[
          {
            title: L.status,
            items: [
              { href: "?", label: L.all, count: all.length },
              { href: "?status=draft", label: L.draft, count: n("draft"), dot: "var(--color-border-strong)" },
              { href: "?status=scheduled", label: L.scheduled, count: n("scheduled"), dot: "var(--color-pastel-orange-ink)" },
              { href: "?status=due", label: L.due, count: n("due"), dot: "var(--color-danger)" },
              { href: "?status=sent", label: L.sent, count: n("sent") + n("sending"), dot: "var(--color-success)" },
              { href: "?status=failed", label: L.failed, count: n("failed"), dot: "var(--color-danger)" },
            ],
          },
          {
            title: L.approval,
            items: [{ href: "?status=approval", label: L.waiting, count: all.filter((r) => r.waiting).length }],
          },
        ]}
      />
      <PageChrome
        section="campaigns"
        page="allCampaigns"
        actions={
          <Link
            href="/campaigns/new"
            className="flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
          >
            <span className="text-[16px] leading-none">+</span>
            {L.newCampaign}
          </Link>
        }
      >
        <div className="flex flex-col gap-3.5 p-4 md:p-6">
          {due.length > 0 && (
            <DueBanner
              items={due.map((d) => ({ id: d.id, name: d.name, when: whenLabel(d.scheduleAt), waiting: d.waiting }))}
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <form className="flex h-[36px] w-full max-w-[300px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-accent)]">
              {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
              {from && <input type="hidden" name="from" value={from} />}
              {to && <input type="hidden" name="to" value={to} />}
              <IconSearch width={15} height={15} className="text-[var(--color-faint)]" />
              <input
                name="q"
                defaultValue={q}
                placeholder={L.search}
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]"
              />
            </form>
            <RangePicker from={from} to={to} />
          </div>

          <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="min-w-[980px]">
              <div
                className={`grid ${cols} gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]`}
              >
                <span>{L.colCampaign}</span>
                <span>{L.colAudience}</span>
                <span>{L.colResult}</span>
                <span>{L.colWhen}</span>
                <span>{L.colStatus}</span>
                <span />
              </div>

              {shown.length === 0 && (
                <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  {all.length && (q || from || to || statusFilter) ? L.noMatch : L.none}
                </p>
              )}

              {shown.map((r, i) => {
                const stats = (r.stats as CampaignStats | null) ?? {};
                const aud = audienceOf(r);
                const c = counts.get(r.id);
                const sentState = r.s === "sent" || r.s === "sending" || r.s === "failed";
                const editable = r.s === "draft" || r.s === "scheduled" || r.s === "due";
                const href = editable ? `/campaigns/new?edit=${r.id}` : `/campaigns/${r.id}`;
                return (
                  <div
                    key={r.id}
                    className={`grid ${cols} items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5 last:border-b-0 hover:bg-[var(--color-surface-2)]`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CampIcon seed={i} />
                      <div className="min-w-0">
                        <Link
                          href={href}
                          className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)] hover:underline"
                        >
                          {r.name}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                          <span className="rounded-[4px] border border-[var(--color-border)] px-1.5 py-px text-[11px] text-[var(--color-faint)]">
                            {r.templateName || "—"}
                          </span>
                          {!!stats.failed && (
                            <span className="text-[var(--color-danger)]">{fmt(L.refused, { n: stats.failed })}</span>
                          )}
                          {stats.error && <span className="text-[var(--color-danger)]">{stats.error}</span>}
                          {!!stats.skippedOptedOut && (
                            <span className="text-[var(--color-faint)]">
                              {fmt(L.skippedOpt, { n: stats.skippedOptedOut })}
                            </span>
                          )}
                          {!!stats.skippedBlocked && (
                            <span className="text-[var(--color-faint)]">
                              {fmt(L.skippedBlocked, { n: stats.skippedBlocked })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate text-[12.5px] text-[var(--color-ink)]">
                        {aud.dot && (
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: aud.dot }} />
                        )}
                        <span className="truncate">{aud.label}</span>
                      </div>
                      <div className="text-[11.5px] text-[var(--color-faint)]">
                        {aud.people == null ? "—" : fmt(L.people, { n: aud.people.toLocaleString("en-US") })}
                      </div>
                    </div>

                    <div className="min-w-0">
                      {!sentState ? (
                        <span className="text-[12px] text-[var(--color-faint)]">{L.notSent}</span>
                      ) : c && c.sent > 0 ? (
                        <ResultBar sent={c.sent} read={c.read} replied={c.replied} total={Math.max(c.total, 1)} L={L} />
                      ) : (
                        <span className="text-[12px] text-[var(--color-muted)]">
                          {fmt(L.nSent, { n: stats.sent ?? 0 })}
                        </span>
                      )}
                    </div>

                    <div className="leading-tight">
                      <div className="text-[12.5px] text-[var(--color-ink)]">
                        {sentState
                          ? whenLabel(stats.startedAt) || "—"
                          : r.scheduleAt
                            ? whenLabel(r.scheduleAt)
                            : "—"}
                      </div>
                      {(sentState ? !!stats.startedAt : !!r.scheduleAt) && (
                        <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">
                          {sentState ? L.startedL : L.scheduled}
                        </div>
                      )}
                    </div>

                    <div className="leading-tight">
                      <StatusBadge s={r.s} L={L} />
                      {r.requiresApproval && (
                        <div
                          className={`mt-1 text-[11px] ${
                            r.approvedByMemberId ? "text-[var(--color-faint)]" : "text-[var(--color-warning)]"
                          }`}
                        >
                          {r.approvedByMemberId ? L.approved : L.waiting}
                        </div>
                      )}
                    </div>

                    <CampaignRowMenu
                      id={r.id}
                      name={r.name}
                      editable={editable}
                      scheduled={r.s === "scheduled" || r.s === "due"}
                      canApprove={canApprove && r.waiting}
                    />
                  </div>
                );
              })}

              {shown.length > 0 && (
                <div className="flex flex-wrap items-center gap-4 border-t border-[var(--color-border)] px-4 py-2.5 text-[11.5px] text-[var(--color-muted)]">
                  <Legend color="#a9c1f5" label={L.sentL} />
                  <Legend color="var(--color-pastel-blue-ink)" label={L.readL} />
                  <Legend color="var(--color-pastel-purple-ink)" label={L.repliedL} />
                  <span className="ml-auto text-[11px] text-[var(--color-faint)]">{L.legendNote}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </PageChrome>
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function ResultBar({
  sent,
  read,
  replied,
  total,
  L,
}: {
  sent: number;
  read: number;
  replied: number;
  total: number;
  L: { sentL: string; readL: string; repliedL: string };
}) {
  const pct = (v: number) => `${Math.min(100, (v / total) * 100)}%`;
  return (
    <div className="max-w-[262px]">
      <div className="relative h-[6px] overflow-hidden rounded-full bg-[var(--color-surface-dim)]">
        <span className="absolute inset-y-0 left-0 bg-[#a9c1f5]" style={{ width: pct(sent) }} />
        <span className="absolute inset-y-0 left-0 bg-[var(--color-pastel-blue-ink)]" style={{ width: pct(read) }} />
        <span className="absolute inset-y-0 left-0 bg-[var(--color-pastel-purple-ink)]" style={{ width: pct(replied) }} />
      </div>
      <div className="mt-1.5 flex gap-3 text-[11.5px] text-[var(--color-muted)]">
        <span>
          <b className="font-semibold text-[var(--color-ink)]">{sent}</b> {L.sentL}
        </span>
        <span>
          <b className="font-semibold text-[var(--color-ink)]">{read}</b> {L.readL}
        </span>
        <span>
          <b className="font-semibold text-[var(--color-ink)]">{replied}</b> {L.repliedL}
        </span>
      </div>
    </div>
  );
}
