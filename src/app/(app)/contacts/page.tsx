import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { attrs, initials, tint } from "@/lib/format";

/**
 * How many contacts the table renders. The CRM is fed by ERP order sync, so
 * this list grows without bound — an unlimited `findMany` (plus a tag join per
 * row) would degrade the page a little more every week. The header still shows
 * the true total, from a count that does not read the rows.
 */
const PAGE_SIZE = 200;

export default async function ContactsPage() {
  const db = getDb();
  const [total, contacts] = await Promise.all([
    db.$count(contact),
    db.query.contact.findMany({
      orderBy: desc(contact.createdAt),
      limit: PAGE_SIZE,
      with: { tagLinks: { with: { tag: true } } },
    }),
  ]);

  return (
    <PageChrome
      title="Contacts"
      subtitle={`${total} contacts · dynamic custom fields`}
    >
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Sales Person</th>
                <th className="px-4 py-3 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const a = attrs(c.attributes);
                const name = c.name ?? c.phone;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-white"
                          style={{ background: tint(name) }}
                        >
                          {initials(name).toUpperCase()}
                        </span>
                        <span className="font-medium text-[var(--color-ink)]">
                          {name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted)]">
                      +{c.phone}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">
                      {a.ref_1 ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">
                      {a.sales_person ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.tagLinks.map((t) => (
                          <span
                            key={t.tag.name}
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              background: `${t.tag.color}1f`,
                              color: t.tag.color,
                            }}
                          >
                            {t.tag.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > contacts.length && (
            <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[12px] text-[var(--color-faint)]">
              Showing the {contacts.length} most recent of {total} contacts.
            </div>
          )}
        </div>
      </div>
    </PageChrome>
  );
}
