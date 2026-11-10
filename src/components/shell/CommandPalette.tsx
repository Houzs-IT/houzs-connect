"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useShell } from "./ShellProvider";
import { IconSearch } from "../icons";
import { globalSearch, type GlobalHit, type GlobalSearchResult } from "@/app/(app)/search-actions";

/**
 * Cmd/Ctrl+K command palette — jump to any conversation or contact from
 * anywhere by name, phone, order (SO) number or message text. Reuses the inbox's
 * whole-book server search, so it finds records that are not on screen. The
 * search is debounced and every result is bound to the term that produced it, so
 * a slow response for an old keystroke can never overwrite a newer one.
 */
export function CommandPalette() {
  const { t } = useShell();
  const s = t.shell;
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<GlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global shortcut: Cmd+K (mac) / Ctrl+K. Toggles the palette from any page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus (and select any leftover query) when it opens. No state writes here —
  // the last query is kept, and typing replaces the selected text.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => clearTimeout(id);
  }, [open]);

  // Debounced search, bound to the term by a sequence number.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    const id = setTimeout(
      () => {
        if (!term) {
          seq.current++;
          setResult(null);
          setLoading(false);
          return;
        }
        const mine = ++seq.current;
        setLoading(true);
        void globalSearch(term)
          .then((r) => {
            if (mine !== seq.current) return;
            setResult(r);
            setActive(0);
          })
          .catch(() => {
            if (mine !== seq.current) return;
            setResult({ conversations: [], contacts: [], degraded: ["conversations", "contacts"] });
          })
          .finally(() => {
            if (mine === seq.current) setLoading(false);
          });
      },
      term ? 250 : 0
    );
    return () => clearTimeout(id);
  }, [q, open]);

  // One flat list drives arrow-key navigation across both groups.
  const flat = useMemo<GlobalHit[]>(
    () => (result ? [...result.conversations, ...result.contacts] : []),
    [result]
  );

  const go = useCallback(
    (hit: GlobalHit | undefined) => {
      if (!hit) return;
      setOpen(false);
      router.push(hit.link);
    },
    [router]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    }
  };

  if (!open) return null;

  const term = q.trim();
  const hasHits = flat.length > 0;
  const degraded = result?.degraded.length
    ? s.cmdkFailedSome.replace("{n}", String(result.degraded.length))
    : null;

  let idx = -1; // running index across groups, to match `active`
  const group = (label: string, hits: GlobalHit[]) =>
    hits.length === 0 ? null : (
      <div className="py-1">
        <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-faint)]">
          {label}
        </div>
        {hits.map((h) => {
          idx++;
          const on = idx === active;
          const i = idx;
          return (
            <button
              key={h.link}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                on ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <span className="w-full truncate text-[13px] font-medium text-[var(--color-ink)]">{h.title}</span>
              {h.subtitle && (
                <span className="w-full truncate font-mono text-[11px] text-[var(--color-faint)]">{h.subtitle}</span>
              )}
            </button>
          );
        })}
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]">
        <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-3">
          <IconSearch width={16} height={16} className="shrink-0 text-[var(--color-faint)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={s.cmdkPlaceholder}
            className="w-full bg-transparent text-[14px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          />
          {loading && <span className="shrink-0 text-[11px] text-[var(--color-faint)]">{s.cmdkSearching}</span>}
        </div>

        <div className="scroll-thin max-h-[52vh] overflow-y-auto">
          {degraded && (
            <p className="px-3.5 py-2 text-[11px] text-[var(--color-warning)]">{degraded}</p>
          )}
          {!term && <p className="px-3.5 py-6 text-center text-[12.5px] text-[var(--color-faint)]">{s.cmdkHint}</p>}
          {term && result && !hasHits && !loading && (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-[var(--color-faint)]">
              {s.cmdkEmpty.replace("{q}", term)}
            </p>
          )}
          {group(s.cmdkConversations, result?.conversations ?? [])}
          {group(s.cmdkContacts, result?.contacts ?? [])}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-3.5 py-1.5 text-[10.5px] text-[var(--color-faint)]">
          <span>↑↓ {s.cmdkNav}</span>
          <span>↵ {s.cmdkOpen}</span>
          <span>esc {s.cmdkClose}</span>
        </div>
      </div>
    </div>
  );
}
