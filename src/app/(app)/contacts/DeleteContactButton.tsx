"use client";

import { useState } from "react";
import { deleteContact } from "./actions";

/**
 * Delete a contact, behind a two-step confirm.
 *
 * Deleting takes the whole message history with it and there is no undo, so a
 * single mis-aimed click in a dense table must not be enough. The button turns
 * into "Sure?" and only the second click submits; clicking anything else, or
 * this button a third time, puts it back.
 */
export function DeleteContactButton({
  contactId,
  name,
}: {
  contactId: string;
  name: string;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        title={`Delete ${name} and their message history`}
        className="whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] hover:text-[var(--color-danger)]"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <form action={deleteContact}>
        <input type="hidden" name="id" value={contactId} />
        <button
          type="submit"
          className="whitespace-nowrap rounded-md bg-[var(--color-danger)] px-2 py-1 text-[11px] font-semibold text-white"
        >
          Sure?
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        Cancel
      </button>
    </span>
  );
}
