"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/ShellProvider";
import { openDm } from "./actions";
import { Avatar } from "./parts";

type Person = { id: string; name: string; online: boolean; photo: string | null; dept: string | null };

/**
 * Everyone in the company, always on show under Direct messages (CONNECT-0003):
 * online first, then by name, with a filter once the list is long. A click opens
 * (or creates) the direct message with that person — the same openDm the pencil's
 * "New message" uses, so it stays within the company.
 */
export function PeopleList({ people, mobile = false }: { people: Person[]; mobile?: boolean }) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.internal;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const f = filter.trim().toLowerCase();
  const shown = people
    .filter((p) => !f || p.name.toLowerCase().includes(f) || (p.dept ?? "").toLowerCase().includes(f))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const onlineCount = people.filter((p) => p.online).length;

  const open = (id: string) => {
    setBusy(id);
    setError(null);
    start(async () => {
      const res = await openDm(id);
      setBusy(null);
      if (!res.ok || !res.id) return setError(res.error ?? "Could not open it.");
      router.push(`/internal/${res.id}`);
      router.refresh();
    });
  };

  const dot = (on: boolean, big: boolean) => (
    <span
      className={`absolute bottom-0 right-0 rounded-full border-2 border-white ${big ? "h-2.5 w-2.5" : "h-2 w-2 -bottom-0.5 -right-0.5 border"} ${
        on ? "bg-[var(--color-success)]" : "bg-[var(--color-border-strong)]"
      }`}
    />
  );

  return (
    <div className={mobile ? "" : "mt-1"}>
      <div className={`flex items-center justify-between ${mobile ? "px-4 pb-1.5 pt-4" : "px-2 pb-1 pt-3"}`}>
        <span className={`font-semibold uppercase tracking-[0.16em] text-[var(--color-faint)] ${mobile ? "text-[10.5px]" : "text-[10px]"}`}>
          {L.everyone} · {people.length}
        </span>
        {onlineCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-[var(--color-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
            {onlineCount}
          </span>
        )}
      </div>
      {people.length > 8 && (
        <div className={mobile ? "px-4 pb-2" : "px-1 pb-1"}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={L.searchPeople}
            aria-label={L.searchPeople}
            className="h-[30px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12.5px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
          />
        </div>
      )}
      {error && <p className="px-2 pb-1 text-[12px] text-[var(--color-danger)]">{error}</p>}
      {shown.map((p) =>
        mobile ? (
          <button
            key={p.id}
            type="button"
            onClick={() => open(p.id)}
            disabled={busy !== null}
            className="flex w-full items-center gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-3 text-left disabled:opacity-60"
          >
            <span className="relative shrink-0">
              <Avatar name={p.name} photo={p.photo} size={40} />
              {dot(p.online, true)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14.5px] font-semibold text-[var(--color-ink)]">{p.name}</span>
              {p.dept && <span className="block truncate text-[13px] text-[var(--color-muted)]">{p.dept}</span>}
            </span>
            <span className="text-[13px] font-semibold text-[var(--color-accent)]">{busy === p.id ? "…" : L.message}</span>
          </button>
        ) : (
          <button
            key={p.id}
            type="button"
            onClick={() => open(p.id)}
            disabled={busy !== null}
            title={p.dept ? `${p.name} · ${p.dept}` : p.name}
            className="group flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface)] disabled:opacity-60"
          >
            <span className="relative shrink-0">
              <Avatar name={p.name} photo={p.photo} size={20} />
              {p.online && dot(true, false)}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-[11.5px] font-semibold text-[var(--color-accent)] opacity-0 group-hover:opacity-100">
              {busy === p.id ? "…" : L.message}
            </span>
          </button>
        )
      )}
      {shown.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-[var(--color-faint)]">{L.noPeople}</p>}
    </div>
  );
}
