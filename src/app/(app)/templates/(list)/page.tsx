import { getDb } from "@/db/client";
import { headerKey, storedHeaders } from "@/lib/whatsapp/templateMedia";
import Link from "next/link";
import { PageChrome } from "@/components/PageChrome";
import { FilterPill } from "@/components/shell/FilterPill";
import { IconSearch } from "@/components/icons";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { isBound, positionalSlots } from "@/lib/automation/vars";
import {
  ANALYTICS_DAYS,
  editBlockedReason,
  fetchTemplateAnalytics,
  readRate,
  templateConfig,
  type TemplateStatus,
} from "@/lib/whatsapp/templates";
import { bindingKey } from "@/lib/whatsapp/templateBindings";
import { loadBindings, loadFieldsAndSample, loadTemplateList, needsMapping } from "../data";
import { StarterSetButton } from "../StarterSetButton";
import { TemplateSide } from "../TemplateSide";
import { AnalyticsIncompleteNote, AnalyticsRefusalBanner } from "../TemplateInsights";
import type { TemplateRowData } from "../types";

// Live, never cached — a template's status changes on Meta's side, not ours.
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const CAT_TONE: Record<string, string> = {
  UTILITY: "bg-[var(--color-pastel-blue)] text-[var(--color-pastel-blue-ink)]",
  MARKETING: "bg-[var(--color-pastel-pink)] text-[var(--color-pastel-pink-ink)]",
  AUTHENTICATION: "bg-[var(--color-pastel-purple)] text-[var(--color-pastel-purple-ink)]",
};
const STATUS_TONE: Record<string, string> = {
  APPROVED: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  PENDING: "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]",
  REJECTED: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  PAUSED: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  DISABLED: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
};
const ICON_TONES = ["blue", "green", "orange", "purple", "pink", "cyan"];

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.tf;
  const sp = await searchParams;
  const fCat = one(sp.category);
  const fLang = one(sp.language);
  const fStatus = one(sp.status);
  const fMap = one(sp.mapping);
  const tool = one(sp.tool);
  const q = one(sp.q).trim().toLowerCase();

  const [{ configured, templates: all, error }, bindings, { fields, sample }] = await Promise.all([
    loadTemplateList(),
    loadBindings(me.companyId),
    loadFieldsAndSample(me.companyId),
  ]);

  const templates = all.filter(
    (x) =>
      (!fCat || x.category === fCat) &&
      (!fLang || x.language === fLang) &&
      (!fStatus || x.status === fStatus) &&
      (fMap !== "missing" || needsMapping(x, bindings.map)) &&
      (!q || x.name.toLowerCase().includes(q) || (x.body ?? "").toLowerCase().includes(q))
  );

  // Delivered / read counts, asked for only for the templates on screen.
  const cfg = configured && !error ? templateConfig() : null;
  const analytics = cfg ? await fetchTemplateAnalytics(cfg, templates.map((x) => x.id)) : null;
  const days = analytics?.days ?? ANALYTICS_DAYS;

  // The image / PDF each media-header template is sent with.
  const headers = await storedHeaders(getDb());
  const rows: TemplateRowData[] = templates.map((x) => ({
    id: x.id,
    name: x.name,
    language: x.language,
    category: x.category,
    status: x.status,
    body: x.body,
    header: x.header,
    footer: x.footer,
    buttons: x.buttons,
    mediaHeader: x.mediaHeader,
    headerFormat: x.headerFormat,
    headerFile: (() => {
      const f = headers.get(headerKey(x.name, x.language));
      return f ? { url: `/api/template-media/${f.id}?v=${f.updatedAt.getTime()}`, fileName: f.fileName, format: f.format } : null;
    })(),
    rejectedReason: x.rejectedReason,
    bindings: bindings.map.get(bindingKey(x.name, x.language))?.bindings ?? [],
    editBlocked: editBlockedReason(x.status as TemplateStatus),
  }));
  const unmapped = all.filter((x) => needsMapping(x, bindings.map));
  const selectedId = one(sp.t) || rows[0]?.id || "";
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const selStats = selected ? analytics?.stats.get(selected.id) : undefined;

  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ category: fCat, language: fLang, status: fStatus, mapping: fMap, q, ...extra })) {
      if (v) p.set(k, v);
    }
    return `/templates${p.size ? `?${p}` : ""}`;
  };

  const opts = (vals: string[], labels?: Record<string, string>) =>
    [...new Set(vals)].sort().map((v) => ({ value: v, label: labels?.[v] ?? v }));
  const cols = "grid-cols-[minmax(0,2.3fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)]";

  return (
    <PageChrome
      section="templates"
      page="templates"
      crumbs={[]}
      actions={
        <>
          <Link
            href="/templates?tool=sync"
            className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            <span aria-hidden>↻</span>
            {L.sync}
          </Link>
          <Link
            href="/templates/new"
            className="flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
          >
            <span className="text-[16px] leading-none">+</span>
            {L.newTemplate}
          </Link>
        </>
      }
    >
      <div className="flex min-h-full">
        <div className="flex min-w-0 flex-1 flex-col gap-3.5 p-4 md:p-6">
          {tool === "sync" && configured && !error && (
            <p className="rounded-[10px] bg-[var(--color-success-soft)] px-3 py-2 text-[12.5px] text-[var(--color-success)]">
              {L.syncedNow}
            </p>
          )}
          {tool === "starter" && <StarterSetButton />}

          {!configured && (
            <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
              <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{L.notConnected}</h3>
              <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">{L.notConnectedBody}</p>
            </div>
          )}
          {configured && error && (
            <p className="rounded-[12px] bg-[var(--color-danger-soft)] px-4 py-3 text-[13px] text-[var(--color-danger)]">
              {fmt(L.readError, { e: error })}
            </p>
          )}
          {bindings.error && (
            <p className="rounded-[12px] bg-[var(--color-danger-soft)] px-4 py-3 text-[12.5px] text-[var(--color-danger)]">
              {fmt(L.bindingError, { e: bindings.error })}
            </p>
          )}

          {configured && !error && !bindings.error && unmapped.length > 0 && (
            <div className="flex flex-wrap items-center gap-3.5 rounded-[12px] border border-[#f0c9c9] bg-[#fbeeee] px-4 py-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f6dada] text-[14px] font-bold text-[var(--color-danger)]">
                !
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[var(--color-ink)]">
                  {fmt(unmapped.length === 1 ? L.unmappedOne : L.unmappedMany, { n: unmapped.length })}
                </div>
                <div className="text-[12px] text-[var(--color-muted)]">
                  {fmt(L.unmappedBody, { names: unmapped.slice(0, 3).map((x) => x.name).join(" / ") })}
                </div>
              </div>
              <Link
                href={keep({ mapping: "missing", t: unmapped[0].id })}
                className="flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {L.fixMapping}
              </Link>
            </div>
          )}

          {analytics?.refusal && <AnalyticsRefusalBanner refusal={analytics.refusal} days={analytics.days} />}
          {analytics?.incomplete && <AnalyticsIncompleteNote note={analytics.incomplete} />}

          {configured && !error && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <form className="flex h-[36px] w-full max-w-[280px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 focus-within:border-[var(--color-accent)]">
                  {fCat && <input type="hidden" name="category" value={fCat} />}
                  {fLang && <input type="hidden" name="language" value={fLang} />}
                  {fStatus && <input type="hidden" name="status" value={fStatus} />}
                  {fMap && <input type="hidden" name="mapping" value={fMap} />}
                  <IconSearch width={15} height={15} className="text-[var(--color-faint)]" />
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder={L.search}
                    className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]"
                  />
                </form>
                <FilterPill param="category" label={L.category} anyLabel={L.any} options={opts(all.map((x) => x.category))} />
                <FilterPill param="language" label={L.language} anyLabel={L.any} options={opts(all.map((x) => x.language))} />
                <FilterPill param="status" label={L.status} anyLabel={L.any} options={opts(all.map((x) => x.status), L.statusL)} />
              </div>

              <div className="flex-1 overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                <div className="min-w-[760px]">
                  <div
                    className={`grid ${cols} gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]`}
                  >
                    <span>{L.colTemplate}</span>
                    <span>{L.colCategory}</span>
                    <span>{L.colMeta}</span>
                    <span>{L.colVars}</span>
                    <span>{fmt(L.colRead, { d: days })}</span>
                  </div>
                  {rows.length === 0 && (
                    <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                      {all.length ? L.noMatch : L.none}
                    </p>
                  )}
                  {rows.map((r, i) => {
                    const slots = positionalSlots(r.body);
                    const byIndex = new Map(r.bindings.map((b) => [b.index, b]));
                    const missing = slots.filter((n) => !isBound(byIndex.get(n))).length;
                    const stats = analytics?.stats.get(r.id);
                    const rate = stats?.ok ? readRate(stats.counts) : null;
                    const on = r.id === selected?.id;
                    const tone = ICON_TONES[i % ICON_TONES.length];
                    return (
                      <Link
                        key={r.id}
                        href={keep({ t: r.id })}
                        scroll={false}
                        className={`grid ${cols} items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 last:border-b-0 ${
                          on
                            ? "bg-[var(--color-accent-soft)]/50 shadow-[inset_3px_0_0_var(--color-accent)]"
                            : "hover:bg-[var(--color-surface-2)]"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                            style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                              <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                              <path d="M8.5 12h7M8.5 9h4" />
                            </svg>
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{r.name}</span>
                            <span className="block truncate text-[11.5px] text-[var(--color-faint)]">
                              {r.language} · {r.header || r.body}
                            </span>
                          </span>
                        </span>
                        <span>
                          <span
                            className={`inline-block rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.04em] ${
                              CAT_TONE[r.category] ?? "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                            }`}
                          >
                            {r.category}
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span
                            className={`inline-block rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                              STATUS_TONE[r.status] ?? STATUS_TONE.DISABLED
                            }`}
                          >
                            {L.statusL[r.status] ?? r.status}
                          </span>
                          {r.rejectedReason && r.rejectedReason !== "NONE" && (
                            <span className="mt-0.5 block truncate text-[11px] text-[var(--color-danger)]" title={r.rejectedReason}>
                              {r.rejectedReason}
                            </span>
                          )}
                        </span>
                        <span className="text-[12px] font-medium">
                          {slots.length === 0 ? (
                            <span className="text-[var(--color-faint)]">{L.noVars}</span>
                          ) : missing > 0 ? (
                            <span className="flex items-center gap-1.5 text-[var(--color-danger)]">
                              <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-danger)]" />
                              {fmt(L.notMapped, { n: missing })}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-[var(--color-success)]">
                              <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-success)]" />
                              {fmt(L.mapped, { a: slots.length, b: slots.length })}
                            </span>
                          )}
                        </span>
                        <span>
                          {stats?.ok && stats.counts.delivered > 0 && rate != null ? (
                            <>
                              <span className="flex items-center gap-2">
                                <span className="h-[5px] max-w-[88px] flex-1 overflow-hidden rounded-full bg-[var(--color-surface-dim)]">
                                  <span className="block h-full rounded-full bg-[var(--color-pastel-blue-ink)]" style={{ width: `${Math.round(rate * 100)}%` }} />
                                </span>
                                <span className="text-[12px] font-semibold tabular-nums text-[var(--color-ink)]">{Math.round(rate * 100)}%</span>
                              </span>
                              <span className="mt-0.5 block text-[11px] text-[var(--color-faint)]">
                                {fmt(L.delivered, { n: stats.counts.delivered.toLocaleString("en-US") })}
                              </span>
                            </>
                          ) : (
                            <span className="text-[12px] text-[var(--color-faint)]">{stats && !stats.ok ? L.unavailable : "—"}</span>
                          )}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <aside className="hidden w-[324px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] xl:block">
          {selected ? (
            <TemplateSide
              key={`${selected.id}-${JSON.stringify(selected.bindings)}`}
              template={selected}
              fields={fields}
              sample={sample}
              stats={selStats?.ok ? selStats.counts : null}
              statsOff={!!selStats && !selStats.ok}
              days={days}
            />
          ) : (
            <p className="p-5 text-[12.5px] text-[var(--color-faint)]">{L.selectHint}</p>
          )}
        </aside>
      </div>
    </PageChrome>
  );
}
