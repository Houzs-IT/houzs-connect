import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webhookEvent } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { relTime } from "@/lib/format";

// Always fresh — this page exists to answer "did that just arrive?".
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

/** Green for something we acted on, amber for a delivery we deliberately
 *  ignored, red for one we dropped without handling. */
function toneFor(eventType: string | null, processed: boolean): string {
  if (processed) return "var(--color-success)";
  if ((eventType ?? "").startsWith("dropped:")) return "var(--color-danger)";
  return "var(--color-warning)";
}

export default async function SystemLogsPage() {
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
      subtitle="Every webhook delivery Meta and the ERP made to Connect, newest first"
    >
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          {events.length === 0 && (
            <div className="px-4 py-12 text-center text-[13px] text-[var(--color-faint)]">
              No webhook deliveries recorded yet. If you just messaged the WhatsApp number and
              nothing appears here, Meta never called us — check that the WABA has{" "}
              <span className="font-mono">Subscribe webhooks</span> switched on.
            </div>
          )}

          <ul>
            {events.map((e) => {
              const tone = toneFor(e.eventType, e.processed);
              return (
                <li
                  key={e.id}
                  className="border-b border-[var(--color-border)] px-4 py-3 last:border-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-muted)]">
                      {e.source}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
                        color: tone,
                      }}
                    >
                      {e.eventType ?? "—"}
                    </span>
                    <span className="text-[11px] text-[var(--color-faint)]">
                      {relTime(e.createdAt)}
                    </span>
                  </div>
                  <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--color-surface-2)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </PageChrome>
  );
}
