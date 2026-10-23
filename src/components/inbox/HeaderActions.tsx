"use client";

// The thread header's two buttons. They used to be the "Assigned agent" and
// "Status" dropdowns halfway down the right panel; handing a conversation on
// and finishing it are the two things an agent does to almost every thread, so
// they sit next to the customer's name now.

import { useEffect, useRef, useState } from "react";
import { assignConversation, setConversationStatus } from "@/app/actions";
import { useShell } from "@/components/shell/ShellProvider";
import { SearchableSelect } from "@/components/SearchableSelect";

type Named = { id: string; name: string };

const selectCls =
  "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";

export const secondaryBtn =
  "flex h-[34px] items-center whitespace-nowrap rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]";
export const primaryBtn =
  "flex h-[34px] items-center whitespace-nowrap rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-[var(--color-accent-hi)]";

export function AssignButton({
  conversationId,
  agentId,
  departmentId,
  members,
  departments,
}: {
  conversationId: string;
  agentId: string | null;
  departmentId: string | null;
  members: Named[];
  departments: Named[];
}) {
  const { t } = useShell();
  const s = t.service;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={secondaryBtn}>
        {s.assign}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 flex w-64 flex-col gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-popover)]">
          <form action={assignConversation} className="flex flex-col gap-1.5">
            <input type="hidden" name="conversationId" value={conversationId} />
            <label className="text-[12px] font-semibold text-[var(--color-ink)]">{s.agent}</label>
            <SearchableSelect
              name="assignedAgentId"
              defaultValue={agentId ?? ""}
              submitOnChange
              aria-label={s.agent}
              className={selectCls}
              options={[
                { value: "", label: s.unassignedOpt },
                ...members.map((m) => ({ value: m.id, label: m.name })),
              ]}
            />
          </form>
          <form action={assignConversation} className="flex flex-col gap-1.5">
            <input type="hidden" name="conversationId" value={conversationId} />
            <label className="text-[12px] font-semibold text-[var(--color-ink)]">{s.department}</label>
            <SearchableSelect
              name="assignedDepartmentId"
              defaultValue={departmentId ?? ""}
              submitOnChange
              aria-label={s.department}
              className={selectCls}
              options={[
                { value: "", label: s.none },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </form>
        </div>
      )}
    </div>
  );
}

/** Resolve closes the conversation; on a closed one the same spot reopens it. */
export function ResolveButton({ conversationId, closed }: { conversationId: string; closed: boolean }) {
  const { t } = useShell();
  return (
    <form action={setConversationStatus}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="status" value={closed ? "OPEN" : "CLOSED"} />
      <button type="submit" className={closed ? secondaryBtn : primaryBtn}>
        {closed ? t.service.reopen : t.service.resolve}
      </button>
    </form>
  );
}
