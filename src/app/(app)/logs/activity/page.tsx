import Link from "next/link";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/dict";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { recentActivity } from "@/lib/activity";
import { shortWhen } from "@/app/(app)/contacts/queries";
import { initials, tint } from "@/lib/format";
import { LiveChip, LogsTabs } from "../LogsTabs";

// Who did what on the shared inbox — assignments, status, tags, watchers,
// merges, blocks. The message/webhook ledgers are the other two tabs.
export const dynamic = "force-dynamic";

function asStrings(d: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (d) for (const [k, v] of Object.entries(d)) out[k] = v == null ? "" : String(v);
  return out;
}

export default async function ActivityLogPage() {
  const me = await getCurrentMember();
  if (!me) return null;
  const t = await getDict();
  const L = t.logs;
  const rows = await recentActivity(getDb(), { companyId: me.companyId, limit: 150 });

  return (
    <PageChrome section="logs" page="activity" center={<LogsTabs L={L} on="activity" />} actions={<LiveChip live={isLive()} L={L} />}>
      <div className="p-4">
        {rows.length === 0 ? (
          <p className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-center text-[13px] text-[var(--color-faint)]">
            {L.activityNone}
          </p>
        ) : (
          <ol className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
            {rows.map((r) => {
              const actor = r.actor ?? "—";
              const verb = fmt(L.act[r.action] ?? r.action, asStrings(r.detail));
              const href = r.entityType === "conversation" ? `/inbox/${r.entityId}` : `/contacts?id=${r.entityId}`;
              const c = tint(actor);
              return (
                <li key={r.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                  <Link href={href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-surface-2)]">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                      style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
                    >
                      {initials(actor)}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">
                      <span className="font-semibold">{actor}</span> <span className="text-[var(--color-muted)]">{verb}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--color-faint)]">
                      {shortWhen(r.createdAt, t.pay.yesterday)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </PageChrome>
  );
}
