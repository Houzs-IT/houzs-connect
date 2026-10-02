import { Fragment } from "react";
import { clockTime, stamp } from "@/lib/format";
import { IconCheck } from "@/components/icons";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { getDict, getLang } from "@/lib/i18n/server";
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

function dayLabel(d: Date | string, today: string, yesterday: string, locale: string): string {
  const key = dayKey(d);
  const now = Date.now();
  if (key === dayKey(new Date(now))) return today;
  // Malaysia has no DST, so a day back is exactly 24 hours back.
  if (key === dayKey(new Date(now - 86_400_000))) return yesterday;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TZ,
  });
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-1 flex items-center gap-3">
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
 * already reads without being taught. A FAILED send must never look like a
 * delivered one.
 */
function DeliveryState({ status }: { status: string }) {
  if (status === "FAILED") {
    return (
      <span title="WhatsApp refused this message — it never reached the customer." className="font-semibold text-[var(--color-danger)]">
        failed
      </span>
    );
  }
  if (status === "READ" || status === "DELIVERED") {
    return (
      <span
        title={status === "READ" ? "Read by the customer" : "Delivered to the customer's phone"}
        className={`flex ${status === "READ" ? "text-[var(--color-accent)]" : ""}`}
      >
        <IconCheck width={12} height={12} />
        <IconCheck width={12} height={12} className="-ml-[7px]" />
      </span>
    );
  }
  if (status === "QUEUED") {
    return <span title="Waiting to be sent">·</span>;
  }
  return (
    <span title="Sent to WhatsApp" className="flex">
      <IconCheck width={12} height={12} />
    </span>
  );
}

type Msg = {
  kind: "message";
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

/** An internal note: written in the composer's "Private note" tab, never sent. */
type Note = {
  kind: "note";
  id: string;
  body: string;
  author: string | null;
  createdAt: Date | string;
};

export type ThreadItem = Msg | Note;

type Buttons = { kind?: string; buttons?: { id: string; label: string }[] };

export async function Thread({
  items,
  conversationId,
}: {
  items: ThreadItem[];
  conversationId: string;
}) {
  // Server component, so this reads the Worker's env directly — no prop drilling
  // and no way for the client to disagree with it.
  const live = isLive();
  const t = await getDict();
  const s = t.service;
  const locale = (await getLang()) === "zh" ? "zh-CN" : "en-GB";

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-5 md:px-6">
      {items.map((m, i) => {
        const prev = i > 0 ? items[i - 1] : null;
        const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
        const sep = newDay && <DaySeparator label={dayLabel(m.createdAt, s.today, s.yesterday, locale)} />;

        if (m.kind === "note") {
          return (
            <Fragment key={`n-${m.id}`}>
              {sep}
              <div className="flex justify-center">
                <div className="w-full max-w-[72%] rounded-[12px] border border-[rgba(110,77,18,0.3)] bg-[var(--color-warning-soft)] px-3.5 py-2.5 text-[13px] leading-[1.55] text-[var(--color-ink)]">
                  <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-warning)]">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {s.noteBadge}
                    {m.author && <span className="font-medium normal-case tracking-normal">· {m.author}</span>}
                    <span className="ml-auto font-normal normal-case tracking-normal text-[var(--color-faint)]" title={stamp(m.createdAt)}>
                      {clockTime(m.createdAt)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            </Fragment>
          );
        }

        const out = m.direction === "OUT";
        const payload = (m.interactivePayload as Buttons | null) ?? null;
        const buttons = payload?.buttons ?? [];
        return (
          <Fragment key={m.id}>
            {sep}
            <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
              <div className={`flex max-w-[78%] flex-col md:max-w-[64%] ${out ? "items-end" : "items-start"}`}>
                <div
                  className={`px-[13px] py-[9px] text-[13.5px] leading-[1.55] ${
                    out
                      ? "rounded-[14px_14px_4px_14px] bg-[var(--color-out)] text-[var(--color-accent-ink)] shadow-[0_0_0_1px_rgba(30,111,128,0.25),0_1px_2px_rgba(0,0,0,0.05)]"
                      : "rounded-[14px_14px_14px_4px] bg-[var(--color-in)] text-[var(--color-ink)] shadow-[0_0_0_1px_var(--color-border),0_1px_2px_rgba(0,0,0,0.05)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
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
                          className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-muted)]"
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
                            className="rounded-[8px] border border-[rgba(30,111,128,0.4)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-ink)] transition-colors hover:bg-[var(--color-accent-soft)]"
                          >
                            {b.label}
                          </button>
                        </form>
                      )
                    )}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-[5px] px-1 text-[10.5px] text-[var(--color-faint)]">
                  {m.isBot ? (
                    <span className="flex items-center gap-[3px] font-semibold text-[var(--color-accent-ink)]">
                      <span className="h-[5px] w-[5px] rounded-full bg-[var(--color-accent)]" />
                      {s.bot}
                    </span>
                  ) : (
                    out && m.senderName && <span className="font-medium text-[var(--color-muted)]">{m.senderName}</span>
                  )}
                  <span title={stamp(m.createdAt)}>{clockTime(m.createdAt)}</span>
                  {out && <DeliveryState status={m.status} />}
                </div>
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
