"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { IconDots } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { deleteForm, duplicateForm, setFormStatus, updateForm } from "./actions";
import { FIELD_TYPES, fieldTypeLabel, keyFromLabel, type FieldType, type FormField } from "./fields";

/*
  One form: its questions as rows (open a row to edit it), the "In use" switch,
  and the customer's phone showing the form as they will see it. Each row has a
  `uid` that is only a React key — the saved-as key changes while typing, and
  keying on it made the input lose focus on every keystroke.
*/

interface Row extends FormField {
  uid: string;
}
let seq = 0;
const newUid = () => `q${++seq}`;

const TYPE_ICON: Record<FieldType, [string, string]> = {
  text: ["Aa", "blue"],
  number: ["#", "cyan"],
  date: ["▦", "orange"],
  select: ["☰", "purple"],
  email: ["@", "pink"],
  phone: ["☏", "green"],
};

const input =
  "h-[36px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";

export function FormBuilder({
  id,
  initialName,
  initialFields,
  published,
  responses,
  sub,
  answersHref,
}: {
  id: string;
  initialName: string;
  initialFields: FormField[];
  published: boolean;
  responses: number;
  /** "4 questions · made 2 weeks ago", already in the viewer's language. */
  sub: string;
  answersHref: string;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.tf;
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<Row[]>(() => initialFields.map((f) => ({ ...f, uid: newUid() })));
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const touch = () => {
    setDirty(true);
    setMsg(null);
  };
  const patch = (uid: string, p: Partial<Row>) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.uid !== uid) return r;
        const next = { ...r, ...p };
        // Keep saved-as in step with the question until someone types their own.
        if (p.label != null && (!r.key || r.key === keyFromLabel(r.label))) next.key = keyFromLabel(p.label);
        return next;
      })
    );
    touch();
  };
  const move = (uid: string, d: number) => {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.uid === uid);
      const j = i + d;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  };
  const add = () => {
    const uid = newUid();
    setRows((rs) => [...rs, { uid, key: "", label: "", type: "text" }]);
    setOpen(uid);
    touch();
  };

  const save = () =>
    start(async () => {
      const res = await updateForm(id, name, rows.map(({ key, label, type }) => ({ key, label, type })));
      if (!res.ok) return setMsg({ ok: false, text: res.error ?? "Could not save this form." });
      setDirty(false);
      setMsg({ ok: true, text: L.saved });
      router.refresh();
    });

  const toggle = () =>
    start(async () => {
      await setFormStatus(id, !published);
      router.refresh();
    });

  const preview = rows.filter((r) => r.label.trim() || r.key.trim());

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
            aria-label={L.formName}
            className="w-full max-w-[420px] rounded-[6px] bg-transparent text-[17px] font-semibold text-[var(--color-ink)] outline-none hover:bg-[var(--color-surface-2)] focus:bg-[var(--color-surface-2)]"
          />
          <div className="text-[12px] text-[var(--color-faint)]">{sub}</div>
        </div>
        {dirty && <span className="text-[12px] text-[var(--color-warning)]">{L.notSaved}</span>}
        {(dirty || pending) && (
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="flex h-[34px] items-center rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {L.save}
          </button>
        )}
        <button type="button" onClick={toggle} disabled={pending} className="flex items-center gap-2 text-[13px] font-semibold disabled:opacity-60">
          <span className={`relative h-[22px] w-[38px] rounded-full transition-colors ${published ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"}`}>
            <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${published ? "left-[19px]" : "left-[3px]"}`} />
          </span>
          <span className={published ? "text-[var(--color-success)]" : "text-[var(--color-muted)]"}>{published ? L.inUse : L.draft}</span>
        </button>
        <Link
          href={answersHref}
          className="flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          {L.answers}·{responses}
        </Link>
        <div className="relative">
          <button
            type="button"
            aria-label="More"
            onClick={() => setMenu(menu === "_form" ? null : "_form")}
            className="grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          >
            <IconDots width={15} height={15} />
          </button>
          {menu === "_form" && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
              <div className="absolute right-0 z-30 mt-1 w-40 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
                  onClick={() => {
                    setMenu(null);
                    start(async () => {
                      const res = await duplicateForm(id);
                      if (res.ok && "id" in res) router.push(`/forms?f=${res.id}`);
                    });
                  }}
                >
                  {t.autos.duplicate}
                </button>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                  onClick={() => {
                    setMenu(null);
                    setConfirm(true);
                  }}
                >
                  {L.delete}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          {msg && (
            <p className={`mb-3 text-[12.5px] ${msg.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>{msg.text}</p>
          )}
          {rows.length === 0 && (
            <p className="mb-3 rounded-[12px] border border-dashed border-[var(--color-border-strong)] px-4 py-8 text-center text-[12.5px] text-[var(--color-muted)]">
              {L.noQuestions}
            </p>
          )}
          <div className="flex flex-col gap-2.5">
            {rows.map((r, i) => {
              const [icon, tone] = TYPE_ICON[r.type];
              const expanded = open === r.uid;
              return (
                <div key={r.uid} className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <div
                    className="grid cursor-pointer grid-cols-[16px_36px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_30px] items-center gap-3 px-3 py-3"
                    onClick={() => setOpen(expanded ? null : r.uid)}
                  >
                    <span className="text-[13px] text-[var(--color-border-strong)]">⠿</span>
                    <span
                      className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-bold"
                      style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                    >
                      {icon}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] text-[var(--color-faint)]">{fmt(L.question, { n: i + 1 })}</span>
                      <span className="block truncate text-[13.5px] font-medium text-[var(--color-ink)]">{r.label || "—"}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] text-[var(--color-faint)]">{L.answerType}</span>
                      <span className="block truncate text-[13px] text-[var(--color-ink)]">{fieldTypeLabel(r.type)}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] text-[var(--color-faint)]">{L.savedTo}</span>
                      <span className="block truncate text-[12.5px] text-[var(--color-pastel-purple-ink)]">
                        {r.key.trim() || keyFromLabel(r.label) || "—"}
                      </span>
                    </span>
                    <span className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        aria-label="Actions"
                        onClick={() => setMenu(menu === r.uid ? null : r.uid)}
                        className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-dim)]"
                      >
                        <IconDots width={15} height={15} />
                      </button>
                      {menu === r.uid && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} />
                          <div className="absolute right-0 z-30 mt-1 w-36 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
                            {([
                              [L.moveUp, () => move(r.uid, -1), i > 0],
                              [L.moveDown, () => move(r.uid, 1), i < rows.length - 1],
                              [
                                L.remove,
                                () => {
                                  setRows((rs) => rs.filter((x) => x.uid !== r.uid));
                                  touch();
                                },
                                true,
                              ],
                            ] as [string, () => void, boolean][]).map(([l, fn, ok]) => (
                              <button
                                key={l}
                                type="button"
                                disabled={!ok}
                                onClick={() => {
                                  setMenu(null);
                                  fn();
                                }}
                                className={`block w-full px-3 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)] disabled:opacity-40 ${
                                  l === L.remove ? "text-[var(--color-danger)]" : "text-[var(--color-ink)]"
                                }`}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </span>
                  </div>
                  {expanded && (
                    <div className="grid gap-2 border-t border-[var(--color-border-subtle)] px-3 py-3 md:grid-cols-[1.6fr_1fr_1fr]">
                      <input autoFocus value={r.label} placeholder={L.askPh} onChange={(e) => patch(r.uid, { label: e.target.value })} className={input} />
                      <select value={r.type} onChange={(e) => patch(r.uid, { type: e.target.value as FieldType })} className={input}>
                        {FIELD_TYPES.map((ft) => (
                          <option key={ft.value} value={ft.value}>
                            {ft.label}
                          </option>
                        ))}
                      </select>
                      <input value={r.key} placeholder={L.keyPh} onChange={(e) => patch(r.uid, { key: e.target.value })} className={input} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={add}
            className="mt-2.5 h-[44px] w-full rounded-[12px] border border-dashed border-[var(--color-border-strong)] text-[13px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-surface)]"
          >
            + {L.addQuestion}
          </button>
          <p className="mt-3 text-[12px] text-[var(--color-faint)]">{L.formNote}</p>
        </div>

        <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[320px]">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">{L.preview}</div>
          <div className="flex h-[716px] flex-col overflow-hidden rounded-[30px] border-[8px] border-[#0b1020] bg-white shadow-[var(--shadow-modal)]">
            <div className="flex items-center border-b border-[var(--color-border)] px-3 py-3">
              <span className="text-[14px] text-[var(--color-muted)]">×</span>
              <span className="flex-1 text-center text-[13.5px] font-semibold text-[var(--color-ink)]">{name.trim() || "—"}</span>
              <span className="w-3" />
            </div>
            <div className="scroll-thin flex flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
              {preview.map((f) => (
                <div key={f.uid}>
                  <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--color-ink)]">{f.label || f.key}</div>
                  <div className="flex h-[36px] items-center justify-between rounded-[8px] border border-[var(--color-border)] px-2.5 text-[12px] text-[var(--color-faint)]">
                    {f.type === "date" ? "DD/MM/YYYY" : f.type === "select" ? L.chooseOne : L.typeAnswer}
                    {f.type === "select" && <span className="text-[9px]">▼</span>}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3">
              <div className="grid h-[40px] place-items-center rounded-full bg-[var(--color-accent)] text-[13.5px] font-semibold text-white">{L.submitForm}</div>
            </div>
          </div>
        </aside>
      </div>

      <ActionConfirm
        open={confirm}
        title={`${L.delete} “${name}”?`}
        confirmLabel={L.delete}
        busy={pending}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            await deleteForm(id);
            setConfirm(false);
            router.push("/forms");
            router.refresh();
          })
        }
      >
        <p>{fmt(L.answeredN, { n: responses })}</p>
      </ActionConfirm>
    </div>
  );
}
