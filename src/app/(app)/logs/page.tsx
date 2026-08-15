import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, conversation, message } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { phoneNumberInfo, type PhoneNumberInfo } from "@/lib/whatsapp/cloud-api";
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

/** …and the same lifecycle in words, since "QUEUED" is a database value. */
const STATUS_LABEL: Record<string, string> = {
  READ: "read",
  DELIVERED: "delivered",
  SENT: "sent",
  QUEUED: "waiting to send",
  FAILED: "failed",
};

/** MessageType in words — what the customer or the operator actually sent. */
const TYPE_LABEL: Record<string, string> = {
  TEXT: "Text",
  INTERACTIVE: "Buttons",
  TEMPLATE: "Template",
  IMAGE: "Photo",
  DOCUMENT: "Document",
  AUDIO: "Voice note",
  VIDEO: "Video",
};

function when(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(d);
}

/** Meta's refusal text, if transport.ts recorded one on this row. */
function sendError(payload: unknown): string | null {
  const p = payload as { kind?: string; reason?: string } | null;
  return p?.kind === "send_error" ? (p.reason ?? null) : null;
}

/**
 * What Meta says about the number we send from, asked at render time.
 *
 * This exists because the app spent a day accepting sends that never arrived:
 * Graph returned a message id every time, so nothing in the app looked wrong,
 * while no status webhook ever came back and no customer received anything. The
 * channel row could not help — its phone column is seeded placeholder data. Only
 * Meta knows the number behind WHATSAPP_PHONE_NUMBER_ID and what state it is in.
 */
function ConnectionCard({ info }: { info: PhoneNumberInfo | null }) {
  if (!info) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[12.5px] text-[var(--color-muted)]">
        WhatsApp is in <strong className="text-[var(--color-ink)]">DEMO</strong> mode — nothing is
        sent to a real phone.
      </div>
    );
  }

  // CONNECTED is the only state that actually delivers. A number can be
  // code-VERIFIED and still be PENDING/FLAGGED/RESTRICTED, which is exactly the
  // shape of "Meta accepts the send, returns an id, and nobody receives it".
  const bad =
    !!info.error ||
    (info.connection !== null && info.connection !== "CONNECTED") ||
    (info.status !== null && info.status !== "VERIFIED");
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        bad
          ? "border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_6%,transparent)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]">
        Sending from
      </div>
      {info.error ? (
        <p className="mt-1 text-[12.5px] text-[var(--color-danger)]">
          Meta would not tell us about this number: {info.error}
        </p>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-[14px] font-semibold text-[var(--color-ink)]">
            {info.displayPhoneNumber ?? "unknown"}
          </span>
          {info.verifiedName && (
            <span className="text-[12.5px] text-[var(--color-muted)]">{info.verifiedName}</span>
          )}
          <span className="text-[12px] text-[var(--color-muted)]">
            Connection:{" "}
            <strong
              className={
                info.connection === "CONNECTED"
                  ? "text-[var(--color-ink)]"
                  : "text-[var(--color-danger)]"
              }
            >
              {info.connection ?? "unknown"}
            </strong>
          </span>
          <span className="text-[12px] text-[var(--color-muted)]">
            Daily limit: <strong className="text-[var(--color-ink)]">{info.limitTier ?? "not set"}</strong>
          </span>
          <span className="text-[12px] text-[var(--color-muted)]">
            Number verification: <strong className="text-[var(--color-ink)]">{info.status ?? "unknown"}</strong>
          </span>
          <span className="text-[12px] text-[var(--color-muted)]">
            Quality: <strong className="text-[var(--color-ink)]">{info.qualityRating ?? "not rated yet"}</strong>
          </span>
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
        Asked of Meta just now, keyed by the same phone number id every message goes through — so
        this is the number customers really see, not a stored setting.
      </p>
    </div>
  );
}

export default async function MessageHistoryPage() {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const wa = await phoneNumberInfo().catch(() => null);

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
      <div className="px-6 pt-6">
        <ConnectionCard info={wa} />
      </div>
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
                    <td className="px-4 py-3 text-[11px] text-[var(--color-faint)]">
                      {TYPE_LABEL[m.type] ?? m.type}
                    </td>
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
                        {STATUS_LABEL[m.status] ?? m.status.toLowerCase()}
                      </span>
                      {/* Meta's own words about a refusal. Without this the row
                          says "failed" and the one fact that would fix it — the
                          reason — is only in a Worker console nobody reads. */}
                      {sendError(m.interactivePayload) && (
                        <div className="mt-1 max-w-[320px] text-[11px] leading-relaxed text-[var(--color-danger)]">
                          {sendError(m.interactivePayload)}
                        </div>
                      )}
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
