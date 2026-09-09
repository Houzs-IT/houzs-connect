"use client";

// Seampify's Contacts header: a +60-prefixed phone box with a Filter button, and
// Add Contact. The filter is a plain GET form, so the result is a real URL —
// refreshable, linkable, and it survives the revalidate after a block/unblock.
// Only the Add panel needs state, hence the one client component.

import { useState } from "react";
import Link from "next/link";
import { addContact } from "./actions";
import type { ImportField } from "./csv";
import { ImportContactsButton } from "./ImportContactsButton";

const inputCls =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]";
const labelCls = "mb-1 block text-[11px] text-[var(--color-muted)]";

export function ContactsToolbar({
  q,
  sort,
  dir,
  fields,
  tags,
}: {
  q: string;
  sort: string;
  dir: string;
  /** Custom fields a CSV column can be imported into. */
  fields: ImportField[];
  /** Existing tags, offered as suggestions when tagging an import. */
  tags: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        <form method="get" action="/contacts" className="flex items-center gap-2">
          {/* Filtering restarts at page 1, so `page` is deliberately not carried. */}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:border-[var(--color-accent)]">
            <span className="border-r border-[var(--color-border)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--color-faint)]">
              +60
            </span>
            <input
              name="q"
              defaultValue={q}
              inputMode="tel"
              placeholder="11-1110 8822"
              aria-label="Search by phone number"
              className="w-[190px] bg-transparent px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)]"
            />
          </div>
          <button className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white">
            Filter
          </button>
          {q && (
            <Link
              href="/contacts"
              className="px-1 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              Clear
            </Link>
          )}
        </form>

        {/* `ml-auto` lives on the import button now, so the pair sits together
            at the right-hand end of the row. */}
        <ImportContactsButton fields={fields} tags={tags} />

        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
        >
          {adding ? "Close" : "Add Contact"}
        </button>
      </div>

      {adding && (
        <form
          action={addContact}
          className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">New contact</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Name</label>
              <input name="name" placeholder="e.g. Lim Wei Ming" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input
                name="phone"
                required
                inputMode="tel"
                placeholder="011-1110 8822"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input name="email" type="email" placeholder="name@example.com" className={inputCls} />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-[var(--color-faint)]">
            Any format is fine — 011-1110 8822, +60 11-1110 8822 and 601111108822 all save as the
            same contact. An existing number is updated, not duplicated.
          </p>
          <button className="mt-3 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white">
            Save contact
          </button>
        </form>
      )}
    </div>
  );
}
