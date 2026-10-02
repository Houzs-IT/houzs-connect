import { asc, desc, eq } from "drizzle-orm";
import { PageChrome } from "@/components/PageChrome";
import { getDb } from "@/db/client";
import { contact as contactTable, contactField } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { attrs } from "@/lib/format";
import { BUILT_IN_FIELDS, templateBindingGaps } from "@/lib/automation/vars";
import {
  ANALYTICS_DAYS,
  editBlockedReason,
  fetchTemplateAnalytics,
  templateConfig,
  type TemplateAnalytics,
  type TemplateStatus,
} from "@/lib/whatsapp/templates";
import {
  bindingKey,
  loadTemplateBindings,
  type StoredBinding,
} from "@/lib/whatsapp/templateBindings";
import { TemplateComposer } from "./TemplateComposer";
import { TemplateRow } from "./TemplateRow";
import { StarterSetButton } from "./StarterSetButton";
import {
  AnalyticsIncompleteNote,
  AnalyticsRefusalBanner,
  DeliveryStat,
} from "./TemplateInsights";
import { fetchTemplates, syncTemplates, removeTemplate } from "./actions";
import type { FieldOption, SampleContact, TemplateRowData } from "./types";

// Live, never cached — a template's status changes on Meta's side, not ours.
export const dynamic = "force-dynamic";

/**
 * A real contact to preview templates against: the one with the most attributes
 * filled in, so the preview exercises as many bindings as possible.
 *
 * Real, not invented. A preview built from made-up values would prove nothing
 * about whether the mapping points at fields this company's contacts actually
 * carry — which is the whole question being answered here.
 */
function pickSample(
  rows: {
    name: string | null;
    phone: string;
    email: string | null;
    source: string | null;
    sourceId: string | null;
    sourceUrl: string | null;
    attributes: unknown;
  }[]
): SampleContact | null {
  let best: SampleContact | null = null;
  let bestCount = -1;
  for (const r of rows) {
    const a = attrs(r.attributes);
    const count = Object.values(a).filter((v) => v != null && String(v).trim() !== "").length;
    if (count > bestCount) {
      bestCount = count;
      best = {
        label: r.name?.trim() || r.phone,
        name: r.name,
        phone: r.phone,
        email: r.email,
        source: r.source,
        sourceId: r.sourceId,
        sourceUrl: r.sourceUrl,
        attributes: a,
      };
    }
  }
  return best;
}

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await getCurrentMember();
  const { configured, templates: allTemplates, error } = await fetchTemplates();

  // Filters, matching Seampify's Category / Language / Status row. They matter
  // at scale, not here: the WABA this replaces carries 64 templates, and an
  // unfiltered list of those is unusable when you are looking for the one that
  // is still PENDING. Filtering happens over the list Meta already returned —
  // the Graph call fetches everything in one page, so there is nothing to gain
  // from pushing predicates to Meta and a round trip to lose.
  const sp = await searchParams;
  const fCat = one(sp.category);
  const fLang = one(sp.language);
  const fStatus = one(sp.status);
  const fQuery = one(sp.q).trim().toLowerCase();

  const categories = [...new Set(allTemplates.map((t) => t.category))].sort();
  const languages = [...new Set(allTemplates.map((t) => t.language))].sort();
  const statuses = [...new Set(allTemplates.map((t) => t.status))].sort();

  const templates = allTemplates.filter(
    (t) =>
      (!fCat || t.category === fCat) &&
      (!fLang || t.language === fLang) &&
      (!fStatus || t.status === fStatus) &&
      (!fQuery ||
        t.name.toLowerCase().includes(fQuery) ||
        (t.body ?? "").toLowerCase().includes(fQuery))
  );
  const filtered = templates.length !== allTemplates.length;

  /**
   * Delivered / read counts, asked for only for the templates on screen.
   *
   * Started here and awaited below so the round trip to Meta overlaps the
   * database reads instead of queueing behind them — this is a second Graph
   * call on a page that already makes one, and it batches ten templates at a
   * time, so on a 64-template WABA it is seven requests.
   *
   * Not started at all when the list itself failed: asking for counts of
   * templates we could not read would only produce a second error saying the
   * same thing.
   */
  const analyticsCfg = me && configured && !error ? templateConfig() : null;
  const analyticsPromise: Promise<TemplateAnalytics> | null = analyticsCfg
    ? fetchTemplateAnalytics(
        analyticsCfg,
        templates.map((t) => t.id)
      )
    : null;

  // Everything a {{n}} can point at, a contact to preview with, and the
  // mappings already saved — all scoped to the signed-in member's company.
  const builtins: FieldOption[] = BUILT_IN_FIELDS.map((f) => ({ ...f, builtin: true }));
  let fields: FieldOption[] = builtins;
  let sample: SampleContact | null = null;
  let saved = new Map<string, StoredBinding>();
  let bindingError: string | null = null;

  if (me) {
    // Degraded, not dead: listing and submitting templates only needs Meta.
    // loadTemplateBindings self-applies its DDL (deploys land before
    // migrations here), and DDL is the one thing that can fail while ordinary
    // reads succeed — so a failure must not take the whole page down with it.
    try {
      const db = getDb();
      const [custom, contacts, stored] = await Promise.all([
        db.query.contactField.findMany({
          where: eq(contactField.companyId, me.companyId),
          orderBy: asc(contactField.name),
        }),
        db.query.contact.findMany({
          where: eq(contactTable.companyId, me.companyId),
          orderBy: desc(contactTable.updatedAt),
          limit: 25,
        }),
        loadTemplateBindings(me.companyId),
      ]);
      fields = [...builtins, ...custom.map((f) => ({ key: f.key, name: f.name }))];
      sample = pickSample(contacts);
      saved = stored;
    } catch (e) {
      bindingError = e instanceof Error ? e.message : String(e);
    }
  }

  const analytics = analyticsPromise ? await analyticsPromise : null;

  const rows: TemplateRowData[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    body: t.body,
    header: t.header,
    footer: t.footer,
    buttons: t.buttons,
    mediaHeader: t.mediaHeader,
    rejectedReason: t.rejectedReason,
    bindings: saved.get(bindingKey(t.name, t.language))?.bindings ?? [],
    editBlocked: editBlockedReason(t.status as TemplateStatus),
  }));

  // The same check the send path runs, so the banner and a refused campaign
  // can never disagree about whether a template is ready.
  const unmapped = rows.filter((r) => templateBindingGaps(r.body, r.bindings).length > 0);

  return (
    <PageChrome section="templates" page="templates">
      <div className="grid gap-6 p-6 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-4">
          <TemplateComposer fields={fields} sample={sample} />
          <StarterSetButton />
        </div>

        <div className="min-w-0">
          {!configured && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">
                WhatsApp is not connected yet
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
                Set <code className="font-mono text-[12px]">WHATSAPP_WABA_ID</code> and{" "}
                <code className="font-mono text-[12px]">WHATSAPP_TOKEN</code> as Worker secrets,
                then reload this page. Until then templates cannot be listed or submitted, and no
                business-initiated message can be sent.
              </p>
            </div>
          )}

          {configured && error && (
            <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-4 text-[13px] text-[var(--color-danger)]">
              Could not read templates from Meta: {error}
            </div>
          )}

          {bindingError && (
            <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-4 text-[13px] leading-relaxed text-[var(--color-danger)]">
              Could not read the variable mappings or contact fields from the database, so the
              mappings below are shown as empty and previews are unavailable. Templates
              themselves are unaffected. Error: {bindingError}
            </div>
          )}

          {configured && !error && !bindingError && unmapped.length > 0 && (
            <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-4">
              <h3 className="text-[13px] font-semibold text-[var(--color-danger)]">
                {unmapped.length} template{unmapped.length === 1 ? " has" : "s have"} no variable
                mapping
              </h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-danger)]">
                A template variable is a numbered slot — {"{{1}}"}, {"{{2}}"} — and the number
                says nothing about where its value comes from. Until each one is pointed at a
                contact field, a campaign using this template is refused rather than delivering a
                dash in every slot. Press Variables on{" "}
                <span className="font-mono">{unmapped.map((r) => r.name).join(", ")}</span> to set
                them.
              </p>
            </div>
          )}

          {/* Never a silent zero: when Meta will not give the counts, the list
              says so once, here, in Meta's own words plus a reading of them. */}
          {analytics?.refusal && (
            <AnalyticsRefusalBanner refusal={analytics.refusal} days={analytics.days} />
          )}
          {analytics?.incomplete && <AnalyticsIncompleteNote note={analytics.incomplete} />}

          {configured && !error && (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                  {filtered
                    ? `${templates.length} of ${allTemplates.length} templates`
                    : `${templates.length} template${templates.length === 1 ? "" : "s"} on this WhatsApp account`}
                </span>
                <div className="flex items-center gap-3">
                  {filtered && (
                    <a
                      href="/templates"
                      className="rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--color-accent-ink)] hover:underline"
                    >
                      Clear filters
                    </a>
                  )}
                  {!sample && (
                    <span className="text-[11px] text-[var(--color-faint)]">
                      No contacts yet — previews show the raw variables
                    </span>
                  )}
                  {/* Meta approves a template on its side and tells us nothing.
                      Asking again is the only way to find out, so give the
                      operator the button rather than "reload and hope". */}
                  <form action={syncTemplates}>
                    <button
                      type="submit"
                      title="Ask Meta for the current status of every template"
                      className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                      ↻ Synchronise with Meta
                    </button>
                  </form>
                </div>
              </div>

              {/* A plain GET form: the filters live in the URL, so a filtered
                  view is linkable and survives a reload — and no client state
                  can disagree with what the list actually shows. */}
              <form
                method="get"
                className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5"
              >
                <input
                  name="q"
                  defaultValue={fQuery}
                  placeholder="Search name or wording…"
                  className="min-w-[180px] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
                <select
                  name="category"
                  defaultValue={fCat}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--color-ink)]"
                >
                  <option value="">Any category</option>
                  {categories.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <select
                  name="language"
                  defaultValue={fLang}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--color-ink)]"
                >
                  <option value="">Any language</option>
                  {languages.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <select
                  name="status"
                  defaultValue={fStatus}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--color-ink)]"
                >
                  <option value="">Any status</option>
                  {statuses.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white"
                >
                  Filter
                </button>
              </form>

              {templates.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  {filtered
                    ? "No template matches those filters."
                    : "No templates yet. Submit one on the left, or import the starter set."}
                </div>
              )}

              <ul>
                {rows.map((t) => (
                  <TemplateRow key={t.id} template={t} fields={fields} sample={sample}>
                    <form action={removeTemplate}>
                      <input type="hidden" name="name" value={t.name} />
                      <button className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">
                        Delete
                      </button>
                    </form>
                    {/* Last, so the buttons stay grouped and the counts read as
                        the trailing metric they are — Seampify's "Message
                        delivered" and "Message read rate" columns. */}
                    <DeliveryStat
                      stats={analytics?.stats.get(t.id)}
                      days={analytics?.days ?? ANALYTICS_DAYS}
                    />
                  </TemplateRow>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </PageChrome>
  );
}
