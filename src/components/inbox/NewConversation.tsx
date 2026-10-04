"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { listSendableTemplates } from "@/app/actions";
import { listInboxContacts } from "@/app/(app)/inbox/media-actions";
import { startConversation } from "@/app/(app)/inbox/conversation-actions";
import { fmt } from "@/lib/i18n/dict";
import { useShell } from "@/components/shell/ShellProvider";
import { IconClose, IconSearch } from "@/components/icons";

type Contact = { id: string; name: string | null; phone: string };
type Template = { name: string; language: string; body: string; placeholders: number };

const FIELD =
  "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";

function fill(body: string, params: string[]) {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] || `{{${n}}}`);
}

/**
 * "New conversation" at the foot of the Service list: pick a customer, pick an
 * approved template, fill its placeholders, send. The server reuses an open
 * conversation with that customer or opens one on the company's default number
 * (conversation-actions.ts), then this opens it.
 */
export function NewConversation() {
  const { t } = useShell();
  const s = t.service;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Contact | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function start() {
    setOpen(true);
    setError(null);
    if (templates == null) setTemplates(await listSendableTemplates());
    if (contacts.length === 0) setContacts(await listInboxContacts(""));
  }

  function search(v: string) {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => setContacts(await listInboxContacts(v)), 250);
  }

  async function send() {
    if (!picked || !tpl || busy) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("contactId", picked.id);
    fd.set("templateName", tpl.name);
    fd.set("language", tpl.language);
    fd.set("params", params.join("\n"));
    fd.set("preview", fill(tpl.body, params));
    const res = await startConversation(fd);
    setBusy(false);
    if (!res.ok) {
      setError(fmt(s.startFailed, { e: res.error }));
      return;
    }
    setOpen(false);
    setPicked(null);
    setTpl(null);
    router.push(`/inbox/${res.id}`);
  }

  return (
    <>
      {/* A round + over the tab bar on a phone (the design's list has no bar
          here); the full-width button on a desktop. */}
      <div className="fixed bottom-[76px] right-4 z-30 md:static md:shrink-0 md:border-t md:border-[var(--color-border)] md:px-3 md:py-2.5">
        <button
          type="button"
          aria-label={s.newConvo}
          onClick={() => void start()}
          className="flex h-12 w-12 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--color-accent)] md:h-9 md:w-full md:rounded-[8px] text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-[var(--color-accent-hi)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden md:inline">{s.newConvo}</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,16,32,0.45)] p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label={s.newConvo}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-[16px] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
              <div>
                <div className="text-[15px] font-semibold text-[var(--color-ink)]">{s.newConvo}</div>
                <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">{s.newConvoSub}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.shell.close}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                <IconClose width={16} height={16} />
              </button>
            </div>

            <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
              {/* Customer */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-[var(--color-ink)]">{s.pickContact}</span>
                {picked ? (
                  <div className="flex items-center justify-between rounded-[8px] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2 text-[13px]">
                    <span className="truncate font-medium text-[var(--color-accent-ink)]">
                      {picked.name ?? picked.phone} <span className="font-normal text-[var(--color-muted)]">{picked.phone}</span>
                    </span>
                    <button type="button" onClick={() => setPicked(null)} className="text-[12px] font-semibold text-[var(--color-accent)]">
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="flex items-center gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-[7px]">
                      <IconSearch width={15} height={15} className="text-[var(--color-faint)]" />
                      <input
                        autoFocus
                        value={q}
                        onChange={(e) => search(e.target.value)}
                        placeholder={s.searchContact}
                        className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]"
                      />
                    </label>
                    <div className="scroll-thin max-h-48 overflow-y-auto rounded-[8px] border border-[var(--color-border-subtle)]">
                      {contacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setPicked(c)}
                          className="flex w-full items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-[var(--color-surface-2)]"
                        >
                          <span className="truncate text-[var(--color-ink)]">{c.name ?? c.phone}</span>
                          <span className="shrink-0 tabular-nums text-[12px] text-[var(--color-faint)]">{c.phone}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Template */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-semibold text-[var(--color-ink)]">{s.pickTemplate}</span>
                {templates != null && templates.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--color-faint)]">{s.noTemplates}</p>
                ) : (
                  <select
                    value={tpl ? `${tpl.name}|${tpl.language}` : ""}
                    onChange={(e) => {
                      const next = templates?.find((x) => `${x.name}|${x.language}` === e.target.value) ?? null;
                      setTpl(next);
                      setParams(Array.from({ length: next?.placeholders ?? 0 }, () => ""));
                    }}
                    className={FIELD}
                  >
                    <option value="">—</option>
                    {(templates ?? []).map((x) => (
                      <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>
                        {x.name} · {x.language}
                      </option>
                    ))}
                  </select>
                )}
                {tpl && (
                  <>
                    {params.map((v, i) => (
                      <input
                        key={i}
                        value={v}
                        onChange={(e) => {
                          const next = [...params];
                          next[i] = e.target.value;
                          setParams(next);
                        }}
                        placeholder={fmt(s.paramN, { n: i + 1 })}
                        className={FIELD}
                      />
                    ))}
                    <div className="whitespace-pre-wrap rounded-[12px] rounded-br-[4px] bg-[var(--color-out)] px-3 py-2.5 text-[13px] leading-[1.55] text-[var(--color-accent-ink)] shadow-[0_0_0_1px_rgba(30,111,128,0.25)]">
                      {fill(tpl.body, params)}
                    </div>
                  </>
                )}
              </div>
              {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {s.cancel}
              </button>
              <button
                type="button"
                disabled={!picked || !tpl || busy || params.some((p) => !p.trim())}
                onClick={() => void send()}
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? s.sending : s.sendStart}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
