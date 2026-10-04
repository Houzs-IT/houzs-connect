"use client";

import { useState } from "react";
import { setContactStarred, updateContactProfile } from "@/app/(app)/contacts/actions";

/**
 * Edit the customer's name and email, and star them — Seampify's "Edit" and the
 * favourite on the profile panel.
 *
 * Naming matters more here than it looks: a WhatsApp contact often arrives with
 * no name at all (the webhook carries a profile name only when the customer has
 * set one, and a username account carries none), so the inbox falls back to the
 * raw identifier. Being able to type "Wong — Dunlopillo, Penang" is what turns
 * the rail from a list of numbers into a list of people.
 */
export function ProfileEditor({
  contactId,
  name,
  email,
  starred,
}: {
  contactId: string;
  name: string;
  email: string;
  starred: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex items-center justify-center gap-1">
      <form
        action={async (fd) => {
          setBusy(true);
          await setContactStarred(fd);
          setBusy(false);
        }}
      >
        <input type="hidden" name="contactId" value={contactId} />
        <input type="hidden" name="starred" value={starred ? "0" : "1"} />
        <button
          type="submit"
          disabled={busy}
          aria-pressed={starred}
          title={starred ? "Starred — click to unstar" : "Star this customer"}
          className={`rounded px-1 text-[13px] leading-none transition-colors disabled:opacity-50 ${
            starred
              ? "text-[var(--color-warning)]"
              : "text-[var(--color-faint)] hover:text-[var(--color-ink)]"
          }`}
        >
          {starred ? "★" : "☆"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-faint)] transition-[colors,opacity] ${open ? "" : "opacity-0 focus:opacity-100 group-hover/head:opacity-100"} hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]`}
      >
        {open ? "Close" : "Edit"}
      </button>

      {open && (
        <form
          action={async (fd) => {
            setBusy(true);
            await updateContactProfile(fd);
            setBusy(false);
            setOpen(false);
          }}
          className="absolute left-0 right-0 top-full z-20 mx-4 mt-1 space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left shadow-card"
        >
          <input type="hidden" name="contactId" value={contactId} />
          <div>
            <label className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
              Name
            </label>
            <input
              name="name"
              defaultValue={name}
              placeholder="e.g. Wong — Dunlopillo, Penang"
              className="mt-0.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
              Email
            </label>
            <input
              name="email"
              type="email"
              defaultValue={email}
              placeholder="name@example.com"
              className="mt-0.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      )}
    </div>
  );
}
