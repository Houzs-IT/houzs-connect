import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webhookEvent } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { relTime } from "@/lib/format";
import { LogTabs } from "../LogTabs";
import { summarise } from "../humanise";

// Always fresh — this page exists to answer "did that just arrive?".
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

const TONE: Record<string, string> = {
  ok: "var(--color-success)",
  warn: "var(--color-warning)",
  bad: "var(--color-danger)",
};

export default async function WebhookDeliveriesPage() {
  const me = await getCurrentMember();
  if (!me) return null;

  const db = getDb();
  const events = await db.query.webhookEvent.findMany({
    orderBy: desc(webhookEvent.createdAt),
    limit: PAGE_SIZE,
  });

  return (
    <PageChrome
      title="System Logs"
      subtitle="Everything WhatsApp and the ERP sent us, and what we did with it"
    >
      <LogTabs />
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {events.length === 0 && (
            <div className="px-4 py-12 text-center text-[13px] text-[var(--color-faint)]">
              Nothing has arrived yet. If you just messaged the WhatsApp number and nothing shows
              here, WhatsApp never called us — check that the number is subscribed to message
              updates.
            </div>
          )}

          <ul>
            {events.map((e) => {
              const s = summarise(e.source, e.eventType, e.processed, e.payload);
              const tone = TONE[s.tone];
              return (
                <li
                  key={e.id}
                  className="border-b border-[var(--color-border)] px-4 py-3.5 last:border-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[13.5px] leading-snug text-[var(--color-ink)]">
                        {s.headline}
                      </p>
                      <p className="mt-1 text-[12.5px]" style={{ color: tone }}>
                        {s.outcome}
                      </p>
                      {s.details.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {s.details.map((d) => (
                            <span
                              key={d}
                              className="rounded-md bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--color-faint)]"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="flex-none whitespace-nowrap text-[11px] text-[var(--color-faint)]">
                      {relTime(e.createdAt)}
                    </span>
                  </div>

                  {/* The raw body still matters when someone is actually debugging
                      the integration — just not by default. */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-[var(--color-faint)] hover:text-[var(--color-muted)]">
                      Technical details
                    </summary>
                    <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--color-surface-2)] p-2.5 font-code text-[11px] leading-relaxed text-[var(--color-muted)]">
                      {JSON.stringify(e.payload, null, 2)}
                    </pre>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PageChrome>
  );
}
