"use client";

// What a customer sees about the business for one number, edited in place.
//
// Loaded on demand rather than with the page: the profile is one Graph call per
// number, and the page is mostly visited to check a number's status.
//
// The photo is ONE button that opens the picker and uploads what is picked. It
// used to be the browser's own file control plus a separate "Upload photo"
// button that stayed disabled until a file was chosen — and Tailwind's reset
// strips the file control's button styling, so "Choose File" rendered as plain
// text next to the only real-looking button, which did nothing. On 2026-09-14
// that was reported as "tidak boleh mengupload gambar", with no upload attempt
// on record. The same pattern the inbox composer uses: a hidden input, opened
// from a real button.

import { useRef, useState, useTransition } from "react";
import { SearchableSelect } from "@/components/SearchableSelect";
import type { WabaNumber } from "@/lib/whatsapp/numbers";
import {
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
  PROFILE_FIELD_LABELS,
  PROFILE_LIMITS,
  VERTICALS,
  type BusinessProfile,
  type ProfileInput,
} from "@/lib/whatsapp/profile-limits";
import {
  loadBusinessProfile,
  saveBusinessProfile,
  submitDisplayName,
  uploadBusinessPhoto,
} from "./profile-actions";

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]";
const btnCls =
  "rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";
const ghostBtnCls =
  "rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40";

type NoteValue = { ok: boolean; text: string } | null;
type Doing = "load" | "save" | "photo" | "name";

/**
 * When the action itself cannot be reached (connection dropped, or the app was
 * updated since the page was opened), say so here instead of letting the throw
 * take the whole page down.
 */
const UNREACHABLE =
  "Connect could not be reached, so nothing was changed. Check the internet connection and try again — if it keeps happening, reload the page.";

function Note({ r }: { r: NoteValue }) {
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

/** "the about line", "the about line and address", "the about line, address and email". */
function fieldList(fields: (keyof ProfileInput)[]): string {
  const names = fields.map((f) => PROFILE_FIELD_LABELS[f]);
  if (names.length <= 1) return `the ${names[0] ?? "profile"}`;
  return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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
  // The picked photo, shown while it uploads and until Meta hands back its own URL.
  const [preview, setPreview] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [pendingName, setPendingName] = useState<{ name: string | null; status: string | null }>({
    name: n.newDisplayName,
    status: n.newNameStatus,
  });
  const [loadNote, setLoadNote] = useState<NoteValue>(null);
  const [saveNote, setSaveNote] = useState<NoteValue>(null);
  const [photoNote, setPhotoNote] = useState<NoteValue>(null);
  const [nameNote, setNameNote] = useState<NoteValue>(null);
  const [pending, start] = useTransition();
  const [doing, setDoing] = useState<Doing | null>(null);
  const busy = pending ? doing : null;

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

  /** Run one action at a time; if it cannot be reached, the note says so. */
  function act(what: Doing, note: (v: NoteValue) => void, fn: () => Promise<void>) {
    setDoing(what);
    note(null);
    start(async () => {
      try {
        await fn();
      } catch {
        note({ ok: false, text: UNREACHABLE });
      }
    });
  }

  function openEditor() {
    setOpen(true);
    act("load", setLoadNote, async () => {
      const r = await loadBusinessProfile(n.id);
      if (r.ok && r.profile) fill(r.profile);
      else setLoadNote({ ok: false, text: r.error ?? "Meta did not return this number's profile." });
    });
  }

  function showPreview(url: string | null) {
    if (previewUrl.current && previewUrl.current !== url) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = url;
    setPreview(url);
  }

  function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Cleared so that picking the same file again, after a refusal, still fires.
    e.target.value = "";
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      setPhotoNote({ ok: false, text: "That file is not a JPEG or PNG photo. Choose a .jpg or .png." });
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setPhotoNote({
        ok: false,
        text: `That photo is ${(file.size / 1048576).toFixed(1)} MB. It must be 5 MB or smaller.`,
      });
      return;
    }
    const local = URL.createObjectURL(file);
    showPreview(local);
    const fd = new FormData();
    fd.append("phoneId", n.id);
    fd.append("photo", file);
    act("photo", setPhotoNote, async () => {
      try {
        const r = await uploadBusinessPhoto(fd);
        if (r.ok && r.profile) fill(r.profile);
        // Keep showing the picked photo if Meta has not produced its URL yet.
        showPreview(r.ok && !r.profile?.profilePictureUrl ? local : null);
        setPhotoNote(
          r.ok
            ? { ok: true, text: "Photo updated on WhatsApp. Customers see it the next time they open this business." }
            : { ok: false, text: r.error ?? "Meta refused the photo and gave no reason." }
        );
      } catch (err) {
        showPreview(null);
        throw err;
      }
    });
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

  const photoUrl = preview ?? profile?.profilePictureUrl ?? null;

  return (
    <div className="mt-3 space-y-4 border-t border-[var(--color-border)] pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <label className={labelCls}>Business profile — what customers see</label>
        <button type="button" className="text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {busy === "load" && !profile && <p className="text-[12.5px] text-[var(--color-muted)]">Asking Meta for the current profile…</p>}
      <Note r={loadNote} />

      {profile && (
        <>
          {/* Photo */}
          <div className="flex flex-wrap items-center gap-4">
            {photoUrl ? (
              // Meta-hosted and short-lived (or the picked file, while it uploads); shown, never stored.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Profile photo"
                className={`h-16 w-16 rounded-full border border-[var(--color-border)] object-cover ${busy === "photo" ? "opacity-60" : ""}`}
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
                The photo you choose is sent to WhatsApp straight away.
              </p>
              <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png"
                onChange={onPhotoPicked}
                className="hidden"
                tabIndex={-1}
                aria-hidden
              />
              <button
                type="button"
                className={`${btnCls} mt-2`}
                disabled={pending}
                onClick={() => photoInput.current?.click()}
              >
                {busy === "photo" ? "Uploading…" : profile.profilePictureUrl ? "Change photo…" : "Choose photo…"}
              </button>
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
              <SearchableSelect
                className={`${inputCls} mt-1`}
                value={vertical}
                onChange={(v) => setVertical(v)}
                aria-label="Category"
                options={[
                  { value: "", label: "Not set" },
                  ...VERTICALS.map((v) => ({ value: v.value, label: v.label })),
                ]}
              />
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
              onClick={() =>
                act("save", setSaveNote, async () => {
                  const r = await saveBusinessProfile(n.id, {
                    about,
                    description,
                    address,
                    email,
                    websites: [site1, site2],
                    vertical,
                  });
                  if (r.ok && r.profile) fill(r.profile);
                  setSaveNote(
                    !r.ok
                      ? { ok: false, text: r.error ?? "Meta refused and gave no reason." }
                      : r.changed?.length
                        ? { ok: true, text: `Saved ${fieldList(r.changed)}. This is now what customers see for this number.` }
                        : { ok: true, text: "Nothing to save — every field already matches what customers see." }
                  );
                })
              }
            >
              {busy === "save" ? "Saving…" : "Save profile"}
            </button>
            <p className="mt-1 text-[11px] text-[var(--color-faint)]">
              Only the fields you change are sent to WhatsApp; the rest stay as they are.
            </p>
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
                onClick={() =>
                  act("name", setNameNote, async () => {
                    const r = await submitDisplayName(n.id, newName);
                    if (r.ok) setPendingName({ name: r.newDisplayName ?? newName.trim(), status: r.newNameStatus ?? null });
                    setNameNote({
                      ok: r.ok,
                      text: r.ok
                        ? `Submitted for review${r.newNameStatus ? ` — Meta reports ${r.newNameStatus}` : ""}.`
                        : (r.error ?? "Meta refused and gave no reason."),
                    });
                  })
                }
              >
                {busy === "name" ? "Submitting…" : "Submit for review"}
              </button>
            </div>
            <Note r={nameNote} />
          </div>
        </>
      )}
    </div>
  );
}
