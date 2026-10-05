"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import {
  addChannelMembers,
  decideJoinRequest,
  deleteChannel,
  leaveChannel,
  openDm,
  removeChannelMember,
  setChannelIcon,
  setChannelMuted,
  setChannelPermissions,
  setChannelRole,
  updateChannel,
} from "./actions";
import type { ChannelEvent, ChannelMember, SharedItems } from "./data";
import { Avatar } from "./parts";

type Person = { id: string; name: string; photo: string | null };
type Who = "all" | "admins";

export type InfoChannel = {
  id: string;
  name: string;
  topic: string | null;
  icon: string | null;
  access: "open" | "approval";
  permEdit: Who;
  permPost: Who;
  permAdd: Who;
  createdByName: string | null;
  createdAt: string;
  companyName: string | null;
  channelCount: number;
};

/** A channel's picture: its photo, or a "#" tile. */
export function ChannelIcon({ icon, size }: { icon: string | null; size: number }) {
  return icon ? (
    // eslint-disable-next-line @next/next/no-img-element -- a small data URL stored on the channel
    <img src={icon} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-ink)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      #
    </span>
  );
}

/** Text with its links clickable. */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-[var(--color-accent)] hover:underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

function Toggle({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-[var(--color-accent)]" : "bg-[#c3c9d3]"}`}
    >
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

/** Shrink a picked image to a 256px square JPEG data URL. */
async function toIcon(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Channel info, like a WhatsApp group's: photo, name and description (editable
 * by whoever the permissions allow), mute, the community, shared links and
 * conversations, group permissions, the members (add, approve, make admin,
 * remove, message), member changes, exit and delete.
 */
export function ChannelInfo({
  channel: c,
  members,
  photos,
  people,
  events,
  shared,
  meId,
  canManage,
  canEdit,
  canAdd,
  muted,
  closeHref,
}: {
  channel: InfoChannel;
  members: ChannelMember[];
  photos: Record<string, string | null>;
  people: Person[];
  events: ChannelEvent[];
  shared: SharedItems;
  meId: string;
  canManage: boolean;
  canEdit: boolean;
  canAdd: boolean;
  muted: boolean;
  closeHref: string;
}) {
  const { t } = useShell();
  const L = t.internal;
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState<string | null>(null);
  const [moreTopic, setMoreTopic] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [memberQ, setMemberQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [addQ, setAddQ] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);
  const membersRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    const id = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("click", close);
    };
  }, [menuFor]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, after?: (res: { ok: boolean; id?: string }) => void) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Could not do that.");
      setError(null);
      after?.(res);
      router.refresh();
    });

  const inChannel = members.filter((m) => m.state === "member");
  const waiting = members.filter((m) => m.state === "pending");
  const admins = inChannel.filter((m) => m.role === "admin");
  const inIds = new Set(members.map((m) => m.id));
  const shownMembers = inChannel.filter((m) => m.name.toLowerCase().includes(memberQ.trim().toLowerCase()));
  const candidates = people.filter((p) => !inIds.has(p.id) && p.name.toLowerCase().includes(addQ.trim().toLowerCase()));
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep");
  const eventText = (e: ChannelEvent) =>
    fmt(L.ev[e.action as keyof typeof L.ev] ?? e.action, { a: e.actor ?? L.someone, t: e.target ?? L.someone, d: e.detail ?? "" });

  const section = "border-t-[6px] border-[var(--color-canvas)] px-5 py-4";
  const rowBtn = "flex w-full items-center gap-3 rounded-[8px] px-2 py-2.5 text-left text-[13.5px] hover:bg-[var(--color-surface-2)]";
  const action =
    "flex h-[60px] w-[72px] flex-col items-center justify-center gap-1 rounded-[12px] bg-[var(--color-surface-2)] text-[11.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-dim)] disabled:opacity-50";

  return (
    <aside className="flex w-full shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] lg:w-[360px]">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-4">
        <Link href={closeHref} scroll={false} aria-label={L.close} className="grid h-8 w-8 place-items-center rounded-[6px] text-[18px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
          ×
        </Link>
        <span className="text-[15px] font-semibold text-[var(--color-ink)]">{L.infoTitle}</span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {/* Photo, name, members */}
        <div className="flex flex-col items-center px-5 pb-4 pt-6 text-center">
          <button
            type="button"
            disabled={!canEdit || busy}
            onClick={() => fileRef.current?.click()}
            className="group relative rounded-full disabled:cursor-default"
            title={canEdit ? L.changePhoto : undefined}
          >
            <ChannelIcon icon={c.icon} size={96} />
            {canEdit && (
              <span className="absolute inset-0 hidden place-items-center rounded-full bg-black/40 text-[11px] font-semibold text-white group-hover:grid">{L.changePhoto}</span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const data = await toIcon(f);
                run(() => setChannelIcon(c.id, data));
              } catch {
                setError(L.photoFailed);
              }
            }}
          />
          {canEdit && c.icon && (
            <button type="button" disabled={busy} onClick={() => run(() => setChannelIcon(c.id, null))} className="mt-1 text-[11.5px] text-[var(--color-faint)] hover:underline">
              {L.removePhoto}
            </button>
          )}

          {editName === null ? (
            <div className="mt-3 flex items-center gap-2">
              <h2 className="text-[19px] font-semibold text-[var(--color-ink)]"># {c.name}</h2>
              {canEdit && (
                <button type="button" onClick={() => setEditName(c.name)} aria-label={L.editName} className="text-[14px] text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                  ✎
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 flex w-full gap-2">
              <input
                autoFocus
                value={editName}
                maxLength={40}
                onChange={(e) => setEditName(e.target.value)}
                className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-accent)] px-2.5 text-[14px] outline-none"
              />
              <button
                type="button"
                disabled={busy || !editName.trim()}
                onClick={() => run(() => updateChannel(c.id, editName, c.topic ?? ""), () => setEditName(null))}
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
              >
                {L.save}
              </button>
              <button type="button" onClick={() => setEditName(null)} className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-2.5 text-[12.5px]">
                {L.cancel}
              </button>
            </div>
          )}
          <p className="mt-1 text-[13px] text-[var(--color-muted)]">
            {fmt(L.channelIn, { co: c.companyName ?? "" })} ·{" "}
            <button type="button" onClick={() => membersRef.current?.scrollIntoView({ behavior: "smooth" })} className="font-semibold text-[var(--color-accent)] hover:underline">
              {fmt(L.members, { n: inChannel.length })}
            </button>
          </p>
          <span
            className={`mt-2 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] ${
              c.access === "approval" ? "bg-[var(--color-pastel-orange)] text-[var(--color-warning)]" : "bg-[var(--color-success-soft)] text-[var(--color-success)]"
            }`}
          >
            {c.access === "approval" ? L.badgeApproval : L.badgeOpen}
          </span>

          <div className="mt-4 flex gap-2">
            {canAdd && (
              <button
                type="button"
                className={action}
                onClick={() => {
                  setAdding(true);
                  membersRef.current?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className="text-[17px]">＋</span>
                {L.add}
              </button>
            )}
            <button type="button" className={action} onClick={() => setSearching((v) => !v)}>
              <span className="text-[16px]">⌕</span>
              {L.searchShort}
            </button>
            <button type="button" className={action} disabled={busy} onClick={() => run(() => setChannelMuted(c.id, !muted))}>
              <span className="text-[15px]">{muted ? "🔕" : "🔔"}</span>
              {muted ? L.unmute : L.mute}
            </button>
          </div>
          {searching && (
            <form
              className="mt-3 flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) router.push(`/internal/search?q=${encodeURIComponent(q.trim())}&c=${c.id}`);
              }}
            >
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={fmt(L.searchIn, { c: c.name })}
                className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
              />
            </form>
          )}
        </div>

        {/* Community */}
        <div className={section}>
          <Link href="/internal/browse" className="flex items-center gap-3 rounded-[10px] px-1 py-1 hover:bg-[var(--color-surface-2)]">
            <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-[#0b1020] text-[13px] font-bold text-white">HC</span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-[var(--color-ink)]">{c.companyName}</span>
              <span className="block text-[12px] text-[var(--color-faint)]">{fmt(L.community, { n: c.channelCount })}</span>
            </span>
          </Link>
        </div>

        {/* Description */}
        {(c.topic || canEdit) && (
          <div className={section}>
            {editTopic === null ? (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[12px] font-semibold text-[var(--color-faint)]">{L.description}</div>
                  {c.topic ? (
                    <>
                      <p className={`whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--color-ink)] ${moreTopic ? "" : "line-clamp-3"}`}>
                        <Linked text={c.topic} />
                      </p>
                      {c.topic.length > 140 && (
                        <button type="button" onClick={() => setMoreTopic((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-[var(--color-accent)]">
                          {moreTopic ? L.readLess : L.readMore}
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-[13px] text-[var(--color-faint)]">{L.addDescription}</p>
                  )}
                </div>
                {canEdit && (
                  <button type="button" onClick={() => setEditTopic(c.topic ?? "")} aria-label={L.editDescription} className="text-[14px] text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                    ✎
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  rows={4}
                  maxLength={1000}
                  value={editTopic}
                  onChange={(e) => setEditTopic(e.target.value)}
                  className="w-full resize-y rounded-[8px] border border-[var(--color-accent)] px-2.5 py-2 text-[13px] outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setEditTopic(null)} className="h-[30px] rounded-[8px] border border-[var(--color-border)] px-2.5 text-[12.5px]">
                    {L.cancel}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => updateChannel(c.id, c.name, editTopic), () => setEditTopic(null))}
                    className="h-[30px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
                  >
                    {L.save}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Shared links and conversations */}
        {(shared.links.length > 0 || shared.conversations.length > 0) && (
          <div className={section}>
            <div className="mb-2 text-[12px] font-semibold text-[var(--color-faint)]">{L.sharedTitle}</div>
            <div className="flex flex-col gap-1">
              {shared.conversations.slice(0, 6).map((cv) => (
                <Link key={cv.id} href={`/inbox/${cv.id}`} className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-[var(--color-surface-2)]">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[11px] text-[var(--color-accent)]">◌</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{cv.name}</span>
                  {cv.orderRef && <span className="text-[11.5px] font-semibold text-[var(--color-brand)]">{cv.orderRef}</span>}
                </Link>
              ))}
              {shared.links.slice(0, 6).map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] hover:bg-[var(--color-surface-2)]">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--color-pastel-blue)] text-[11px] text-[var(--color-pastel-blue-ink)]">↗</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-accent)]">{l.url.replace(/^https?:\/\//, "")}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Notifications */}
        <div className={section}>
          <div className="flex items-center gap-3">
            <span className="text-[15px]">🔔</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] text-[var(--color-ink)]">{L.muteTitle}</span>
              <span className="block text-[11.5px] text-[var(--color-faint)]">{L.muteHint}</span>
            </span>
            <Toggle on={muted} disabled={busy} label={L.muteTitle} onChange={(v) => run(() => setChannelMuted(c.id, v))} />
          </div>
        </div>

        {/* Group permissions */}
        {canManage && (
          <div className={section}>
            <div className="mb-2 text-[12px] font-semibold text-[var(--color-faint)]">{L.permsTitle}</div>
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{L.membersCan}</div>
            {(
              [
                ["edit", L.permEdit, L.permEditHint, c.permEdit === "all"],
                ["post", L.permPost, L.permPostHint, c.permPost === "all"],
                ["add", L.permAdd, L.permAddHint, c.permAdd === "all"],
              ] as const
            ).map(([k, title, hint, on]) => (
              <div key={k} className="flex items-start gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-[var(--color-ink)]">{title}</span>
                  <span className="block text-[11.5px] text-[var(--color-faint)]">{hint}</span>
                </span>
                <Toggle on={on} disabled={busy} label={title} onChange={(v) => run(() => setChannelPermissions(c.id, { [k]: v ? "all" : "admins" }))} />
              </div>
            ))}
            <div className="mb-1 mt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">{L.adminsCan}</div>
            <div className="flex items-start gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] text-[var(--color-ink)]">{L.permApprove}</span>
                <span className="block text-[11.5px] text-[var(--color-faint)]">{L.permApproveHint}</span>
              </span>
              <Toggle on={c.access === "approval"} disabled={busy} label={L.permApprove} onChange={(v) => run(() => setChannelPermissions(c.id, { approval: v }))} />
            </div>
            <div className="mt-2 rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2">
              <div className="text-[12.5px] font-semibold text-[var(--color-ink)]">{L.channelAdmins}</div>
              <div className="text-[12px] text-[var(--color-muted)]">{admins.length ? admins.map((a) => (a.id === meId ? L.youShort : a.name)).join(", ") : L.noAdmins}</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">{L.adminsHow}</div>
            </div>
          </div>
        )}

        {/* Members */}
        <div ref={membersRef} className={section}>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[12.5px] font-semibold text-[var(--color-faint)]">{fmt(L.members, { n: inChannel.length })}</span>
          </div>
          <input
            value={memberQ}
            onChange={(e) => setMemberQ(e.target.value)}
            placeholder={L.searchPeople}
            className="mb-2 h-[32px] w-full rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />

          {canAdd && !adding && (
            <button type="button" className={rowBtn} onClick={() => setAdding(true)}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent)] text-[16px] text-white">＋</span>
              <span className="font-medium text-[var(--color-ink)]">{L.addMembers}</span>
            </button>
          )}
          {adding && (
            <div className="mb-2 rounded-[10px] border border-[var(--color-border)] p-2.5">
              <input
                autoFocus
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                placeholder={L.searchPeople}
                className="mb-2 h-[32px] w-full rounded-[8px] border border-[var(--color-border)] px-2.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
              />
              <div className="max-h-56 overflow-y-auto">
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
                    <Avatar name={p.name} photo={p.photo} size={24} />
                    <span className="truncate text-[13px] text-[var(--color-ink)]">{p.name}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setPicked(new Set());
                  }}
                  className="h-[28px] rounded-[6px] border border-[var(--color-border)] px-2.5 text-[12px]"
                >
                  {L.cancel}
                </button>
                <button
                  type="button"
                  disabled={busy || picked.size === 0}
                  onClick={() =>
                    run(() => addChannelMembers(c.id, [...picked]), () => {
                      setAdding(false);
                      setPicked(new Set());
                      setAddQ("");
                    })
                  }
                  className="h-[28px] rounded-[6px] bg-[var(--color-accent)] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                  {fmt(L.addN, { n: picked.size })}
                </button>
              </div>
            </div>
          )}

          {canManage && waiting.length > 0 && (
            <div className="mb-2 rounded-[10px] bg-[var(--color-pastel-orange)] p-2">
              <div className="px-1 pb-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[var(--color-warning)]">{fmt(L.requestsTitle, { n: waiting.length })}</div>
              {waiting.map((m) => (
                <div key={m.id} className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1.5">
                  <Avatar name={m.name} photo={photos[m.id] ?? null} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--color-ink)]">{m.name}</span>
                    {m.dept && <span className="block truncate text-[11px] text-[var(--color-faint)]">{m.dept}</span>}
                  </span>
                  <button type="button" disabled={busy} onClick={() => run(() => decideJoinRequest(c.id, m.id, true))} className="h-[26px] rounded-[6px] bg-[var(--color-accent)] px-2 text-[11.5px] font-semibold text-white disabled:opacity-50">
                    {L.approve}
                  </button>
                  <button type="button" disabled={busy} onClick={() => run(() => decideJoinRequest(c.id, m.id, false))} className="h-[26px] rounded-[6px] border border-[var(--color-border)] bg-white px-2 text-[11.5px] font-semibold disabled:opacity-50">
                    {L.decline}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col">
            {shownMembers.map((m) => (
              <div key={m.id} className="relative flex items-center gap-3 rounded-[8px] px-2 py-2 hover:bg-[var(--color-surface-2)]">
                <Avatar name={m.name} photo={photos[m.id] ?? null} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-[var(--color-ink)]">{m.id === meId ? L.youShort : m.name}</span>
                  {m.dept && <span className="block truncate text-[11.5px] text-[var(--color-faint)]">{m.dept}</span>}
                </span>
                {m.role === "admin" && (
                  <span className="shrink-0 rounded-[6px] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--color-muted)]">{L.channelAdmin}</span>
                )}
                {m.id !== meId && (
                  <button
                    type="button"
                    aria-label={L.memberActions}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === m.id ? null : m.id);
                    }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[15px] text-[var(--color-muted)] hover:bg-[var(--color-surface-dim)]"
                  >
                    ⋯
                  </button>
                )}
                {menuFor === m.id && (
                  <div className="absolute right-2 top-11 z-30 w-48 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-popover)]">
                    <button
                      type="button"
                      className="w-full rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
                      onClick={() => run(() => openDm(m.id), (res) => res.id && router.push(`/internal/${res.id}`))}
                    >
                      {fmt(L.messageX, { name: m.name })}
                    </button>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="w-full rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
                          onClick={() => run(() => setChannelRole(c.id, m.id, m.role === "admin" ? "member" : "admin"))}
                        >
                          {m.role === "admin" ? L.removeAdmin : L.makeAdmin}
                        </button>
                        <button
                          type="button"
                          className="w-full rounded-[6px] px-2.5 py-1.5 text-left text-[13px] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                          onClick={() => run(() => removeChannelMember(c.id, m.id))}
                        >
                          {fmt(L.removeX, { name: m.name })}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Member changes, exit, delete */}
        <div className={section}>
          <button type="button" className={rowBtn} onClick={() => setShowEvents((v) => !v)}>
            <span className="w-5 text-center text-[var(--color-muted)]">☰</span>
            <span className="flex-1 text-[var(--color-ink)]">{L.memberChanges}</span>
            <span className="text-[var(--color-faint)]">{showEvents ? "▴" : "▾"}</span>
          </button>
          {showEvents && (
            <div className="mb-2 ml-9 flex flex-col gap-1.5">
              {events.length === 0 && <p className="text-[12px] text-[var(--color-faint)]">{L.noChanges}</p>}
              {events.map((e) => (
                <p key={e.id} className="text-[12px] text-[var(--color-muted)]">
                  <span className="text-[var(--color-ink)]">{eventText(e)}</span> · {when(e.at)}
                </p>
              ))}
            </div>
          )}
          <button type="button" className={`${rowBtn} text-[var(--color-danger)]`} onClick={() => setConfirm("leave")}>
            <span className="w-5 text-center">⇥</span>
            {L.leave}
          </button>
          {canManage && (
            <button type="button" className={`${rowBtn} text-[var(--color-danger)]`} onClick={() => setConfirm("delete")}>
              <span className="w-5 text-center">✕</span>
              {L.deleteChannel}
            </button>
          )}
          {error && <p className="mt-2 text-[12px] text-[var(--color-danger)]">{error}</p>}
          <p className="mt-3 text-[11.5px] text-[var(--color-faint)]">
            {c.createdByName ? fmt(L.createdBy, { name: c.createdByName, d: when(c.createdAt) }) : fmt(L.createdOn, { d: when(c.createdAt) })}
          </p>
        </div>
      </div>

      <ActionConfirm
        open={confirm !== null}
        title={confirm === "delete" ? fmt(L.deleteChannelTitle, { c: c.name }) : fmt(L.leaveTitle, { c: c.name })}
        confirmLabel={confirm === "delete" ? L.deleteChannel : L.leave}
        busy={busy}
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          run(() => (confirm === "delete" ? deleteChannel(c.id) : leaveChannel(c.id)), () => {
            setConfirm(null);
            router.push("/internal");
          })
        }
      >
        <p>{confirm === "delete" ? L.deleteChannelBody : L.leaveBody}</p>
      </ActionConfirm>
    </aside>
  );
}
