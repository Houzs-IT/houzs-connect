import { Fragment } from "react";
import { clockTime, stamp } from "@/lib/format";
import { IconCheck } from "@/components/icons";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { demoTap } from "@/app/actions";

/**
 * Which day a message belongs to, in Malaysian time.
 *
 * The Worker's clock is UTC, so between 00:00 and 08:00 local the UTC calendar
 * day is still yesterday's — grouping on it would draw the "Today" separator in
 * the middle of last night's conversation. en-CA renders YYYY-MM-DD, which
 * compares as a plain string.
 */
const TZ = "Asia/Kuala_Lumpur";

function dayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

function dayLabel(d: Date | string): string {
  const key = dayKey(d);
  const now = Date.now();
  if (key === dayKey(new Date(now))) return "Today";
  // Malaysia has no DST, so a day back is exactly 24 hours back.
  if (key === dayKey(new Date(now - 86_400_000))) return "Yesterday";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-1.5 flex items-center gap-3">
      <span className="h-px flex-1 bg-[var(--color-border)]" />
      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-0.5 text-[10.5px] font-medium text-[var(--color-muted)]">
        {label}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/**
 * What Meta says happened to an outbound message — the tick every WhatsApp user
 * already reads without being taught. This used to be a single grey check on
 * every outbound message regardless of status, so a FAILED send looked exactly
 * like a delivered one.
 */
function DeliveryState({ status }: { status: string }) {
  if (status === "FAILED") {
    return (
      <span title="WhatsApp refused this message — it never reached the customer." className="font-semibold text-[var(--color-danger)]">
        failed
      </span>
    );
  }
  if (status === "READ") {
    return (
      <span title="Read by the customer" className="flex text-[var(--color-info,#3b82f6)]">
        <IconCheck width={12} height={12} />
        <IconCheck width={12} height={12} className="-ml-[7px]" />
      </span>
    );
  }
  if (status === "DELIVERED") {
    return (
      <span title="Delivered to the customer's phone" className="flex">
        <IconCheck width={12} height={12} />
        <IconCheck width={12} height={12} className="-ml-[7px]" />
      </span>
    );
  }
  if (status === "QUEUED") {
    return <span title="Waiting to be sent">·</span>;
  }
  return (
    <span title="Sent to WhatsApp">
      <IconCheck width={12} height={12} />
    </span>
  );
}

type Msg = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  isBot: boolean;
  status: string;
  interactivePayload: unknown;
  createdAt: Date | string;
  /** Who sent it, for outbound only — a member's name, or "Bot". */
  senderName?: string | null;
};

type Buttons = { kind?: string; buttons?: { id: string; label: string }[] };

export function Thread({
  messages,
  conversationId,
}: {
  messages: Msg[];
  contactName: string;
  conversationId: string;
}) {
  // Server component, so this reads the Worker's env directly — no prop drilling
  // and no way for the client to disagree with it.
  const live = isLive();
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-6">
      {messages.map((m, i) => {
        const out = m.direction === "OUT";
        const payload = (m.interactivePayload as Buttons | null) ?? null;
        const buttons = payload?.buttons ?? [];
        const prev = i > 0 ? messages[i - 1] : null;
        const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
        return (
          <Fragment key={m.id}>
            {newDay && <DaySeparator label={dayLabel(m.createdAt)} />}
            <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[62%]">
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm ring-1 ${
                    out
                      ? "rounded-br-md bg-[var(--color-out)] text-[var(--color-accent-ink)] ring-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                      : "rounded-bl-md bg-[var(--color-in)] text-[var(--color-ink)] ring-[var(--color-border)]"
                  }`}
                >
                  {m.isBot && (
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-ink)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                      Bot
                    </div>
                  )}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <div
                    className={`mt-1 flex items-center gap-1 text-[10px] ${
                      out
                        ? "justify-end text-[color-mix(in_srgb,var(--color-accent-ink)_60%,transparent)]"
                        : "text-[var(--color-faint)]"
                    }`}
                  >
                    {out && m.senderName && (
                      <span className="font-medium">{m.senderName}</span>
                    )}
                    <span title={stamp(m.createdAt)}>{clockTime(m.createdAt)}</span>
                    {out && <DeliveryState status={m.status} />}
                  </div>
                </div>

                {/* Quick-reply buttons. On DEMO these are tappable so one person
                    can drive both sides of a flow. On LIVE they belong to the
                    customer's phone — rendering them as buttons for the operator
                    invites a tap that fabricates a customer reply into a real
                    thread, so they become a flat preview of what was sent. */}
                {out && buttons.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                    {buttons.map((b) =>
                      live ? (
                        <span
                          key={b.id}
                          title="The customer taps this on their phone."
                          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-muted)]"
                        >
                          {b.label}
                        </span>
                      ) : (
                        <form key={b.id} action={demoTap}>
                          <input type="hidden" name="conversationId" value={conversationId} />
                          <input type="hidden" name="buttonId" value={b.id} />
                          <input type="hidden" name="buttonLabel" value={b.label} />
                          <button
                            type="submit"
                            className="rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-ink)] shadow-sm transition-colors hover:bg-[var(--color-accent-soft)]"
                          >
                            {b.label}
                          </button>
                        </form>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
