"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { addChannelMembers, decideJoinRequest, leaveChannel, removeChannelMember, setChannelRole } from "./actions";
import type { ChannelMember } from "./data";
import { Avatar } from "./parts";

type Person = { id: string; name: string; photo: string | null };

/**
 * The members chip in a channel's header and the dialog it opens: who is in,
 * requests to join (approve / decline), and for whoever manages the channel,
 * add people, remove them and make admins. Everyone can leave.
 */
export function MembersDialog({
  channelId,
  members,
  people,
  photos,
  meId,
  canManage,
  faces,
}: {
  channelId: string;
  members: ChannelMember[];
  /** Everyone in the company, for Add members. */
  people: Person[];
  photos: Record<string, string | null>;
  meId: string;
  canManage: boolean;
  /** Up to three members shown in the chip. */
  faces: Person[];
}) {
  const { t } = useShell();
  const L = t.internal;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const inChannel = members.filter((m) => m.state === "member");
  const waiting = members.filter((m) => m.state === "pending");
  const inIds = new Set(members.map((m) => m.id));
  const candidates = people.filter((p) => !inIds.has(p.id) && p.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const amMember = inChannel.some((m) => m.id === meId);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Could not do that.");
      setError(null);
      after?.();
      router.refresh();
    });

  const small = "h-[26px] rounded-[6px] px-2 text-[11.5px] font-semibold disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative hidden items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-surface-2)] md:flex"
      >
        <span className="flex -space-x-1.5">
          {faces.map((p) => (
            <span key={p.id} className="rounded-full ring-2 ring-white">
              <Avatar name={p.name} photo={p.photo} size={20} />
            </span>
          ))}
        </span>
        <span className="text-[12.5px] text-[var(--color-muted)]">{fmt(L.members, { n: inChannel.length })}</span>
        {canManage && waiting.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--color-warning)] px-1 text-[10.5px] font-bold text-white">
            {waiting.length}
          </span>
        )}
      </button>

      <ActionDialog open={open} title={L.membersTitle} subtitle={fmt(L.members, { n: inChannel.length })} onClose={() => setOpen(false)}>
        {canManage && waiting.length > 0 && (
          <section className="mb-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-warning)]">{fmt(L.requestsTitle, { n: waiting.length })}</div>
            <div className="flex flex-col gap-1">
              {waiting.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 rounded-[8px] bg-[var(--color-pastel-orange)] px-2.5 py-2">
                  <Avatar name={m.name} photo={photos[m.id] ?? null} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--color-ink)]">{m.name}</span>
                    {m.dept && <span className="block truncate text-[11px] text-[var(--color-faint)]">{m.dept}</span>}
                  </span>
                  <button type="button" disabled={busy} onClick={() => run(() => decideJoinRequest(channelId, m.id, true))} className={`${small} bg-[var(--color-accent)] text-white`}>
                    {L.approve}
                  </button>
                  <button type="button" disabled={busy} onClick={() => run(() => decideJoinRequest(channelId, m.id, false))} className={`${small} border border-[var(--color-border)] bg-white text-[var(--color-ink)]`}>
                    {L.decline}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {canManage && (
          <div className="mb-3">
            {!adding ? (
              <button type="button" onClick={() => setAdding(true)} className="text-[12.5px] font-semibold text-[var(--color-accent)]">
                + {L.addMembers}
              </button>
            ) : (
              <div className="rounded-[10px] border border-[var(--color-border)] p-2.5">
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={L.searchPeople}
                  className="mb-2 h-[32px] w-full rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
                />
                <div className="max-h-48 overflow-y-auto">
                  {candidates.length === 0 && <p className="px-1 py-2 text-[12px] text-[var(--color-faint)]">{L.noOneToAdd}</p>}
                  {candidates.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-1.5 py-1.5 hover:bg-[var(--color-surface-2)]">
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
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => { setAdding(false); setPicked(new Set()); }} className={`${small} border border-[var(--color-border)] text-[var(--color-ink)]`}>
                    {L.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={busy || picked.size === 0}
                    onClick={() => run(() => addChannelMembers(channelId, [...picked]), () => { setAdding(false); setPicked(new Set()); setFilter(""); })}
                    className={`${small} bg-[var(--color-accent)] text-white`}
                  >
                    {fmt(L.addN, { n: picked.size })}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          {inChannel.map((m) => (
            <div key={m.id} className="group flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5 hover:bg-[var(--color-surface-2)]">
              <Avatar name={m.name} photo={photos[m.id] ?? null} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-[var(--color-ink)]">{m.name}</span>
                  {m.role === "admin" && (
                    <span className="rounded-full bg-[var(--color-accent-soft)] px-1.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[var(--color-accent-ink)]">
                      {L.adminBadge}
                    </span>
                  )}
                  {m.id === meId && <span className="text-[11px] text-[var(--color-faint)]">{L.you}</span>}
                </span>
                {m.dept && <span className="block truncate text-[11px] text-[var(--color-faint)]">{m.dept}</span>}
              </span>
              {canManage && m.id !== meId && (
                <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => setChannelRole(channelId, m.id, m.role === "admin" ? "member" : "admin"))}
                    className={`${small} border border-[var(--color-border)] text-[var(--color-ink)]`}
                  >
                    {m.role === "admin" ? L.removeAdmin : L.makeAdmin}
                  </button>
                  <button type="button" disabled={busy} onClick={() => run(() => removeChannelMember(channelId, m.id))} className={`${small} text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]`}>
                    {L.remove}
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>

        {error && <p className="mt-3 text-[12px] text-[var(--color-danger)]">{error}</p>}

        {amMember && (
          <div className="mt-4 border-t border-[var(--color-border-subtle)] pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => leaveChannel(channelId), () => { setOpen(false); router.push("/internal"); })}
              className="text-[12.5px] font-semibold text-[var(--color-danger)] hover:underline disabled:opacity-50"
            >
              {L.leave}
            </button>
          </div>
        )}
      </ActionDialog>
    </>
  );
}
