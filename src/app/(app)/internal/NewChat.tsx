"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { createChannel, openDm } from "./actions";
import { AccessChoice } from "./ChannelMenu";
import { Avatar } from "./parts";

/** The pencil in the Internal menu: start a DM with a colleague, or make a channel. */
export function NewChat({ people }: { people: { id: string; name: string; online: boolean; photo: string | null }[] }) {
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
              <div className="max-h-44 overflow-y-auto rounded-[8px] border border-[var(--color-border-subtle)]">
                {people
                  .filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()))
                  .map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5 px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                      <input
                        type="checkbox"
                        checked={picked.has(p.id)}
                        onChange={() =>
                          setPicked((s) => {
                            const n = new Set(s);
                            if (n.has(p.id)) n.delete(p.id);
                            else n.add(p.id);
                            return n;
                          })
                        }
                        className="accent-[var(--color-accent)]"
                      />
                      <Avatar name={p.name} photo={p.photo} size={22} />
                      <span className="truncate text-[13px] text-[var(--color-ink)]">{p.name}</span>
                    </label>
                  ))}
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
