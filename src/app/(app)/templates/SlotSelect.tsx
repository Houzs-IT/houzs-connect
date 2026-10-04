"use client";

import type { VarBinding } from "@/lib/automation/vars";
import { useShell } from "@/components/shell/ShellProvider";
import { decodeBinding, encodeBinding } from "./TemplateFields";
import type { FieldOption } from "./types";

/**
 * What one {{n}} is filled from: a built-in, a contact field, or fixed text.
 * Emits the whole next binding (or null when cleared).
 */
export function SlotSelect({
  index,
  binding,
  fields,
  onChange,
  className = "",
}: {
  index: number;
  binding: VarBinding | undefined;
  fields: FieldOption[];
  onChange: (next: VarBinding | null) => void;
  className?: string;
}) {
  const { t } = useShell();
  const L = t.tf;
  const sel =
    "h-[36px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <select
        aria-label={`{{${index}}}`}
        value={encodeBinding(binding)}
        onChange={(e) => onChange(decodeBinding(index, e.target.value, binding))}
        className={sel}
      >
        <option value="">{L.notMappedOpt}</option>
        {fields.map((f) => (
          <option key={`${f.builtin ? "builtin" : "field"}:${f.key}`} value={`${f.builtin ? "builtin" : "field"}:${f.key}`}>
            {f.name}
          </option>
        ))}
        <option value="literal">{L.fixedText}</option>
      </select>
      {binding?.source === "literal" && (
        <input
          value={binding.value ?? ""}
          onChange={(e) => onChange({ ...binding, value: e.target.value })}
          className={sel}
        />
      )}
    </div>
  );
}
