"use client";

// The reply composer, with the "+" menu Seampify has: quick replies, templates,
// and the attachment/emoji/contact entries that are not wired yet but must not
// pretend to be. A control that looks live and does nothing is worse than one
// that says what it needs.

import { useRef, useState } from "react";
import { sendMessage, sendTemplateMessage, listQuickReplies, listSendableTemplates } from "@/app/actions";
import { IconPaperclip, IconSend } from "@/components/icons";

interface QuickReply {
  shortcut: string;
  body: string;
}
interface Template {
  name: string;
  language: string;
  body: string;
  placeholders: number;
}

/** Fill {{1}}, {{2}}, … so the operator sees what the customer will read. */
function renderPreview(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] || `{{${n}}}`);
}

export function Composer({ conversationId }: { conversationId: string }) {
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<null | "quick" | "template">(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const note = kind === "note";

  async function openQuick() {
    setMenuOpen(false);
    setPanel("quick");
    if (quickReplies.length === 0) {
      setLoading(true);
      setQuickReplies(await listQuickReplies());
      setLoading(false);
    }
  }

  async function openTemplates() {
    setMenuOpen(false);
    setPanel("template");
    if (templates.length === 0) {
      setLoading(true);
      setTemplates(await listSendableTemplates());
      setLoading(false);
    }
  }

  const menuItems = [
    { label: "Attachments", onClick: null, hint: "needs media upload" },
    { label: "Emoji", onClick: null, hint: "not built yet" },
    { label: "Quick Reply", onClick: openQuick, hint: null },
    { label: "Send Contact", onClick: null, hint: "not built yet" },
    { label: "Send Template Message", onClick: openTemplates, hint: null },
    { label: "Send Buttons / Flows", onClick: null, hint: "needs a Flow builder" },
  ];

  return (
    <div className="relative shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pb-4 pt-3">
      {/* ── Quick replies ── */}
      {panel === "quick" && (
        <Panel title="Quick replies" onClose={() => setPanel(null)}>
          {loading && <Empty>Loading…</Empty>}
          {!loading && quickReplies.length === 0 && (
            <Empty>No quick replies yet — add them in Settings.</Empty>
          )}
          {quickReplies.map((q) => (
            <button
              key={q.shortcut}
              type="button"
              onClick={() => {
                setDraft(q.body);
                setPanel(null);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-surface-2)]"
            >
              <span className="mt-0.5 flex-none rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-accent-ink)]">
                /{q.shortcut}
              </span>
              <span className="line-clamp-2 text-[12.5px] text-[var(--color-muted)]">{q.body}</span>
            </button>
          ))}
        </Panel>
      )}

      {/* ── Templates ── */}
      {panel === "template" && (
        <Panel
          title={chosen ? chosen.name : "Send a template"}
          onClose={() => {
            setPanel(null);
            setChosen(null);
          }}
        >
          {loading && <Empty>Loading approved templates…</Empty>}
          {!loading && !chosen && templates.length === 0 && (
            <Empty>
              No approved templates yet. Submit them on the Templates page — Meta review takes
              about 24 hours.
            </Empty>
          )}

          {!chosen &&
            templates.map((t) => (
              <button
                key={`${t.name}-${t.language}`}
                type="button"
                onClick={() => {
                  setChosen(t);
                  setParams(Array.from({ length: t.placeholders }, () => ""));
                }}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-surface-2)]"
              >
                <span className="font-mono text-[12px] text-[var(--color-ink)]">{t.name}</span>
                <span className="line-clamp-2 text-[12px] text-[var(--color-muted)]">{t.body}</span>
              </button>
            ))}

          {chosen && (
            <form action={sendTemplateMessage} className="px-1 pb-1">
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="templateName" value={chosen.name} />
              <input type="hidden" name="language" value={chosen.language} />
              <input type="hidden" name="params" value={params.join("\n")} />
              <input type="hidden" name="preview" value={renderPreview(chosen.body, params)} />

              {chosen.placeholders > 0 && (
                <div className="mb-2 space-y-1.5">
                  {params.map((v, i) => (
                    <input
                      key={i}
                      value={v}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      placeholder={`Value for {{${i + 1}}}`}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
                    />
                  ))}
                </div>
              )}

              <div className="mb-2 whitespace-pre-wrap rounded-lg bg-[var(--color-surface-2)] p-2.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                {renderPreview(chosen.body, params)}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChosen(null)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-muted)]"
                >
                  Back
                </button>
                <button
                  type="submit"
                  onClick={() => setTimeout(() => setPanel(null), 0)}
                  className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white"
                >
                  Send template
                </button>
              </div>
            </form>
          )}
        </Panel>
      )}

      {/* ── + menu ── */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute bottom-[68px] left-4 z-20 w-64 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
            {menuItems.map((m) => (
              <button
                key={m.label}
                type="button"
                disabled={!m.onClick}
                onClick={() => m.onClick?.()}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:text-[var(--color-faint)] disabled:hover:bg-transparent"
              >
                {m.label}
                {m.hint && <span className="text-[10.5px] text-[var(--color-faint)]">{m.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mb-2 flex items-center gap-4 text-[12.5px] font-medium">
        <button
          onClick={() => setKind("reply")}
          className={`border-b-2 pb-1 transition-colors ${
            !note
              ? "border-[var(--color-accent)] text-[var(--color-ink)]"
              : "border-transparent text-[var(--color-muted)]"
          }`}
        >
          Reply
        </button>
        <button
          onClick={() => setKind("note")}
          className={`border-b-2 pb-1 transition-colors ${
            note
              ? "border-[var(--color-accent)] text-[var(--color-ink)]"
              : "border-transparent text-[var(--color-muted)]"
          }`}
        >
          Private note
        </button>
      </div>

      <form
        ref={formRef}
        action={async (fd) => {
          await sendMessage(fd);
          setDraft("");
          formRef.current?.reset();
        }}
        className={`flex items-end gap-2 rounded-xl border px-3 py-2 ${
          note
            ? "border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[var(--color-accent-soft)]/40"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)]"
        }`}
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="kind" value={kind} />
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="More"
          className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
        >
          <IconPaperclip width={16} height={16} />
        </button>
        <textarea
          name="body"
          rows={1}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            // "/" on an empty composer opens quick replies — the shortcut the
            // placeholder has always advertised and never implemented.
            if (v === "/") {
              setDraft("");
              void openQuick();
              return;
            }
            setDraft(v);
          }}
          placeholder={
            note ? "Write an internal note (not sent to customer)…" : "Type a message · / for quick replies"
          }
          className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90"
          aria-label="Send"
        >
          <IconSend width={17} height={17} />
        </button>
      </form>
    </div>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute bottom-[calc(100%-8px)] left-4 right-4 z-20 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-card">
      <div className="mb-1 flex items-center justify-between px-1.5 py-1">
        <span className="text-[12px] font-semibold text-[var(--color-ink)]">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
        >
          Close
        </button>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-6 text-center text-[12px] text-[var(--color-faint)]">{children}</p>;
}
