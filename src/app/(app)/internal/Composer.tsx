"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { formatPhone } from "@/lib/format";
import { findConversations, postMessage } from "./actions";

type Convo = { id: string; name: string; phone: string; orderRef: string | null };
const EMOJI = ["👍", "🙏", "✅", "👀", "🎉", "😊", "⏰", "📦", "🚚", "💬"];

/**
 * Write a message: @ opens a colleague picker, "Link conversation" attaches a
 * customer conversation as a card, Enter sends (Shift+Enter for a new line).
 * In a thread it can also post the reply to the channel.
 */
export function Composer({
  channelId,
  channelName,
  parentId,
  placeholder,
  people,
  thread = false,
}: {
  channelId: string;
  channelName: string;
  parentId?: string;
  placeholder: string;
  people: { id: string; name: string }[];
  thread?: boolean;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.internal;
  const [body, setBody] = useState("");
  const [also, setAlso] = useState(false);
  const [convo, setConvo] = useState<Convo | null>(null);
  const [picker, setPicker] = useState<"none" | "mention" | "link" | "emoji">("none");
  const [find, setFind] = useState("");
  const [found, setFound] = useState<{ q: string; rows: Convo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const phoneArea = useRef<HTMLTextAreaElement>(null);

  // "@Na" → the colleagues whose name starts with "Na".
  const at = /@([^@\n]*)$/.exec(body);
  const mentionQuery = at ? at[1].toLowerCase() : null;
  const mentionOpen = picker === "mention" || (mentionQuery !== null && mentionQuery.length <= 20);
  const matches = mentionOpen
    ? [{ id: "channel", name: "channel" }, ...people].filter((p) => p.name.toLowerCase().startsWith(mentionQuery ?? "")).slice(0, 8)
    : [];

  useEffect(() => {
    if (picker !== "link" || find.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void findConversations(find).then((rows) => {
        if (!cancelled) setFound({ q: find, rows });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [find, picker]);
  const convoRows = found?.q === find ? found.rows : [];

  const insertMention = (name: string) => {
    const next = at ? body.slice(0, at.index) + `@${name} ` : `${body}${body && !body.endsWith(" ") ? " " : ""}@${name} `;
    setBody(next);
    setPicker("none");
    requestAnimationFrame(() => area.current?.focus());
  };

  const send = () => {
    if (!body.trim() && !convo) return;
    setError(null);
    start(async () => {
      const res = await postMessage({ channelId, body, parentId, alsoInChannel: also, conversationId: convo?.id ?? null });
      if (!res.ok) return setError(res.error ?? "Could not send.");
      setBody("");
      setConvo(null);
      setAlso(false);
      router.refresh();
    });
  };

  return (
    <div className="relative">
      {(mentionOpen && matches.length > 0) && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
          {matches.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(p.name)}
              className="block w-full truncate px-3 py-1.5 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
            >
              @{p.name}
            </button>
          ))}
        </div>
      )}
      {picker === "link" && (
        <div className="absolute bottom-full left-0 z-20 mb-1 w-80 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)]">
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={L.findConvo}
            className="h-[34px] w-full rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />
          <div className="mt-1 max-h-60 overflow-y-auto">
            {convoRows.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setConvo(c);
                  setPicker("none");
                  setFind("");
                }}
                className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
              >
                <span className="truncate text-[var(--color-ink)]">
                  {c.name} {c.orderRef && <b className="font-semibold text-[var(--color-brand)]">{c.orderRef}</b>}
                </span>
                <span className="shrink-0 text-[11.5px] text-[var(--color-faint)]">{formatPhone(c.phone)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {picker === "emoji" && (
        <div className="absolute bottom-full right-24 z-20 mb-1 grid grid-cols-5 gap-1 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)]">
          {EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setBody((b) => b + e);
                setPicker("none");
              }}
              className="grid h-8 w-8 place-items-center rounded-[6px] text-[16px] hover:bg-[var(--color-surface-2)]"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Phone: "@", a pill and a round send, like the design. Linking a
          conversation stays a desktop thing. */}
      {!thread && (
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            aria-label={L.mention}
            onClick={() => {
              setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@`);
              setPicker("mention");
              phoneArea.current?.focus();
            }}
            className="grid h-11 w-9 shrink-0 place-items-center text-[18px] text-[var(--color-ink)]"
          >
            @
          </button>
          <textarea
            ref={phoneArea}
            rows={1}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              if (picker === "mention") setPicker("none");
            }}
            placeholder={L.msgShort}
            className="min-h-[44px] min-w-0 flex-1 resize-none rounded-[22px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-[11px] text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
          <button
            type="button"
            aria-label={L.send}
            disabled={pending || (!body.trim() && !convo)}
            onClick={send}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[16px] text-white shadow-[var(--shadow-primary)] disabled:opacity-40"
          >
            ➤
          </button>
        </div>
      )}

      <div
        className={`${thread ? "" : "hidden md:block"} rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_3px_var(--color-accent-ring)]`}
      >
        {convo && (
          <div className="mx-3 mt-2.5 flex items-center gap-2 rounded-[8px] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
              {convo.name} {convo.orderRef && <b className="font-semibold text-[var(--color-brand)]">{convo.orderRef}</b>}
            </span>
            <button type="button" onClick={() => setConvo(null)} className="text-[15px] text-[var(--color-faint)]" aria-label="Remove">
              ×
            </button>
          </div>
        )}
        <textarea
          ref={area}
          rows={thread ? 1 : 2}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (picker === "mention") setPicker("none");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (matches.length && mentionOpen) insertMention(matches[0].name);
              else send();
            }
            if (e.key === "Escape") setPicker("none");
          }}
          placeholder={placeholder}
          className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-[13.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <div className="flex items-center gap-1 border-t border-[var(--color-border-subtle)] px-2 py-1.5">
          {!thread && (
            <>
              <button
                type="button"
                onClick={() => {
                  setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@`);
                  setPicker("mention");
                  area.current?.focus();
                }}
                className="hidden h-8 items-center gap-1 rounded-[6px] px-2 text-[12.5px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] sm:flex"
              >
                @ {L.mention}
              </button>
              <button
                type="button"
                onClick={() => setPicker(picker === "link" ? "none" : "link")}
                className="flex h-8 items-center gap-1 rounded-[6px] px-2 text-[12.5px] font-semibold text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                ⛓ {L.linkConvo}
              </button>
              <button
                type="button"
                onClick={() => setPicker(picker === "emoji" ? "none" : "emoji")}
                className="grid h-8 w-8 place-items-center rounded-[6px] text-[15px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
                aria-label="Emoji"
              >
                ☺
              </button>
            </>
          )}
          {thread && (
            <label className="flex items-center gap-1.5 px-1 text-[12px] text-[var(--color-muted)]">
              <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
              {L.alsoSend.replace("{c}", channelName)}
            </label>
          )}
          <button
            type="button"
            disabled={pending || (!body.trim() && !convo)}
            onClick={send}
            className="ml-auto flex h-[32px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40 disabled:shadow-none"
          >
            ➤ {!thread && L.send}
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-[12px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
