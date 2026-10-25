"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { createChannel, openDm } from "./actions";
import { AccessChoice } from "./ChannelMenu";
import { Avatar } from "./parts";

type Person = { id: string; name: string; online: boolean; photo: string | null; dept: string | null; division: string | null };

/** The pencil in the Internal menu: start a DM with a colleague, or make a channel. */
export function NewChat({ people }: { people: Person[] }) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.internal;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"dm" | "channel">("dm");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [access, setAccess] = useState<"open" | "approval">("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = (res: { ok: boolean; id?: string; error?: string }) => {
    if (!res.ok || !res.id) return setError(res.error ?? "Could not open it.");
    setOpen(false);
    router.push(`/internal/${res.id}`);
    router.refresh();
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setMany = (ids: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const countIn = (ids: string[]) => ids.reduce((k, id) => k + (picked.has(id) ? 1 : 0), 0);

  // The member picker, grouped by department and then by ERP division, so a
  // whole team can be ticked at once. Members with no division sit directly
  // under their department; members with no department fall in a last bucket.
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const visible = people.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const depts = new Map<string | null, { direct: Person[]; divisions: Map<string, Person[]> }>();
  for (const p of visible) {
    let g = depts.get(p.dept);
    if (!g) depts.set(p.dept, (g = { direct: [], divisions: new Map() }));
    if (p.division) g.divisions.set(p.division, [...(g.divisions.get(p.division) ?? []), p]);
    else g.direct.push(p);
  }
  const deptKeys = [...depts.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));

  const groupHeader = (label: string, ids: string[], sub: boolean) => {
    const sel = countIn(ids);
    return (
      <label className={`flex cursor-pointer items-center gap-2 bg-[var(--color-surface-2)] py-1 pr-2 ${sub ? "pl-6" : "pl-2"}`}>
        <input
          type="checkbox"
          aria-label={L.selectAll}
          title={L.selectAll}
          checked={ids.length > 0 && sel === ids.length}
          ref={(el) => {
            if (el) el.indeterminate = sel > 0 && sel < ids.length;
          }}
          onChange={(e) => setMany(ids, e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        <span className={`truncate font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)] ${sub ? "text-[10.5px]" : "text-[11px]"}`}>
          {label}
        </span>
        <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-[var(--color-faint)]">
          {sel}/{ids.length}
        </span>
      </label>
    );
  };
  const personRow = (p: Person, deep: boolean) => (
    <label key={p.id} className={`flex cursor-pointer items-center gap-2.5 py-1.5 pr-2 hover:bg-[var(--color-surface-2)] ${deep ? "pl-9" : "pl-5"}`}>
      <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="accent-[var(--color-accent)]" />
      <Avatar name={p.name} photo={p.photo} size={22} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)]">{p.name}</span>
      {p.online && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-success)]" title={L.online} />}
    </label>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={L.newChat}
        title={L.newChat}
        className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        ✎
      </button>
      <ActionDialog open={open} title={L.newChat} onClose={() => setOpen(false)}>
        <div className="mb-3 flex rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-1">
          {(["dm", "channel"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`h-[30px] flex-1 rounded-[7px] text-[13px] font-semibold ${
                tab === k ? "bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[0_1px_2px_rgba(17,23,34,0.08)]" : "text-[var(--color-muted)]"
              }`}
            >
              {k === "dm" ? L.startDm : L.newChannel}
            </button>
          ))}
        </div>
        {tab === "dm" ? (
          <>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={L.search}
              className="mb-2 h-[36px] w-full rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            <div className="max-h-72 overflow-y-auto">
              {people
                .filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => go(await openDm(p.id)))}
                    className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
                  >
                    <Avatar name={p.name} photo={p.photo} size={26} />
                    <span className="flex-1 truncate text-[var(--color-ink)]">{p.name}</span>
                    {p.online && <span className="h-2 w-2 rounded-full bg-[var(--color-success)]" title={L.online} />}
                  </button>
                ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={L.channelName}
              className="h-[36px] w-full rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={L.topic}
              className="h-[36px] w-full rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            <AccessChoice value={access} onChange={setAccess} />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-[var(--color-ink)]">{L.pickMembers}</span>
                <span className="text-[11.5px] text-[var(--color-faint)]">{picked.size ? `${picked.size} ✓` : L.youAreAdmin}</span>
              </div>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={L.searchPeople}
                className="mb-1.5 h-[32px] w-full rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
              />
              <div className="max-h-56 overflow-y-auto rounded-[8px] border border-[var(--color-border-subtle)]">
                {deptKeys.map((dk) => {
                  const g = depts.get(dk)!;
                  const direct = [...g.direct].sort(byName);
                  const divNames = [...g.divisions.keys()].sort((a, b) => a.localeCompare(b));
                  const allIds = [...direct, ...divNames.flatMap((d) => g.divisions.get(d)!)].map((p) => p.id);
                  return (
                    <div key={dk ?? "__none"}>
                      {groupHeader(dk ?? L.noDepartment, allIds, false)}
                      {direct.map((p) => personRow(p, false))}
                      {divNames.map((dn) => {
                        const mem = [...g.divisions.get(dn)!].sort(byName);
                        return (
                          <div key={dn}>
                            {groupHeader(dn, mem.map((p) => p.id), true)}
                            {mem.map((p) => personRow(p, true))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)]"
              >
                {L.cancel}
              </button>
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() => start(async () => go(await createChannel(name, topic, access, [...picked])))}
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {L.create}
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
      </ActionDialog>
    </>
  );
}
