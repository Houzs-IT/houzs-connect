"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { EmojiPicker } from "@/components/inbox/EmojiPicker";
import { useShell } from "@/components/shell/ShellProvider";
import { formatPhone } from "@/lib/format";
import { MAX_ATTACHMENTS, MAX_FILE_BYTES, kindFor, type AttachmentKind } from "@/lib/internal-media";
import { findConversations, postAttachmentMessage, postMessage } from "./actions";

type Convo = { id: string; name: string; phone: string; orderRef: string | null };
/** A file staged in the composer, before send. `url` is a preview object URL (images only). */
type Staged = { id: string; file: File; kind: AttachmentKind; url: string | null; w?: number; h?: number };

/**
 * Write a message: @ opens a colleague picker, "Link conversation" attaches a
 * customer conversation as a card, 😊 opens the emoji grid, 📎 (or paste / drag)
 * attaches images and files like a WhatsApp group. Enter sends (Shift+Enter for
 * a new line). In a thread it can also post the reply to the channel.
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
  const [items, setItems] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const area = useRef<HTMLTextAreaElement>(null);
  const phoneArea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  // Revoke every preview URL when the composer unmounts (channel switch, etc).
  useEffect(() => {
    return () => {
      for (const it of items) if (it.url) URL.revokeObjectURL(it.url);
    };
    // Intentionally run only on unmount: a deps array with `items` would revoke
    // a URL still shown after every add/remove. Removal revokes its own URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertMention = (name: string) => {
    const next = at ? body.slice(0, at.index) + `@${name} ` : `${body}${body && !body.endsWith(" ") ? " " : ""}@${name} `;
    setBody(next);
    setPicker("none");
    requestAnimationFrame(() => area.current?.focus());
  };

  // Drop the emoji at the caret of whichever textarea has focus (or at the end).
  // The picker stays open so several can be added in a row, like WhatsApp.
  const insertEmoji = (e: string) => {
    const el = area.current && document.activeElement === area.current ? area.current : phoneArea.current && document.activeElement === phoneArea.current ? phoneArea.current : null;
    if (!el) {
      setBody((b) => b + e);
      return;
    }
    const s = el.selectionStart ?? body.length;
    const en = el.selectionEnd ?? body.length;
    const next = body.slice(0, s) + e + body.slice(en);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const p = s + e.length;
      el.setSelectionRange(p, p);
    });
  };

  const addFiles = (incoming: File[]) => {
    setError(null);
    const picked = incoming.filter((f) => f.size > 0);
    if (!picked.length) return;
    if (items.length + picked.length > MAX_ATTACHMENTS) {
      setError(L.attachTooMany.replace("{n}", String(MAX_ATTACHMENTS)));
      return;
    }
    const mb = Math.round(MAX_FILE_BYTES / 1024 / 1024);
    for (const f of picked) {
      if (f.size > MAX_FILE_BYTES) {
        setError(L.attachTooBig.replace("{name}", f.name || "File").replace("{mb}", String(mb)));
        return;
      }
    }
    const staged: Staged[] = picked.map((f) => {
      const kind = kindFor(f.type || "");
      return { id: crypto.randomUUID(), file: f, kind, url: kind === "image" ? URL.createObjectURL(f) : null };
    });
    setItems((prev) => [...prev, ...staged]);
    // Measure images so the sent bubble can reserve the right space.
    for (const s of staged) {
      if (s.kind === "image" && s.url) {
        const img = new Image();
        img.onload = () => setItems((prev) => prev.map((x) => (x.id === s.id ? { ...x, w: img.naturalWidth, h: img.naturalHeight } : x)));
        img.src = s.url;
      }
    }
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const gone = prev.find((x) => x.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return prev.filter((x) => x.id !== id);
    });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const fs = Array.from(e.dataTransfer?.files ?? []);
    if (fs.length) addFiles(fs);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const fs = Array.from(e.clipboardData?.files ?? []);
    if (fs.length) {
      e.preventDefault();
      addFiles(fs);
    }
  };

  const send = () => {
    if (!body.trim() && !convo && items.length === 0) return;
    setError(null);
    start(async () => {
      let res: { ok: boolean; error?: string };
      if (items.length > 0) {
        const fd = new FormData();
        fd.set("channelId", channelId);
        fd.set("body", body);
        if (parentId) fd.set("parentId", parentId);
        if (also) fd.set("alsoInChannel", "1");
        if (convo) fd.set("conversationId", convo.id);
        fd.set("dims", JSON.stringify(items.map((a) => (a.kind === "image" && a.w && a.h ? { w: a.w, h: a.h } : null))));
        for (const a of items) fd.append("files", a.file, a.file.name);
        res = await postAttachmentMessage(fd);
      } else {
        res = await postMessage({ channelId, body, parentId, alsoInChannel: also, conversationId: convo?.id ?? null });
      }
      if (!res.ok) return setError(res.error ?? L.attachFailed);
      for (const a of items) if (a.url) URL.revokeObjectURL(a.url);
      setItems([]);
      setBody("");
      setConvo(null);
      setAlso(false);
      router.refresh();
    });
  };

  const canSend = !pending && (!!body.trim() || !!convo || items.length > 0);

  const previews =
    items.length > 0 ? (
      <div className="flex flex-wrap gap-2 px-1 pb-2">
        {items.map((a) => (
          <div key={a.id} className="relative">
            {a.kind === "image" && a.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.url} alt={a.file.name} className="h-14 w-14 rounded-[8px] border border-[var(--color-border)] object-cover" />
            ) : (
              <div className="flex h-14 max-w-[150px] items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2">
                <span className="text-[14px]">📄</span>
                <span className="truncate text-[11.5px] text-[var(--color-ink)]">{a.file.name}</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => removeItem(a.id)}
              aria-label={L.removeAttachment}
              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--color-ink)] text-[11px] text-white shadow"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    ) : null;

  const attachBtn = (extra: string) => (
    <button
      type="button"
      onClick={() => fileInput.current?.click()}
      aria-label={L.attach}
      title={L.attach}
      className={extra}
    >
      📎
    </button>
  );

  return (
    <div className="relative" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-[12px] border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent-soft)]/70 text-[13px] font-semibold text-[var(--color-accent-ink)]">
          {L.attach}
        </div>
      )}
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
        <div className="absolute bottom-full right-0 z-20 mb-1 w-[320px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-popover)]">
          <EmojiPicker onPick={insertEmoji} />
        </div>
      )}

      {/* Phone: "@", attach, a pill and a round send, like the design. Linking a
          conversation stays a desktop thing. */}
      {!thread && (
        <div className="md:hidden">
          {previews}
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={L.mention}
              onClick={() => {
                setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}@`);
                setPicker("mention");
                phoneArea.current?.focus();
              }}
              className="grid h-11 w-8 shrink-0 place-items-center text-[18px] text-[var(--color-ink)]"
            >
              @
            </button>
            {attachBtn("grid h-11 w-8 shrink-0 place-items-center text-[17px] text-[var(--color-ink)]")}
            <textarea
              ref={phoneArea}
              rows={1}
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                if (picker === "mention") setPicker("none");
              }}
              onPaste={onPaste}
              placeholder={L.msgShort}
              className="min-h-[44px] min-w-0 flex-1 resize-none rounded-[22px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-[11px] text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
            />
            <button
              type="button"
              aria-label={L.send}
              disabled={!canSend}
              onClick={send}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[16px] text-white shadow-[var(--shadow-primary)] disabled:opacity-40"
            >
              ➤
            </button>
          </div>
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
        {items.length > 0 && <div className="px-2.5 pt-2.5">{previews}</div>}
        <textarea
          ref={area}
          rows={thread ? 1 : 2}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (picker === "mention") setPicker("none");
          }}
          onPaste={onPaste}
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
            </>
          )}
          {attachBtn("grid h-8 w-8 place-items-center rounded-[6px] text-[15px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]")}
          <button
            type="button"
            onClick={() => setPicker(picker === "emoji" ? "none" : "emoji")}
            className="grid h-8 w-8 place-items-center rounded-[6px] text-[15px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
            aria-label="Emoji"
          >
            ☺
          </button>
          {thread && (
            <label className="flex items-center gap-1.5 px-1 text-[12px] text-[var(--color-muted)]">
              <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--color-accent)]" />
              {L.alsoSend.replace("{c}", channelName)}
            </label>
          )}
          <button
            type="button"
            disabled={!canSend}
            onClick={send}
            className="ml-auto flex h-[32px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40 disabled:shadow-none"
          >
            ➤ {!thread && (pending ? L.sending : L.send)}
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-[12px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
