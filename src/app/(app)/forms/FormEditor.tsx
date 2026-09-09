"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  FIELD_TYPES,
  keyFromLabel,
  type FieldType,
  type FormField,
} from "./fields";
import { FormPreview } from "./FormPreview";
import { updateForm } from "./actions";

/**
 * Edit a form's name and its questions, with the customer's view updating as
 * you type.
 *
 * Before this, a form's questions could only be set once, at creation, by
 * typing "key | label | type" lines into a textarea — there was no edit and no
 * save anywhere in the app. The pipe shorthand still works on the create box;
 * everything after that happens here, in labelled rows.
 *
 * Each row carries a `uid` that is only ever a React key. The attribute key can
 * change while the owner types, and using it as the React key made the input
 * lose focus on every keystroke.
 */

interface Row extends FormField {
  uid: string;
}

const newUid = () => `f_${Math.random().toString(36).slice(2, 9)}`;

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";

export function FormEditor({
  formId,
  initialName,
  initialFields,
}: {
  formId: string;
  initialName: string;
  initialFields: FormField[];
}) {
  const router = useRouter();
  // useState initialisers — nothing is written to state from an effect.
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<Row[]>(() =>
    initialFields.map((f) => ({ ...f, uid: newUid() }))
  );
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const touch = () => {
    setDirty(true);
    setMessage(null);
    setError(null);
  };

  const patchRow = (uid: string, patch: Partial<Row>) => {
    setRows((rs) =>
      rs.map((r) => {
        if (r.uid !== uid) return r;
        const next = { ...r, ...patch };
        // Keep the saved-attribute name in step with the question until the
        // owner types one himself.
        if (patch.label != null && (!r.key || r.key === keyFromLabel(r.label))) {
          next.key = keyFromLabel(patch.label);
        }
        return next;
      })
    );
    touch();
  };

  const addRow = () => {
    setRows((rs) => [...rs, { uid: newUid(), key: "", label: "", type: "text" }]);
    touch();
  };

  const removeRow = (uid: string) => {
    setRows((rs) => rs.filter((r) => r.uid !== uid));
    touch();
  };

  const moveRow = (uid: string, delta: number) => {
    setRows((rs) => {
      const i = rs.findIndex((r) => r.uid === uid);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  };

  const save = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await updateForm(
        formId,
        name,
        rows.map(({ key, label, type }) => ({ key, label, type }))
      );
      if (!res.ok) {
        setError(res.error ?? "Could not save this form.");
        return;
      }
      setDirty(false);
      setMessage("Saved.");
      router.refresh();
    });
  };

  // The preview shows what is on screen right now, blank rows dropped.
  const previewFields: FormField[] = rows
    .filter((r) => r.label.trim() || r.key.trim())
    .map((r) => ({
      key: r.key.trim() || keyFromLabel(r.label) || r.uid,
      label: r.label.trim() || r.key.trim(),
      type: r.type,
    }));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
              Questions
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
              What the customer is asked, and where each answer is filed.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-[11px] text-[var(--color-warning)]">
                Not saved yet
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="p-4">
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
            Form name
          </label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch();
            }}
            className={`${inputCls} mb-4`}
          />

          {rows.length === 0 && (
            <div className="mb-3 rounded-lg border border-dashed border-[var(--color-border-strong)] px-4 py-8 text-center text-[12px] text-[var(--color-muted)]">
              No questions yet. Add the first one below — the customer would open
              an empty form until you do.
            </div>
          )}

          <div className="flex flex-col gap-2">
            {rows.map((r, i) => (
              <div
                key={r.uid}
                className="rounded-lg border border-[var(--color-border)] p-2.5"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[var(--color-muted)]">
                    Question {i + 1}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => moveRow(r.uid, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="grid h-6 w-6 place-items-center rounded text-[12px] text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(r.uid, 1)}
                      disabled={i === rows.length - 1}
                      aria-label="Move down"
                      className="grid h-6 w-6 place-items-center rounded text-[12px] text-[var(--color-faint)] hover:bg-[var(--color-surface-2)] disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(r.uid)}
                      aria-label="Remove question"
                      className="grid h-6 w-6 place-items-center rounded text-[13px] text-[var(--color-faint)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <input
                  value={r.label}
                  onChange={(e) => patchRow(r.uid, { label: e.target.value })}
                  placeholder="What the customer is asked, e.g. Preferred delivery date"
                  className={`${inputCls} mb-1.5`}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={r.type}
                    onChange={(e) =>
                      patchRow(r.uid, { type: e.target.value as FieldType })
                    }
                    className={inputCls}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={r.key}
                    onChange={(e) => patchRow(r.uid, { key: e.target.value })}
                    placeholder="saved as…"
                    title="The contact detail this answer is filed under. Used by automations and campaigns."
                    className={`${inputCls} font-code`}
                  />
                </div>
                <p className="mt-1 text-[10.5px] text-[var(--color-faint)]">
                  {FIELD_TYPES.find((t) => t.value === r.type)?.hint} · answer is
                  filed on the contact as{" "}
                  <span className="font-code">
                    {r.key.trim() || keyFromLabel(r.label) || "—"}
                  </span>
                </p>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-2 w-full rounded-lg border border-dashed border-[var(--color-border-strong)] px-3 py-2 text-[12px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
          >
            + Add a question
          </button>

          {(message || error) && (
            <p
              className={`mt-3 text-[11.5px] ${
                error ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
              }`}
            >
              {error ?? message}
            </p>
          )}
        </div>
      </div>

      <div className="h-fit">
        <FormPreview name={name} fields={previewFields} />
      </div>
    </div>
  );
}
