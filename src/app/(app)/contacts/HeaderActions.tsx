"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { addContact } from "./actions";
import type { ImportField } from "./csv";
import { ImportContactsButton } from "./ImportContactsButton";
import { useShell } from "@/components/shell/ShellProvider";
import { IconClose } from "@/components/icons";

const inputCls =
  "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";
const labelCls = "mb-1 block text-[12px] font-semibold text-[var(--color-ink)]";

/** Its own component so useFormStatus reports this form's pending state. */
function SaveButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-60"
    >
      {pending ? busy : label}
    </button>
  );
}

/** Contacts' Topbar buttons: Import CSV, and Add contact (a dialog). */
export function HeaderActions({
  fields,
  tags,
}: {
  /** Custom fields a CSV column can be imported into. */
  fields: ImportField[];
  /** Existing tags, offered when tagging an import. */
  tags: { id: string; name: string }[];
}) {
  const { t } = useShell();
  const s = t.contacts;
  const [adding, setAdding] = useState(false);
  const [addState, addAction] = useActionState(addContact, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (addState.ok) formRef.current?.reset();
  }, [addState]);

  return (
    <>
      <ImportContactsButton fields={fields} tags={tags} label={s.importCsv} />
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden sm:inline">{s.addContact}</span>
      </button>

      {adding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,16,32,0.45)] p-4" onClick={() => setAdding(false)}>
          <form
            ref={formRef}
            action={addAction}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] rounded-[16px] bg-[var(--color-surface)] shadow-[var(--shadow-modal)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-5 py-4">
              <span className="text-[15px] font-semibold text-[var(--color-ink)]">{s.addContact}</span>
              <button type="button" onClick={() => setAdding(false)} aria-label={s.close} className="grid h-8 w-8 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
                <IconClose width={16} height={16} />
              </button>
            </div>
            <div className="flex flex-col gap-3 px-5 py-4">
              <div>
                <label className={labelCls}>{s.colName}</label>
                <input name="name" placeholder="e.g. Lim Wei Ming" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input name="phone" required inputMode="tel" placeholder="011-1110 8822" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{s.colEmail}</label>
                <input name="email" type="email" placeholder="name@example.com" className={inputCls} />
              </div>
              <p className="text-[11.5px] text-[var(--color-faint)]">
                011-1110 8822, +60 11-1110 8822 and 601111108822 all save as the same contact. An existing number is
                updated, not duplicated.
              </p>
              {addState.ok && <p className="text-[12px] font-medium text-[var(--color-success)]">✓ {addState.saved}</p>}
              {addState.error && <p className="text-[12px] font-medium text-[var(--color-danger)]">{addState.error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-5 py-3">
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {s.close}
              </button>
              <SaveButton label={s.addContact} busy={s.working} />
            </div>
          </form>
        </div>
      )}
    </>
  );
}
