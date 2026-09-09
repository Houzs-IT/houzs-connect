"use client";

import { useState } from "react";
import { setContactRemarks } from "@/app/(app)/contacts/actions";

/**
 * The contact's free-text note, matching Seampify's "Remarks" on the profile
 * panel and in the contacts table.
 *
 * Save is explicit rather than on blur: this is the field an agent uses to write
 * "customer wants delivery after 6pm, gate code 1120", and a note that silently
 * discards itself because focus moved is worse than one that asks for a click.
 * The button only appears once the text differs from what is stored, so a panel
 * nobody edited stays quiet.
 */
export function RemarksBox({
  contactId,
  value,
}: {
  contactId: string;
  value: string;
}) {
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const dirty = text !== value;

  return (
    <form
      action={async (fd) => {
        setSaving(true);
        await setContactRemarks(fd);
        setSaving(false);
      }}
      className="space-y-1.5"
    >
      <input type="hidden" name="contactId" value={contactId} />
      <textarea
        name="remarks"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Anything the next person should know — delivery notes, preferences, history…"
        className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 text-[12.5px] leading-relaxed text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />
      {dirty && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11.5px] font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save remark"}
          </button>
          <button
            type="button"
            onClick={() => setText(value)}
            className="rounded-md px-2 py-1 text-[11.5px] font-medium text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            Cancel
          </button>
        </div>
      )}
    </form>
  );
}
