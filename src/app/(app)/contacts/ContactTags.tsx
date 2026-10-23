"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fmt } from "@/lib/i18n/dict";
import { setContactTag } from "./tag-actions";

type Tag = { id: string; name: string; color: string };

/** The tags on one contact in its detail panel: × takes one off, the picker adds one. */
export function ContactTags({ contactId, tags, all }: { contactId: string; tags: Tag[]; all: Tag[] }) {
  const { t } = useShell();
  const s = t.contacts;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const have = new Set(tags.map((x) => x.id));
  const addable = all.filter((x) => !have.has(x.id));

  const set = (tagId: string, on: boolean) =>
    start(async () => {
      const res = await setContactTag(contactId, tagId, on);
      setError(res.ok ? null : (res.error ?? "Could not save."));
      if (res.ok) router.refresh();
    });

  return (
    <div>
      <div className={`flex flex-wrap items-center gap-1.5 ${pending ? "opacity-60" : ""}`}>
        {tags.length === 0 && <span className="text-[12.5px] text-[var(--color-faint)]">{s.tagNone}</span>}
        {tags.map((tg) => (
          <span key={tg.id} className="inline-flex items-center gap-1 rounded-[5px] py-0.5 pl-2 pr-1 text-[11.5px] font-medium" style={{ background: `${tg.color}1f`, color: tg.color }}>
            {tg.name}
            <button
              type="button"
              disabled={pending}
              onClick={() => set(tg.id, false)}
              aria-label={fmt(s.tagRemove, { name: tg.name })}
              title={fmt(s.tagRemove, { name: tg.name })}
              className="grid h-4 w-4 place-items-center rounded-[3px] text-[12px] leading-none hover:bg-black/10"
            >
              ×
            </button>
          </span>
        ))}
        {addable.length > 0 && (
          <SearchableSelect
            value=""
            disabled={pending}
            onChange={(v) => v && set(v, true)}
            aria-label={s.tagAddTo}
            className="h-[24px] rounded-[5px] border border-dashed border-[var(--color-border-strong)] bg-transparent px-1.5 text-[11.5px] text-[var(--color-muted)] outline-none hover:border-[var(--color-accent)]"
            options={[
              { value: "", label: s.tagAddTo },
              ...addable.map((tg) => ({ value: tg.id, label: tg.name })),
            ]}
          />
        )}
      </div>
      {error && <p className="mt-1 text-[11.5px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
