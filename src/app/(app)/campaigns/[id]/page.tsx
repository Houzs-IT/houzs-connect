import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaign, channel, member } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { campaignCounts, campaignErrors, campaignMessages } from "@/lib/campaign-messages";
import { formatPhone } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { humanDuration } from "@/app/(app)/dashboard/util";
import { duplicateCampaign } from "../actions";
import { PhonePreview } from "../PhonePreview";
import { unpackSpec, type CampaignStats } from "../spec";
import { Megaphone, StatusBadge, campStatus } from "../ui";
import { MessagesTab } from "./MessagesTab";

export const dynamic = "force-dynamic";

const TZ = "Asia/Kuala_Lumpur";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const me = await getCurrentMember();
  if (!me) return null;
  const { id } = await params;
  const { tab } = await searchParams;
  const db = getDb();
  const row = await db.query.campaign.findFirst({
    where: and(eq(campaign.id, id), eq(campaign.companyId, me.companyId)),
  });
  if (!row) notFound();

  const t = await getDict();
  const L = t.camp;
  const [ch, approver, countsMap, msgs, errors] = await Promise.all([
    db.query.channel.findFirst({ where: eq(channel.id, row.channelId) }),
    row.approvedByMemberId
      ? db.query.member.findFirst({ where: eq(member.id, row.approvedByMemberId) })
      : Promise.resolve(null),
    campaignCounts([row.id]),
    campaignMessages(row.id),
    campaignErrors(row.id),
  ]);

  const stats = (row.stats as CampaignStats | null) ?? {};
  const c = countsMap.get(row.id);
  const spec = unpackSpec(row.audience);
  // Per-message figures when the messages were linked to this campaign; the
  // totals stored on the campaign otherwise.
  const total = c?.total ?? (stats.sent ?? 0) + (stats.failed ?? 0);
  const sent = c?.sent ?? stats.sent ?? 0;
  const failed = c?.failed ?? stats.failed ?? 0;
  const pending = c?.pending ?? 0;
  const delivered = c?.delivered ?? 0;
  const read = c?.read ?? 0;
  const single = Math.max(0, sent - delivered - read);
  const replied = c?.replied ?? null;
  const s = campStatus(row.status, false);
  const statusLabel = s === "sent" ? L.completed : undefined;
  const pct = (v: number, of: number) => (of ? `${((v / of) * 100).toFixed(2)}%` : "0.00%");

  const created = row.createdAt;
  const dateStr = created
    .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ })
    .replace("Sept", "Sep");
  const timeStr = created.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ });
  const onMessages = tab === "messages";

  const kpis: { label: string; value: string; tone: string; href?: string }[] = [
    { label: L.totalMessages, value: total.toLocaleString("en-US"), tone: "blue", href: "?tab=messages" },
    { label: L.totalSent, value: sent.toLocaleString("en-US"), tone: "green", href: "?tab=messages&f=sent" },
    { label: L.readCard, value: c ? read.toLocaleString("en-US") : "—", tone: "orange", href: "?tab=messages&f=read" },
    { label: L.responses, value: replied == null ? "—" : String(replied), tone: "purple", href: "?tab=messages&f=replied" },
    { label: L.responseRate, value: replied == null || !sent ? "—" : pct(replied, sent), tone: "pink" },
    {
      label: L.avgResponse,
      value: c?.avgReplySec == null ? "—" : humanDuration(c.avgReplySec),
      tone: "cyan",
    },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <nav className="flex min-w-0 items-center gap-2 text-[13px]">
          <Link href="/campaigns" className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            {t.nav.campaigns}
          </Link>
          <span className="text-[var(--color-faint)]">/</span>
          <span className="truncate font-semibold text-[var(--color-ink)]">{row.name}</span>
          <StatusBadge s={s} L={L} label={statusLabel} />
        </nav>

        <div className="mx-auto flex rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
          {[
            [L.general, "", false],
            [L.messages, "?tab=messages", true],
          ].map(([label, href, isMsg]) => {
            const on = (isMsg as boolean) === onMessages;
            return (
              <Link
                key={label as string}
                href={`/campaigns/${row.id}${href}`}
                className={`flex h-[30px] items-center gap-1.5 rounded-[7px] px-3.5 text-[13px] font-semibold ${
                  on ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,23,34,0.08)]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {label as string}
                {isMsg && (
                  <span className="rounded-full bg-[var(--color-surface-dim)] px-1.5 text-[10.5px] text-[var(--color-muted)]">
                    {msgs.length}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <form action={duplicateCampaign}>
            <input type="hidden" name="id" value={row.id} />
            <button className="flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
              {L.duplicate}
            </button>
          </form>
          <a
            href={`/campaigns/${row.id}/export`}
            className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            {L.download}
          </a>
        </div>
      </header>

      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 md:p-4">
        {onMessages ? (
          <MessagesTab
            rows={msgs.map((m) => ({
              id: m.id,
              conversationId: m.conversationId,
              name: m.contactName,
              phone: m.phone,
              status: m.status,
              body: m.body,
              at: m.createdAt.toISOString(),
              replied: m.replied,
            }))}
            channelName={ch?.displayName ?? ""}
            legacy={!c}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {!c && (
              <p className="rounded-[10px] bg-[var(--color-surface)] px-4 py-2.5 text-[12.5px] text-[var(--color-faint)]">
                {L.noPerMessage}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {kpis.map((k) => (
                <Kpi key={k.label} {...k} />
              ))}
            </div>

            <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{L.perf}</h2>
                <div className="flex gap-3 text-[11.5px] text-[var(--color-muted)]">
                  <Dot c="var(--color-accent)" l={L.sent} />
                  <Dot c="#d8a85a" l={L.pending} />
                  <Dot c="var(--color-danger)" l={L.failedL} />
                </div>
              </div>
              <div className="flex h-[12px] gap-[3px] overflow-hidden rounded-full">
                {[
                  [sent, "repeating-linear-gradient(135deg,#1e6f80 0 6px,#2a8698 6px 12px)"],
                  [pending, "#d8a85a"],
                  [failed, "var(--color-danger)"],
                ].map(([v, bg], i) =>
                  (v as number) > 0 ? (
                    <span key={i} className="rounded-full" style={{ flex: v as number, background: bg as string }} />
                  ) : null
                )}
                {total === 0 && <span className="flex-1 rounded-full bg-[var(--color-surface-dim)]" />}
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <PerfTile icon="↗" tone="accent" label={L.sent} v={sent} p={pct(sent, total)} />
                <PerfTile icon="◷" tone="orange" label={L.pending} v={pending} p={pct(pending, total)} />
                <PerfTile icon="!" tone="danger" label={L.failedL} v={failed} p={pct(failed, total)} />
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[330px_300px_1fr]">
              <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{L.readStatus}</h2>
                <Gauge value={sent ? read / sent : 0} label={L.readRate} />
                <div className="flex flex-col gap-2">
                  <ReadRow c="#c3c9d3" l={L.single} v={single} p={pct(single, sent)} />
                  <ReadRow c="var(--color-pastel-green-ink)" l={L.double} v={delivered} p={pct(delivered, sent)} />
                  <ReadRow c="var(--color-pastel-blue-ink)" l={L.blue} v={read} p={pct(read, sent)} />
                </div>
              </section>

              <PhonePreview
                className="h-[568px]"
                bizName={ch?.displayName ?? "Houzs Century"}
                dayLabel={L.today}
                text={spec?.templateBody || null}
                empty="—"
              />

              <section className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-center gap-3 border-b border-[var(--color-border)] pb-3">
                  <span className="grid h-8 w-8 place-items-center rounded-[8px] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                    <Megaphone size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--color-ink)]">{row.name}</span>
                  <StatusBadge s={s} L={L} label={statusLabel} />
                </div>
                <dl className="mt-4 grid gap-x-6 gap-y-5 md:grid-cols-2">
                  <Info tone="blue" icon="user" k={L.totalContacts} v={String(stats.total ?? total)} />
                  <Info
                    tone="green"
                    icon="check"
                    k={L.approvalL}
                    v={
                      row.requiresApproval
                        ? approver
                          ? `${L.approved} · ${approver.name}`
                          : s === "draft" || s === "scheduled" || s === "due"
                            ? L.waiting
                            : "—"
                        : L.notRequired
                    }
                  />
                  <Info tone="orange" icon="cal" k={L.createdDate} v={dateStr} />
                  <Info tone="purple" icon="clock" k={L.createdTime} v={timeStr} />
                  <Info
                    tone="pink"
                    icon="send"
                    k={L.sentFrom}
                    v={ch ? `${ch.displayName} · ${formatPhone(ch.phone)}` : "—"}
                    wide
                  />
                  <Info
                    tone="cyan"
                    icon="doc"
                    k={L.templateL}
                    v={row.templateName ? `${row.templateName}${spec?.templateLang ? ` (${spec.templateLang})` : ""}` : "—"}
                    wide
                  />
                </dl>
              </section>
            </div>

            <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="grid grid-cols-[1fr_160px_160px_40px] gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">
                <span>{L.reason}</span>
                <span>{L.nMessages}</span>
                <span>{L.errorPct}</span>
                <span />
              </div>
              {errors.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] text-[var(--color-faint)]">
                  {failed > 0 ? fmt(L.refused, { n: failed }) : L.noErrors}
                </p>
              ) : (
                errors.map((e) => (
                  <div key={`${e.reason}-${e.code}`} className="grid grid-cols-[1fr_160px_160px_40px] items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-0">
                    <span className="flex items-center gap-2.5 text-[13px] text-[var(--color-ink)]">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-[var(--color-danger-soft)] text-[11px] font-bold text-[var(--color-danger)]">!</span>
                      {e.reason}
                      {e.code && ` (${e.code})`}
                    </span>
                    <span className="text-[13px] tabular-nums text-[var(--color-ink)]">{e.count}</span>
                    <span className="text-[13px] tabular-nums text-[var(--color-ink)]">{pct(e.count, failed)}</span>
                    <Link href={`/campaigns/${row.id}?tab=messages&f=failed`} aria-label="View" className="text-[var(--color-accent)]">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </Link>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

const TONES: Record<string, [string, string]> = {
  blue: ["var(--color-pastel-blue)", "var(--color-pastel-blue-ink)"],
  green: ["var(--color-pastel-green)", "var(--color-pastel-green-ink)"],
  orange: ["var(--color-pastel-orange)", "var(--color-pastel-orange-ink)"],
  purple: ["var(--color-pastel-purple)", "var(--color-pastel-purple-ink)"],
  pink: ["var(--color-pastel-pink)", "var(--color-pastel-pink-ink)"],
  cyan: ["var(--color-pastel-cyan)", "var(--color-pastel-cyan-ink)"],
};

const KPI_ICON: Record<string, React.ReactNode> = {
  blue: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  green: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  orange: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  purple: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  pink: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  cyan: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};

function Kpi({ label, value, tone, href }: { label: string; value: string; tone: string; href?: string }) {
  const [bg, ink] = TONES[tone];
  return (
    <div
      className="relative rounded-[12px] border border-[var(--color-border)] px-3.5 py-3.5"
      style={{ background: `linear-gradient(135deg,#ffffff 42%, ${bg})` }}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]" style={{ background: bg, color: ink }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {KPI_ICON[tone]}
          </svg>
        </span>
        <div className="min-w-0">
          <div className="truncate text-[11.5px] text-[var(--color-muted)]">{label}</div>
          <div className="text-[20px] font-medium tabular-nums text-[var(--color-ink)]">{value}</div>
        </div>
      </div>
      {href && (
        <Link
          href={href}
          aria-label={label}
          className="absolute bottom-2.5 right-2.5 grid h-6 w-6 place-items-center rounded-full bg-white text-[11px] text-[var(--color-accent)] shadow-[0_1px_3px_rgba(17,23,34,0.12)]"
        >
          ↗
        </Link>
      )}
    </div>
  );
}

function Dot({ c, l }: { c: string; l: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-[2px]" style={{ background: c }} />
      {l}
    </span>
  );
}

function PerfTile({ icon, tone, label, v, p }: { icon: string; tone: "accent" | "orange" | "danger"; label: string; v: number; p: string }) {
  const [bg, ink, chip] =
    tone === "accent"
      ? ["var(--color-accent-soft)", "var(--color-accent)", "var(--color-accent-soft)"]
      : tone === "orange"
        ? ["var(--color-pastel-orange)", "var(--color-pastel-orange-ink)", "#f6efd9"]
        : ["var(--color-danger-soft)", "var(--color-danger)", "var(--color-danger-soft)"];
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-[var(--color-border)] px-3 py-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-[8px] text-[13px] font-bold" style={{ background: bg, color: ink }}>
        {icon}
      </span>
      <span className="flex-1 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">{label}</span>
      <span className="text-[18px] tabular-nums text-[var(--color-ink)]">{v}</span>
      <span className="rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums" style={{ background: chip, color: ink }}>
        {p}
      </span>
    </div>
  );
}

/** Half-circle gauge: green start, blue arc to `value`. */
function Gauge({ value, label }: { value: number; label: string }) {
  const r = 90;
  const len = Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative mx-auto my-4 w-[220px]">
      <svg viewBox="0 0 220 124" className="w-full" aria-hidden>
        <path d="M20 112 A90 90 0 0 1 200 112" fill="none" stroke="var(--color-surface-dim)" strokeWidth="14" strokeLinecap="round" />
        <path
          d="M20 112 A90 90 0 0 1 200 112"
          fill="none"
          stroke="var(--color-pastel-green-ink)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${Math.min(v, 0.18) * len} ${len}`}
        />
        {v > 0.18 && (
          <path
            d="M20 112 A90 90 0 0 1 200 112"
            fill="none"
            stroke="var(--color-pastel-blue-ink)"
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(v - 0.18) * len} ${len}`}
            strokeDashoffset={-0.18 * len}
          />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-[34px] font-semibold leading-none text-[var(--color-ink)]">{Math.round(v * 100)}%</div>
        <div className="mt-1 text-[11.5px] text-[var(--color-faint)]">{label}</div>
      </div>
    </div>
  );
}

function ReadRow({ c, l, v, p }: { c: string; l: string; v: number; p: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--color-border)] px-3 py-2.5">
      <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: c }} />
      <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">{l}</span>
      <span className="text-[14px] tabular-nums text-[var(--color-ink)]">{v}</span>
      <span className="w-[54px] text-right text-[11.5px] tabular-nums text-[var(--color-faint)]">{p}</span>
    </div>
  );
}

const INFO_ICON: Record<string, React.ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  check: <path d="M5 12l5 5 9-10" />,
  cal: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  send: <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />,
  doc: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
};

function Info({ tone, icon, k, v, wide }: { tone: string; icon: string; k: string; v: string; wide?: boolean }) {
  const [bg, ink] = TONES[tone];
  return (
    <div className={`flex items-start gap-3 ${wide ? "md:col-span-2" : ""}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full" style={{ background: bg, color: ink }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {INFO_ICON[icon]}
        </svg>
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{k}</dt>
        <dd className="mt-0.5 break-words text-[14px] text-[var(--color-ink)]">{v}</dd>
      </div>
    </div>
  );
}
