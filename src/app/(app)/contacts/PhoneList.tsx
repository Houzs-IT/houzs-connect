import Link from "next/link";
import { IconSearch } from "@/components/icons";
import { initials, tint } from "@/lib/format";
import type { Dict } from "@/lib/i18n/dict";
import type { ContactRow } from "./ContactsView";
import { menuCounts } from "./queries";

/**
 * Contacts on a phone: search, the three segments as pills, then one line per
 * person (name, number, tags, order). The table and filters are desktop-only.
 */
export async function PhoneList({
  companyId,
  rows,
  q,
  segment,
  s,
}: {
  companyId: string;
  rows: ContactRow[];
  q: string;
  segment: string | undefined;
  s: Dict["contacts"];
}) {
  const m = await menuCounts(companyId);
  const n = (v: number) => v.toLocaleString("en-MY");
  const pills: [string | undefined, string, number][] = [
    [undefined, s.all, m.all],
    ["open-order", s.openOrder, m.openOrder],
    ["balance-due", s.balanceDue, m.balanceDue],
  ];
  return (
    <div className="flex min-w-0 flex-1 flex-col md:hidden">
      <form className="px-4 pt-3">
        {segment && <input type="hidden" name="segment" value={segment} />}
        <label className="flex h-11 items-center gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3">
          <IconSearch width={16} height={16} className="text-[var(--color-faint)]" />
          <input name="q" defaultValue={q} placeholder={s.search} className="w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--color-faint)]" />
        </label>
      </form>
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {pills.map(([key, label, count]) => {
          const on = key === segment;
          return (
            <Link
              key={label}
              href={key ? `?segment=${key}` : "?"}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                on
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "border-[var(--color-border)] text-[var(--color-ink)]"
              }`}
            >
              {label} <span className="text-[11.5px] text-[var(--color-faint)]">{n(count)}</span>
            </Link>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-border-subtle)]">
        {rows.map((r) => (
          <Link key={r.id} href={`?id=${r.id}`} className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white"
              style={{ background: r.blocked ? "#8a8f98" : tint(r.name) }}
            >
              {initials(r.name).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-[var(--color-ink)]">{r.name}</span>
                {r.orderRef && <span className="shrink-0 text-[12.5px] font-semibold text-[var(--color-brand)]">{r.orderRef}</span>}
              </span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-[13px] tabular-nums text-[var(--color-muted)]">{r.phone}</span>
                {r.tags.slice(0, 2).map((tg) => (
                  <span key={tg.id} className="truncate rounded-[4px] px-1.5 py-px text-[10.5px] font-medium" style={{ background: `${tg.color}1f`, color: tg.color }}>
                    {tg.name}
                  </span>
                ))}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
