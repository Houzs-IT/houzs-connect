import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, conversation, message } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { LogTabs } from "./LogTabs";

// The delivery ledger: what went out, what came in, and what Meta did with it.
// Seampify's equivalent (System Logs → Message History) is the page their team
// actually lives in — it answers "did the customer get it?" without opening a
// conversation.

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

/** Meta's per-message lifecycle, coloured by how much it should worry you. */
const STATUS_TONE: Record<string, string> = {
  READ: "var(--color-success)",
  DELIVERED: "var(--color-success)",
  SENT: "var(--color-muted)",
  QUEUED: "var(--color-warning)",
  FAILED: "var(--color-danger)",
};

function when(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(d);
}

export default async function MessageHistoryPage() {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();

  // Scope to this company's conversations, then read their messages.
  const convos = await db
    .select({ id: conversation.id, contactId: conversation.contactId })
    .from(conversation)
    .innerJoin(contact, eq(contact.id, conversation.contactId))
    .where(eq(contact.companyId, me.companyId));

  const rows = convos.length
    ? await db.query.message.findMany({
        where: inArray(
          message.conversationId,
          convos.map((c) => c.id)
        ),
        orderBy: desc(message.createdAt),
        limit: PAGE_SIZE,
        with: { conversation: { with: { contact: true } } },
      })
    : [];

  return (
    <PageChrome title="System Logs" subtitle="Every message in and out, with Meta's delivery status">
      <LogTabs />
      <div className="p-6">
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Direction</th>
                <th className="px-4 py-3 font-medium">Sent at</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[var(--color-faint)]">
                    No messages yet.
                  </td>
                </tr>
              )}
              {rows.map((m) => {
                const c = m.conversation.contact;
                const tone = STATUS_TONE[m.status] ?? "var(--color-muted)";
                return (
                  <tr
                    key={m.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                      {c.name ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted)]">
                      {c.phone}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-[var(--color-muted)]">
                      {m.body || "—"}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-[var(--color-faint)]">{m.type}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          m.direction === "IN"
                            ? "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                            : "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                        }`}
                      >
                        {m.direction === "IN" ? "Incoming" : "Outgoing"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11.5px] text-[var(--color-faint)]">
                      {when(m.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: `color-mix(in srgb, ${tone} 12%, transparent)`,
                          color: tone,
                        }}
                        title={
                          m.waMessageId
                            ? `Meta id ${m.waMessageId}`
                            : "Never reached Meta — no message id was returned."
                        }
                      >
                        {m.status.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PageChrome>
  );
}
