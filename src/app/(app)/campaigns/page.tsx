import { and, asc, count, desc, eq, gte, ilike, lte, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { campaign, channel, contact, contactField, contactTag, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { relTime, stamp } from "@/lib/format";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { templateConfig } from "@/lib/whatsapp/templates";
import { BUILT_IN_FIELDS } from "@/lib/automation/vars";
import type { FieldOption } from "@/app/(app)/templates/types";
import { CampaignComposer, type CampaignDraft } from "./CampaignComposer";
import { CampaignRowActions, DueSendButton } from "./CampaignRowActions";
import { listCampaignTemplates } from "./actions";
import { audienceLabel, unpackSpec, type CampaignStats } from "./spec";

// The approved-template list is remote state that changes on Meta's side, and
// the recipient counts change whenever anyone edits a contact. Neither may be
// served from a cache on the page whose whole job is to tell an operator what a
// send will really do.
export const dynamic = "force-dynamic";

/** Campaign history rows rendered — newest first. */
const CAMPAIGN_HISTORY_LIMIT = 200;

// Status → token colour. Campaign.status is free-form text (no enum) so the
// known lifecycle values are mapped and anything else falls back to neutral.
const STATUS_COLOR: Record<string, string> = {
  draft: "var(--color-faint)",
  scheduled: "var(--color-warning)",
  sending: "var(--color-accent)",
  completed: "var(--color-success)",
  sent: "var(--color-success)",
  failed: "var(--color-danger)",
};

/** …and the same lifecycle in words an operator would use. */
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending now",
  completed: "Sent",
  sent: "Sent",
  failed: "Did not send",
};

/**
 * Per-campaign read and reply counts are not recorded anywhere, so these columns
 * are a constant dash and the footnote under the table says why.
 *
 * WhatsApp reports delivery and read receipts against an individual message id;
 * no column links a message row back to the campaign that sent it. A zero would
 * be an invented figure dressed up as a measurement, which is worse than an
 * empty column. Wiring it up needs `message.campaign_id` — see the report.
 */
const NOT_RECORDED = "—";

/** A stored UTC instant as Malaysian wall clock, for <input type="datetime-local">. */
function toMalaysianInput(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/** `?q=` / `?from=` / `?to=` may arrive repeated; take the first. */
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const th = "px-4 py-3 font-medium";
const td = "px-4 py-3";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const sp = await searchParams;

  const q = one(sp.q).trim();
  const from = one(sp.from);
  const to = one(sp.to);
  const editId = one(sp.edit);

  const filters = [eq(campaign.companyId, me.companyId)];
  if (q) filters.push(ilike(campaign.name, `%${q}%`));
  if (from) filters.push(gte(campaign.createdAt, new Date(`${from}T00:00:00+08:00`)));
  if (to) filters.push(lte(campaign.createdAt, new Date(`${to}T23:59:59+08:00`)));

  const [campaigns, due, channels, tagOpts, fields, templates] = await Promise.all([
    db.query.campaign.findMany({
      where: and(...filters),
      orderBy: desc(campaign.createdAt),
      limit: CAMPAIGN_HISTORY_LIMIT,
    }),
    // Scheduled campaigns whose time has passed. "Has it passed" is a question
    // about the clock, and a component must not ask the clock while rendering,
    // so Postgres answers it — which is also the right clock, since it is the
    // one `schedule_at` was written against.
    db.query.campaign.findMany({
      where: and(
        eq(campaign.companyId, me.companyId),
        eq(campaign.status, "scheduled"),
        lte(campaign.scheduleAt, sql`now()`)
      ),
      orderBy: asc(campaign.scheduleAt),
    }),
    db.query.channel.findMany({
      where: eq(channel.companyId, me.companyId),
      orderBy: desc(channel.isDefault),
    }),
    // Reachable count per tag, in Postgres rather than by loading every link row
    // into the Worker. The blocked / opted-out filter is in the JOIN, not the
    // WHERE, so a tag whose contacts are all excluded still lists — at zero,
    // which is the honest answer rather than a missing row.
    db
      .select({ name: tag.name, color: tag.color, count: count(contact.id) })
      .from(tag)
      .leftJoin(contactTag, eq(contactTag.tagId, tag.id))
      .leftJoin(
        contact,
        and(
          eq(contact.id, contactTag.contactId),
          eq(contact.blocked, false),
          eq(contact.marketingOptIn, true)
        )
      )
      .where(eq(tag.companyId, me.companyId))
      .groupBy(tag.id, tag.name, tag.color)
      .orderBy(asc(tag.name)),
    db.query.contactField.findMany({
      where: eq(contactField.companyId, me.companyId),
      orderBy: asc(contactField.key),
    }),
    listCampaignTemplates(),
  ]);

  const channelName = new Map(channels.map((c) => [c.id, c.displayName]));

  // The placeholder dropdowns offer the same two groups the Templates page
  // offers, from the same source of truth — built-ins every contact has, then
  // this company's configured contact fields.
  const attributeFields: FieldOption[] = fields.map((f) => ({ key: f.key, name: f.name }));
  const fieldOptions: FieldOption[] = [
    ...BUILT_IN_FIELDS.map((f) => ({ ...f, builtin: true })),
    ...attributeFields,
  ];

  // Editing target, if any. Fetched on its own rather than picked out of the
  // filtered list — a search or date filter must not silently swallow the row
  // the URL says to edit. A campaign that has already been sent is not editable;
  // the wizard opens fresh and the row offers Duplicate instead.
  let initial: CampaignDraft | null = null;
  if (editId) {
    const row = await db.query.campaign.findFirst({
      where: and(eq(campaign.id, editId), eq(campaign.companyId, me.companyId)),
    });
    const spec = row ? unpackSpec(row.audience) : null;
    if (row && spec && (row.status === "draft" || row.status === "scheduled")) {
      initial = {
        id: row.id,
        name: row.name,
        channelId: row.channelId,
        spec,
        scheduleAt: toMalaysianInput(row.scheduleAt),
      };
    }
  }

  return (
    <PageChrome title="Campaigns" subtitle="One-time WhatsApp broadcasts">
      <div className="p-6">
        {due.length > 0 && (
          <div
            className="mb-4 rounded-xl border p-4"
            style={{
              borderColor: "color-mix(in srgb, var(--color-warning) 40%, transparent)",
              background: "var(--color-warning-soft)",
            }}
          >
            <h3 className="mb-2 text-[13px] font-semibold text-[var(--color-ink)]">
              {due.length} scheduled {due.length === 1 ? "campaign is" : "campaigns are"} due
            </h3>
            <p className="mb-3 text-[11.5px] leading-relaxed text-[var(--color-muted)]">
              Nothing sends these on a timer — this Worker has no scheduled trigger. They wait here
              until someone reviews and sends them.
            </p>
            <div className="flex flex-col gap-3">
              {due.map((c) => (
                <DueSendButton key={c.id} id={c.id} name={c.name} />
              ))}
            </div>
          </div>
        )}

        {editId && !initial && (
          <p className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
            That campaign cannot be opened for editing. Either it has already been sent — a sent
            campaign is the record of what customers received, so duplicate it instead — or it was
            created before this page stored the message, in which case there is nothing to load.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          {/* Keyed so switching between "new" and a specific campaign builds a
              fresh wizard: the step, the bindings and the review all live in
              state that useState initialisers set once. */}
          <CampaignComposer
            key={initial?.id ?? "new"}
            channels={channels.map((c) => ({
              id: c.id,
              displayName: c.displayName,
              phone: c.phone,
              isDefault: c.isDefault,
            }))}
            tags={tagOpts}
            fields={fieldOptions}
            attributeFields={attributeFields}
            templates={templates}
            templatesConfigured={!!templateConfig()}
            live={isLive()}
            initial={initial}
          />

          <div className="min-w-0">
            {/* Search + date range, as a plain GET form: the result is a real
                URL, so it is refreshable, linkable, and survives the revalidate
                after a delete or a duplicate. */}
            <form method="get" action="/campaigns" className="mb-3 flex flex-wrap items-end gap-2">
              <div>
                <label
                  htmlFor="campaign-search"
                  className="mb-1 block text-[11px] text-[var(--color-muted)]"
                >
                  Search
                </label>
                <input
                  id="campaign-search"
                  name="q"
                  defaultValue={q}
                  placeholder="Campaign name"
                  className="w-[200px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label htmlFor="from" className="mb-1 block text-[11px] text-[var(--color-muted)]">
                  From
                </label>
                <input
                  id="from"
                  type="date"
                  name="from"
                  defaultValue={from}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <div>
                <label htmlFor="to" className="mb-1 block text-[11px] text-[var(--color-muted)]">
                  To
                </label>
                <input
                  id="to"
                  type="date"
                  name="to"
                  defaultValue={to}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
              </div>
              <button className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white">
                Filter
              </button>
              {(q || from || to) && (
                <Link
                  href="/campaigns"
                  className="px-1 pb-1.5 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  Clear
                </Link>
              )}
            </form>

            <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <table className="w-full min-w-[1080px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                    <th className={th}>Campaign</th>
                    <th className={th}>Channel</th>
                    <th className={th}>Sent to</th>
                    <th className={th}>People</th>
                    <th className={th}>Messages sent</th>
                    <th className={th}>Read</th>
                    <th className={th}>Wrote back</th>
                    <th className={th}>Schedule</th>
                    <th className={th}>Started</th>
                    <th className={th}>Ended</th>
                    <th className={th}>Status</th>
                    <th className={th}>Approval</th>
                    <th className={`${th} text-right`}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.length === 0 && (
                    <tr>
                      <td colSpan={13} className="px-4 py-8 text-center text-[var(--color-faint)]">
                        {q || from || to
                          ? "No campaigns match that filter."
                          : "No campaigns yet. Build one on the left."}
                      </td>
                    </tr>
                  )}
                  {campaigns.map((c) => {
                    const stats = (c.stats as CampaignStats | null) ?? {};
                    const color = STATUS_COLOR[c.status] ?? "var(--color-muted)";
                    const editable = c.status === "draft" || c.status === "scheduled";
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-[var(--color-border)] last:border-0"
                      >
                        <td className={`${td} font-medium text-[var(--color-ink)]`}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {c.name}
                            {!c.scheduleAt && (
                              <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--color-faint)]">
                                Immediately
                              </span>
                            )}
                          </div>
                          {c.templateName && (
                            <span className="font-code text-[10px] text-[var(--color-faint)]">
                              {c.templateName}
                            </span>
                          )}
                          {stats.error && (
                            <span className="mt-0.5 block text-[11px] font-normal text-[var(--color-danger)]">
                              {stats.error}
                            </span>
                          )}
                          {!!stats.failed && (
                            <span className="mt-0.5 block text-[11px] font-normal text-[var(--color-danger)]">
                              {stats.failed} refused by WhatsApp
                            </span>
                          )}
                          {!!stats.skippedBlocked && (
                            <span className="mt-0.5 block text-[11px] font-normal text-[var(--color-faint)]">
                              {stats.skippedBlocked} skipped — blocked
                            </span>
                          )}
                          {!!stats.skippedOptedOut && (
                            <span className="mt-0.5 block text-[11px] font-normal text-[var(--color-faint)]">
                              {stats.skippedOptedOut} skipped — they asked not to receive marketing
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-[var(--color-muted)]`}>
                          {channelName.get(c.channelId) ?? "—"}
                        </td>
                        <td className={`${td} text-[var(--color-muted)]`}>
                          {audienceLabel(c.audience)}
                        </td>
                        <td className={`${td} font-mono text-[var(--color-muted)]`}>
                          {stats.total ?? "—"}
                        </td>
                        <td className={`${td} font-mono text-[var(--color-ink)]`}>
                          {stats.sent ?? "—"}
                        </td>
                        <td className={`${td} text-[var(--color-faint)]`}>{NOT_RECORDED}</td>
                        <td className={`${td} text-[var(--color-faint)]`}>{NOT_RECORDED}</td>
                        <td className={`${td} text-[var(--color-faint)]`}>
                          {c.scheduleAt ? stamp(c.scheduleAt) : "Immediately"}
                        </td>
                        <td className={`${td} text-[var(--color-faint)]`}>
                          {stats.startedAt ? stamp(new Date(stats.startedAt)) : "—"}
                        </td>
                        <td className={`${td} text-[var(--color-faint)]`}>
                          {stats.finishedAt ? stamp(new Date(stats.finishedAt)) : "—"}
                        </td>
                        <td className={td}>
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              background: `color-mix(in srgb, ${color} 12%, transparent)`,
                              color,
                            }}
                          >
                            {STATUS_LABEL[c.status] ?? c.status}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] text-[var(--color-faint)]">
                            {relTime(c.createdAt)}
                          </span>
                        </td>
                        <td className={`${td} text-[var(--color-faint)]`}>
                          {c.requiresApproval
                            ? c.approvedByMemberId
                              ? "Approved"
                              : "Waiting"
                            : "Not required"}
                        </td>
                        <td className={td}>
                          <CampaignRowActions
                            id={c.id}
                            name={c.name}
                            editable={editable}
                            scheduled={c.status === "scheduled"}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {campaigns.length > 0 && (
                <p className="border-t border-[var(--color-border)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
                  Read and Wrote back are always a dash: WhatsApp reports read receipts and replies
                  against an individual message, and nothing links a message back to the campaign
                  that sent it, so there is no figure here that would be true. System Logs shows the
                  delivery status of every message. People counts everyone the audience matched;
                  Messages sent counts the ones WhatsApp accepted.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageChrome>
  );
}
