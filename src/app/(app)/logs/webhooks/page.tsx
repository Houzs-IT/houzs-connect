import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webhookEvent } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { FilterPill } from "@/components/shell/FilterPill";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { shortWhen } from "@/app/(app)/contacts/queries";
import { summarise } from "../humanise";
import { LiveChip, LogsTabs } from "../LogsTabs";

// Always fresh — this page exists to answer "did that just arrive?".
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const TONE: Record<string, [string, string, string]> = {
  ok: ["var(--color-success)", "var(--color-success-soft)", "✓"],
  warn: ["var(--color-pastel-orange-ink)", "var(--color-pastel-orange)", "!"],
  bad: ["var(--color-danger)", "var(--color-danger-soft)", "×"],
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function WebhookDeliveriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.logs;
  const sp = await searchParams;
  const source = one(sp.source);
  const toneFilter = one(sp.result);

  const db = getDb();
  const [events, verified, sources] = await Promise.all([
    db.query.webhookEvent.findMany({
      where: source ? eq(webhookEvent.source, source) : undefined,
      orderBy: desc(webhookEvent.createdAt),
      limit: PAGE_SIZE,
    }),
    db
      .select({ id: webhookEvent.id })
      .from(webhookEvent)
      .where(
        and(
          eq(webhookEvent.source, "whatsapp"),
          sql`${webhookEvent.eventType} like '%|sig:valid' and ${webhookEvent.createdAt} > now() - interval '30 days'`
        )
      )
      .limit(1)
      .catch(() => []),
    db.selectDistinct({ source: webhookEvent.source }).from(webhookEvent),
  ]);
  const signatureVerifiedRecently = verified.length > 0;
  const items = events
    .map((e) => ({ e, s: summarise(e.source, e.eventType, e.processed, e.payload) }))
    .filter((x) => !toneFilter || x.s.tone === toneFilter);

  return (
    <PageChrome section="logs" page="webhooks" center={<LogsTabs L={L} on="webhooks" />} actions={<LiveChip live={isLive()} L={L} />}>
      <div className="flex flex-col gap-3.5 p-4">
        {!process.env.WHATSAPP_APP_SECRET ? (
          <p className="rounded-[12px] border border-[#f0c9c9] bg-[#fbeeee] px-4 py-3 text-[12.5px] text-[var(--color-danger)]">{L.secretOff}</p>
        ) : !signatureVerifiedRecently ? (
          <p className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[12.5px] text-[var(--color-muted)]">{L.secretArming}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            param="source"
            label={L.source}
            anyLabel={L.allSources}
            options={sources.map((s) => ({ value: s.source, label: L.src[s.source] ?? s.source }))}
          />
          <FilterPill
            param="result"
            label={L.status}
            anyLabel={L.any}
            options={[
              { value: "ok", label: L.ok },
              { value: "warn", label: L.warn },
              { value: "bad", label: L.bad },
            ]}
          />
        </div>

        <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
          {items.length === 0 && <p className="py-10 text-center text-[13px] text-[var(--color-faint)]">{L.noEvents}</p>}
          <ol className="relative">
            {items.map(({ e, s }, i) => {
              const [ink, bg, icon] = TONE[s.tone];
              return (
                <li key={e.id} className="relative flex gap-3.5 py-3">
                  {i < items.length - 1 && <span className="absolute left-[13px] top-[38px] bottom-[-10px] w-px bg-[var(--color-border)]" />}
                  <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold" style={{ background: bg, color: ink }}>
                    {icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-[4px] bg-[var(--color-surface-2)] px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--color-muted)]">
                            {L.src[e.source] ?? e.source}
                          </span>
                          <span className="text-[13.5px] text-[var(--color-ink)]">{s.headline}</span>
                        </div>
                        <p className="mt-1 text-[12.5px]" style={{ color: ink }}>
                          {s.outcome}
                        </p>
                        {s.details.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {s.details.map((d) => (
                              <span key={d} className="rounded-[4px] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-code text-[10.5px] text-[var(--color-faint)]">
                                {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-[var(--color-faint)]">
                        {shortWhen(e.createdAt, t.pay.yesterday)}
                      </span>
                    </div>
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--color-faint)] hover:text-[var(--color-muted)]">{L.rawJson}</summary>
                      <pre className="mt-1.5 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-[var(--color-surface-2)] p-2.5 font-code text-[11px] leading-relaxed text-[var(--color-muted)]">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </PageChrome>
  );
}
