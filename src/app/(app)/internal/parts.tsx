import Link from "next/link";
import { initials, tint } from "@/lib/format";
import { fmt, type Dict } from "@/lib/i18n/dict";
import type { Card, ChatMessage } from "./data";

/*
  Server-safe pieces of the Internal timeline: avatar, a message with its
  @mentions highlighted, the customer conversation card, the reply summary.
*/

const TZ = "Asia/Kuala_Lumpur";
export const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const c = tint(name);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: c, fontSize: size >= 32 ? 11 : 9.5 }}
    >
      {initials(name).toUpperCase()}
    </span>
  );
}

/** Body text with "@Name" and "@channel" set as chips. */
export function RichBody({ body, names }: { body: string; names: string[] }) {
  const alts = [...names, "channel", "here"]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(@(?:${alts.join("|")}))`, "gi");
  return (
    <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[1.55] text-[var(--color-ink)]">
      {body.split(re).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded-[4px] bg-[var(--color-accent-soft)] px-1 font-medium text-[var(--color-accent-ink)]">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}

export function ConvoCard({ card, L, compact = false }: { card: Card; L: Dict["internal"]; compact?: boolean }) {
  const tone =
    card.badge?.tone === "danger"
      ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : card.badge?.tone === "success"
        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
        : "bg-[var(--color-pastel-orange)] text-[var(--color-warning)]";
  if (compact) {
    return (
      <Link
        href={`/inbox/${card.id}`}
        className="mt-2 flex items-center gap-2.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 hover:bg-[var(--color-surface-2)]"
      >
        <Avatar name={card.name} size={24} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-ink)]">
          {card.name} {card.orderRef && <span className="font-semibold text-[var(--color-brand)]">{card.orderRef}</span>}
        </span>
        <span className="text-[12px] font-semibold text-[var(--color-accent)]">{L.open} →</span>
      </Link>
    );
  }
  return (
    <>
    {/* Phone: one tappable line, as the design draws it. */}
    <Link
      href={`/inbox/${card.id}`}
      className="mt-2 flex items-center gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 md:hidden"
    >
      <Avatar name={card.name} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)]">
          {card.name} {card.orderRef && <span className="ml-1 text-[var(--color-brand)]">{card.orderRef}</span>}
        </span>
        <span className="block text-[12px] text-[var(--color-faint)]">{L.serviceConvo}</span>
      </span>
      <span className="text-[16px] text-[var(--color-accent)]">→</span>
    </Link>
    <div className="mt-2 hidden max-w-[440px] overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] md:block">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <Avatar name={card.name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-[var(--color-ink)]">
            {card.name} {card.orderRef && <span className="ml-1 font-semibold text-[var(--color-brand)]">{card.orderRef}</span>}
          </div>
          {card.lastText && <div className="truncate text-[12.5px] text-[var(--color-muted)]">“{card.lastText}”</div>}
        </div>
        {card.badge && (
          <span className={`shrink-0 rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}>{card.badge.text}</span>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3.5 py-2 text-[12px]">
        <span className="text-[var(--color-faint)]">
          {L.serviceConvo}
          {card.assignee ? ` · ${card.assignee}` : ""}
        </span>
        <Link href={`/inbox/${card.id}`} className="font-semibold text-[var(--color-accent)] hover:underline">
          {L.openConvo} →
        </Link>
      </div>
    </div>
    </>
  );
}

/** One message in a timeline or thread. */
export function MessageRow({
  m,
  names,
  L,
  threadHref,
  active = false,
  compactCard = false,
}: {
  m: ChatMessage;
  names: string[];
  L: Dict["internal"];
  /** Where "N replies" goes; omitted inside the thread itself. */
  threadHref?: string;
  active?: boolean;
  compactCard?: boolean;
}) {
  return (
    <div className={`flex gap-3 px-5 py-2.5 ${active ? "bg-[var(--color-accent-soft)]/50" : "hover:bg-[var(--color-surface-2)]/60"}`}>
      <Avatar name={m.author} size={compactCard ? 28 : 34} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">{m.author}</span>
          <span className="text-[11.5px] text-[var(--color-faint)]">
            {m.dept ? `${m.dept} · ` : ""}
            {hhmm(m.createdAt)}
          </span>
        </div>
        {m.body && <RichBody body={m.body} names={names} />}
        {m.systemAction && (
          <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-success-soft)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-success)]">
            ✓ {m.systemAction}
          </div>
        )}
        {m.card && <ConvoCard card={m.card} L={L} compact={compactCard} />}
        {threadHref && m.replies > 0 && (
          <Link href={threadHref} scroll={false} className="mt-1.5 flex items-center gap-2 text-[12.5px]">
            <span className="flex -space-x-1.5">
              {m.replyAuthors.slice(0, 3).map((a) => (
                <span key={a} className="rounded-full ring-2 ring-white">
                  <Avatar name={a} size={18} />
                </span>
              ))}
            </span>
            <span className="font-semibold text-[var(--color-accent)]">{m.replies === 1 ? L.oneReply : fmt(L.replies, { n: m.replies })}</span>
            {m.lastReplyAt && <span className="text-[var(--color-faint)]">{fmt(L.lastReply, { t: hhmm(m.lastReplyAt) })}</span>}
          </Link>
        )}
      </div>
    </div>
  );
}
