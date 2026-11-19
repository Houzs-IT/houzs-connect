"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { setOrg } from "./actions";

type Option = { email: string; name: string };

/**
 * "Edit" beside Department for someone the Houzs ERP does not hold: department
 * (an existing name or a new one), division, and who they report to. Saved on
 * every company row of the person (actions.ts setOrg).
 */
export function OrgEdit({
  email,
  name,
  department,
  division,
  reportsToEmail,
  departments,
  people,
}: {
  email: string;
  name: string;
  department: string | null;
  division: string | null;
  reportsToEmail: string | null;
  /** Department names already in use, offered as suggestions. */
  departments: string[];
  people: Option[];
}) {
  const { t } = useShell();
  const L = t.set;
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [dept, setDept] = useState(department ?? "");
  const [div, setDiv] = useState(division ?? "");
  const [boss, setBoss] = useState(reportsToEmail ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const field = "h-[36px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]";
  const label = "mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDept(department ?? "");
          setDiv(division ?? "");
          setBoss(reportsToEmail ?? "");
          setError(null);
          setOpen(true);
        }}
        className="h-[24px] rounded-[6px] px-1.5 text-[12px] font-semibold text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
      >
        {L.orgEdit}
      </button>
      <ActionConfirm
        open={open}
        title={fmt(L.orgTitle, { name })}
        confirmLabel={L.orgSave}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            const res = await setOrg({ email, department: dept, division: div, reportsTo: boss });
            if (!res.ok) return setError(res.error ?? "Could not save.");
            setOpen(false);
            router.refresh();
          })
        }
      >
        <div className="flex flex-col gap-3 text-left">
          <label>
            <span className={label}>{L.department}</span>
            <input value={dept} onChange={(e) => setDept(e.target.value)} list={listId} maxLength={80} className={field} />
            <datalist id={listId}>
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
          <label>
            <span className={label}>{L.division}</span>
            <input value={div} onChange={(e) => setDiv(e.target.value)} maxLength={80} className={field} />
          </label>
          <label>
            <span className={label}>{L.reportsTo}</span>
            <select value={boss} onChange={(e) => setBoss(e.target.value)} className={field}>
              <option value="">{L.orgNobody}</option>
              {people
                .filter((p) => p.email.toLowerCase() !== email.toLowerCase())
                .map((p) => (
                  <option key={p.email} value={p.email}>
                    {p.name} · {p.email}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-[12px] text-[var(--color-faint)]">{L.orgHint}</p>
          {error && <p className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
        </div>
      </ActionConfirm>
    </>
  );
}
