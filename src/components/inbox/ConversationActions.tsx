"use client";

import {
  assignConversation,
  setConversationStatus,
  toggleConversationTag,
} from "@/app/actions";

type Named = { id: string; name: string };
type NamedColor = { id: string; name: string; color: string };

function submitOnChange(e: React.ChangeEvent<HTMLSelectElement>) {
  e.currentTarget.form?.requestSubmit();
}

const selectCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";

export function ConversationActions({
  conversationId,
  members,
  departments,
  allTags,
  agentId,
  departmentId,
  status,
  activeTagNames,
}: {
  conversationId: string;
  members: Named[];
  departments: Named[];
  allTags: NamedColor[];
  agentId: string | null;
  departmentId: string | null;
  status: string;
  activeTagNames: string[];
}) {
  const active = new Set(activeTagNames);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Status</label>
        <form action={setConversationStatus}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <select name="status" defaultValue={status} onChange={submitOnChange} className={selectCls}>
            {["OPEN", "PENDING", "QUEUE", "CLOSED"].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </form>
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Assigned agent</label>
        <form action={assignConversation}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <select name="assignedAgentId" defaultValue={agentId ?? ""} onChange={submitOnChange} className={selectCls}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </form>
      </div>

      <div>
        <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Department</label>
        <form action={assignConversation}>
          <input type="hidden" name="conversationId" value={conversationId} />
          <select name="assignedDepartmentId" defaultValue={departmentId ?? ""} onChange={submitOnChange} className={selectCls}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </form>
      </div>

      <div>
        <label className="mb-1.5 block text-[11px] text-[var(--color-muted)]">Tags (click to toggle)</label>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const on = active.has(t.name);
            return (
              <form key={t.name} action={toggleConversationTag}>
                <input type="hidden" name="conversationId" value={conversationId} />
                <input type="hidden" name="tagId" value={t.id} />
                <input type="hidden" name="remove" value={on ? "1" : "0"} />
                <button
                  type="submit"
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium transition-opacity"
                  style={
                    on
                      ? { background: `${t.color}22`, color: t.color, opacity: 1 }
                      : { background: "var(--color-surface-2)", color: "var(--color-faint)" }
                  }
                >
                  {on ? "" : "+ "}
                  {t.name}
                </button>
              </form>
            );
          })}
        </div>
      </div>
    </div>
  );
}
