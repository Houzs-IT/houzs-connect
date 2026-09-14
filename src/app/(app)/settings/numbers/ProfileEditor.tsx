"use client";

// What a customer sees about the business for one number, edited in place.
//
// Loaded on demand rather than with the page: the profile is one Graph call per
// number, and the page is mostly visited to check a number's status.

import { useState, useTransition } from "react";
import type { WabaNumber } from "@/lib/whatsapp/numbers";
import { PROFILE_LIMITS, VERTICALS, type BusinessProfile } from "@/lib/whatsapp/profile-limits";
import {
  loadBusinessProfile,
  saveBusinessProfile,
  submitDisplayName,
  uploadBusinessPhoto,
  type ProfileResult,
} from "./profile-actions";

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]";
const btnCls =
  "rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";
const ghostBtnCls =
  "rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40";

function Note({ r }: { r: { ok: boolean; text: string } | null }) {
  if (!r) return null;
  return (
    <p
      className={`mt-2 text-[12.5px] ${r.ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}
      role={r.ok ? "status" : "alert"}
    >
      {r.text}
    </p>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={`text-[11px] ${over ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"}`}>
      {value.length}/{max}
    </span>
  );
}

export function ProfileEditor({ n }: { n: WabaNumber }) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [about, setAbout] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [site1, setSite1] = useState("");
  const [site2, setSite2] = useState("");
  const [vertical, setVertical] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [newName, setNewName] = useState("");
  const [pendingName, setPendingName] = useState<{ name: string | null; status: string | null }>({
    name: n.newDisplayName,
    status: n.newNameStatus,
  });
  const [loadNote, setLoadNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [photoNote, setPhotoNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [nameNote, setNameNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function fill(p: BusinessProfile) {
    setProfile(p);
    setAbout(p.about);
    setDescription(p.description);
    setAddress(p.address);
    setEmail(p.email);
    setSite1(p.websites[0] ?? "");
    setSite2(p.websites[1] ?? "");
    setVertical(p.vertical);
  }

  function openEditor() {
    setOpen(true);
    setLoadNote(null);
    start(async () => {
      const r = await loadBusinessProfile(n.id);
      if (r.ok && r.profile) fill(r.profile);
      else setLoadNote({ ok: false, text: r.error ?? "Meta did not return this number's profile." });
    });
  }

  function after(r: ProfileResult, okText: string, set: (v: { ok: boolean; text: string }) => void) {
    if (r.ok && r.profile) fill(r.profile);
    set({ ok: r.ok, text: r.ok ? okText : (r.error ?? "Meta refused and gave no reason.") });
  }

  if (!open) {
    return (
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <label className={labelCls}>Business profile</label>
        <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">
          The photo, about line, description, address, email, websites and category customers see
          when they open this business in WhatsApp.
        </p>
        <button type="button" className={`${ghostBtnCls} mt-2`} onClick={openEditor}>
          Edit business profile
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <label className={labelCls}>Business profile — what customers see</label>
        <button type="button" className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {pending && !profile && <p className="text-[12.5px] text-[var(--color-muted)]">Asking Meta for the current profile…</p>}
      <Note r={loadNote} />

      {profile && (
        <>
          {/* Photo */}
          <div className="flex flex-wrap items-center gap-4">
            {profile.profilePictureUrl ? (
              // Meta-hosted and short-lived; shown, never stored.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.profilePictureUrl}
                alt="Current profile photo"
                className="h-16 w-16 rounded-full border border-[var(--color-border)] object-cover"
              />
            ) : (
              <div className="grid h-16 w-16 place-items-center rounded-full border border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-faint)]">
                no photo
              </div>
            )}
            <div>
              <label className={labelCls}>Profile photo</label>
              <p className="mt-1 text-[11px] text-[var(--color-faint)]">
                JPEG or PNG, up to 5 MB. A square image at least 640 × 640 looks best; WhatsApp crops it to a circle.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  className="text-[12px] text-[var(--color-muted)]"
                  aria-label="Choose a profile photo"
                />
                <button
                  type="button"
                  className={btnCls}
                  disabled={pending || !photo}
                  onClick={() => {
                    if (!photo) return;
                    setPhotoNote(null);
                    const fd = new FormData();
                    fd.append("phoneId", n.id);
                    fd.append("photo", photo);
                    start(async () => after(await uploadBusinessPhoto(fd), "Photo updated on WhatsApp.", setPhotoNote));
                  }}
                >
                  Upload photo
                </button>
              </div>
              <Note r={photoNote} />
            </div>
          </div>

          {/* Text fields */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="flex items-baseline justify-between">
                <label className={labelCls}>About</label>
                <Counter value={about} max={PROFILE_LIMITS.about} />
              </div>
              <input className={`${inputCls} mt-1`} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="One short line, e.g. Furniture & home living" />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-baseline justify-between">
                <label className={labelCls}>Description</label>
                <Counter value={description} max={PROFILE_LIMITS.description} />
              </div>
              <textarea className={`${inputCls} mt-1 min-h-20`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the business does, in a few sentences" />
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-baseline justify-between">
                <label className={labelCls}>Address</label>
                <Counter value={address} max={PROFILE_LIMITS.address} />
              </div>
              <textarea className={`${inputCls} mt-1 min-h-14`} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={`${inputCls} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select className={`${inputCls} mt-1`} value={vertical} onChange={(e) => setVertical(e.target.value)}>
                <option value="">Not set</option>
                {VERTICALS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Website 1</label>
              <input className={`${inputCls} mt-1`} value={site1} onChange={(e) => setSite1(e.target.value)} placeholder="https://" />
            </div>
            <div>
              <label className={labelCls}>Website 2</label>
              <input className={`${inputCls} mt-1`} value={site2} onChange={(e) => setSite2(e.target.value)} placeholder="https://" />
            </div>
          </div>
          <div>
            <button
              type="button"
              className={btnCls}
              disabled={pending}
              onClick={() => {
                setSaveNote(null);
                start(async () =>
                  after(
                    await saveBusinessProfile(n.id, {
                      about,
                      description,
                      address,
                      email,
                      websites: [site1, site2],
                      vertical,
                    }),
                    "Saved. This is now what customers see for this number.",
                    setSaveNote
                  )
                );
              }}
            >
              {pending ? "Saving…" : "Save profile"}
            </button>
            <Note r={saveNote} />
          </div>

          {/* Display name */}
          <div className="rounded-lg border border-[var(--color-border)] px-3 py-3">
            <label className={labelCls}>Display name</label>
            <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">
              Customers see <strong className="text-[var(--color-ink)]">{n.verifiedName ?? "no name"}</strong>
              {n.nameStatus ? ` (${n.nameStatus})` : ""}.
              {pendingName.name && (
                <>
                  {" "}
                  Waiting for Meta: <strong className="text-[var(--color-ink)]">{pendingName.name}</strong>
                  {pendingName.status ? ` (${pendingName.status})` : ""}.
                </>
              )}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
              A new name is reviewed by Meta before it shows. Once approved, the number must be registered again with its
              PIN within 14 days for the new name to take effect. Meta allows 10 name changes per 30 days.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={`${inputCls} max-w-xs`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New display name" />
              <button
                type="button"
                className={ghostBtnCls}
                disabled={pending || newName.trim().length < 3}
                onClick={() => {
                  setNameNote(null);
                  start(async () => {
                    const r = await submitDisplayName(n.id, newName);
                    if (r.ok) setPendingName({ name: r.newDisplayName ?? newName.trim(), status: r.newNameStatus ?? null });
                    setNameNote({
                      ok: r.ok,
                      text: r.ok
                        ? `Submitted for review${r.newNameStatus ? ` — Meta reports ${r.newNameStatus}` : ""}.`
                        : (r.error ?? "Meta refused and gave no reason."),
                    });
                  });
                }}
              >
                Submit for review
              </button>
            </div>
            <Note r={nameNote} />
          </div>
        </>
      )}
    </div>
  );
}
