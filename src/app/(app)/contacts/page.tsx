import Link from "next/link";
import { and, asc, desc, eq, ilike, like, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, contactField, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { attrs, initials, stamp, tint, waIdentifier } from "@/lib/format";
import { ContactsToolbar } from "./ContactsToolbar";
import { ensureContactColumns, normalisePhone, setContactBlocked } from "./actions";
import { DeleteContactButton } from "./DeleteContactButton";
import { MergeButton } from "./MergeButton";

/**
 * Rows per page. The CRM is fed by ERP order sync, so this list grows without
 * bound — an unlimited `findMany` (plus a tag join per row) would degrade the
 * page a little more every week. Everything past the first page is reachable
 * through the pager, which is what the old hard cap of 200 never allowed.
 */
const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

const th = "px-4 py-3 font-medium";
const td = "px-4 py-3 text-[var(--color-muted)]";

const pagerCls =
  "rounded-md border border-[var(--color-border)] px-2 py-1 text-[11.5px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface)]";
const pagerOffCls =
  "rounded-md border border-transparent px-2 py-1 text-[11.5px] font-medium text-[var(--color-faint)] cursor-not-allowed";

/**
 * One end of the pager.
 *
 * With everything on a single page neither end has anywhere to go. Both used to
 * render as a plain `<span>` — dimmed, but still shaped and spaced exactly like
 * the live control, which is why "← Prev / Next →" reads as a pair of buttons
 * that do nothing. A real `disabled` button refuses the pointer, reports the
 * state to assistive tech, and says on hover why there is nothing to click.
 */
function PagerEnd({
  label,
  href,
  disabled,
  reason,
}: {
  label: string;
  href: string;
  disabled: boolean;
  reason: string;
}) {
  if (disabled) {
    return (
      <button type="button" disabled title={reason} className={pagerOffCls}>
        {label}
      </button>
    );
  }
  return (
    <Link href={href} className={pagerCls}>
      {label}
    </Link>
  );
}

/** A column header that is also the sort control, with the active arrow. */
function SortHead({
  label,
  href,
  active,
  dir,
}: {
  label: string;
  href: string;
  active: boolean;
  dir: string;
}) {
  return (
    <th className={th}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 ${
          active ? "text-[var(--color-ink)]" : "hover:text-[var(--color-muted)]"
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (dir === "desc" ? "↓" : "↑") : ""}</span>
      </Link>
    </th>
  );
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const sp = await searchParams;

  const q = one(sp.q).trim();
  const sort = one(sp.sort) === "updated" ? "updated" : "created";
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));

  // Both the count and the rows are scoped to the member's company. Neither was
  // before, so this page listed every tenant's customers and their phone numbers.
  const filters = [eq(contact.companyId, me.companyId)];
  if (q) {
    // Search through the same normaliser the contact was stored with, so
    // "011-1110 8822", "+60 11-1110 8822" and "601111108822" all find the one
    // row. A query with no digits at all is treated as a name/email lookup.
    const digits = await normalisePhone(q);
    if (digits) {
      filters.push(like(contact.phone, `%${digits}%`));
    } else {
      const text = or(ilike(contact.name, `%${q}%`), ilike(contact.email, `%${q}%`));
      if (text) filters.push(text);
    }
  }
  const where = and(...filters);

  const sortCol = sort === "updated" ? contact.updatedAt : contact.createdAt;
  const offset = (page - 1) * PAGE_SIZE;

  await ensureContactColumns();
  const [total, contacts, fieldRows, tagRows] = await Promise.all([
    db.$count(contact, where),
    db.query.contact.findMany({
      where,
      orderBy: dir === "asc" ? asc(sortCol) : desc(sortCol),
      limit: PAGE_SIZE,
      offset,
      with: { tagLinks: { with: { tag: true } } },
    }),
    // Both feed the CSV importer in the toolbar: the custom fields a column can
    // be mapped into, and the tags offered when stamping the batch.
    db.query.contactField.findMany({
      where: eq(contactField.companyId, me.companyId),
      orderBy: asc(contactField.name),
    }),
    db.query.tag.findMany({
      where: eq(tag.companyId, me.companyId),
      orderBy: asc(tag.name),
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // A page past the end (stale link, or a filter that shrank the result) has no
  // rows, so the range collapses to 0–0 rather than claiming an offset it never reached.
  const from = contacts.length === 0 ? 0 : offset + 1;
  const to = contacts.length === 0 ? 0 : offset + contacts.length;

  function href(over: { sort?: string; dir?: string; page?: number }): string {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    p.set("sort", over.sort ?? sort);
    p.set("dir", over.dir ?? dir);
    const n = over.page ?? 1;
    if (n > 1) p.set("page", String(n));
    return `/contacts?${p.toString()}`;
  }

  /** Clicking the active column flips direction; a new column starts newest-first. */
  function sortHref(key: "created" | "updated"): string {
    return href({ sort: key, dir: sort === key && dir === "desc" ? "asc" : "desc" });
  }

  return (
    <PageChrome
      title="Contacts"
      subtitle={
        q
          ? `${total} matching "${q}" · dynamic custom fields`
          : `${total} contacts · dynamic custom fields`
      }
    >
      <div className="p-6">
        <ContactsToolbar
          q={q}
          sort={sort}
          dir={dir}
          // Narrowed to what the importer needs rather than handed whole rows:
          // everything passed to a client component crosses the wire.
          fields={fieldRows.map((f) => ({ key: f.key, name: f.name }))}
          tags={tagRows.map((t) => ({ id: t.id, name: t.name }))}
        />

        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[1650px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className={th}>Name</th>
                <th className={th}>Phone</th>
                <th className={th}>Email</th>
                <th className={th}>Source</th>
                <th className={th}>Source Id</th>
                <th className={th}>Source Url</th>
                <th className={th}>Ref</th>
                <th className={th}>Sales Person</th>
                <th className={th}>Company</th>
                <th className={th}>Remarks</th>
                <th className={th}>Tags</th>
                <SortHead
                  label="Created Date"
                  href={sortHref("created")}
                  active={sort === "created"}
                  dir={dir}
                />
                <SortHead
                  label="Updated At"
                  href={sortHref("updated")}
                  active={sort === "updated"}
                  dir={dir}
                />
                <th className={th}>Blocked</th>
                <th className={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-[var(--color-faint)]">
                    {q ? `No contact matches "${q}".` : "No contacts yet."}
                  </td>
                </tr>
              )}
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
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
                          style={{ background: tint(name) }}
                        >
                          {initials(name).toUpperCase()}
                        </span>
                        <span className="font-medium text-[var(--color-ink)]">
                          {name}
                        </span>
                      </div>
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-[var(--color-muted)]"
                      title={waIdentifier(c.phone).label}
                    >
                      {waIdentifier(c.phone).text}
                    </td>
                    <td className={td}>{c.email ?? "—"}</td>
                    <td className={td}>{c.source ?? "—"}</td>
                    <td className="max-w-[160px] truncate px-4 py-3 font-mono text-[11.5px] text-[var(--color-muted)]">
                      {c.sourceId ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {c.sourceUrl ? (
                        <a
                          href={c.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={c.sourceUrl}
                          className="block max-w-[180px] truncate text-[var(--color-accent)] hover:underline"
                        >
                          {c.sourceUrl}
                        </a>
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className={td}>{a.ref_1 ?? "—"}</td>
                    <td className={td}>{a.sales_person ?? "—"}</td>
                    <td className={td}>{a.company ?? "—"}</td>
                    <td className={`${td} max-w-[220px]`}>
                      {/* Truncated with the whole note on hover: a remark is
                          often a paragraph, and letting it set the row height
                          would wreck a 15-column table. */}
                      <span className="block truncate" title={a.remarks ?? undefined}>
                        {a.remarks ?? "—"}
                      </span>
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
                    <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-[var(--color-faint)]">
                      {stamp(c.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-[11.5px] text-[var(--color-faint)]">
                      {stamp(c.updatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={
                          c.blocked
                            ? {
                                background:
                                  "color-mix(in srgb, var(--color-danger) 12%, transparent)",
                                color: "var(--color-danger)",
                              }
                            : {
                                background: "var(--color-surface-2)",
                                color: "var(--color-faint)",
                              }
                        }
                      >
                        {c.blocked ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <form action={setContactBlocked}>
                          <input type="hidden" name="contactId" value={c.id} />
                          <input type="hidden" name="blocked" value={c.blocked ? "0" : "1"} />
                          <button
                            className={`whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ${
                              c.blocked
                                ? "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                                : "bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]"
                            }`}
                          >
                            {c.blocked ? "Unblock" : "Block"}
                          </button>
                        </form>
                        <MergeButton
                          keepId={c.id}
                          keepLabel={c.name ?? c.phone}
                          // Every other contact on this page is a candidate. The
                          // duplicate is usually adjacent — same person, one row
                          // by username and one by phone — so the visible page is
                          // the right scope rather than the whole address book.
                          options={contacts
                            .filter((o) => o.id !== c.id)
                            .map((o) => ({
                              id: o.id,
                              label: `${o.name ?? "(no name)"} · ${o.phone}`,
                            }))}
                        />
                        <DeleteContactButton
                          contactId={c.id}
                          name={c.name ?? c.phone}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-[12px] text-[var(--color-faint)]">
          <span>
            Showing {from}–{to} of {total}
          </span>
          <div className="flex items-center gap-1.5">
            <PagerEnd
              label="← Prev"
              href={href({ page: page - 1 })}
              disabled={page <= 1}
              reason={
                pages === 1
                  ? `All ${total} contacts fit on one page — there is no previous page.`
                  : "You are on the first page."
              }
            />
            <span className="px-1">
              Page {page} of {pages}
            </span>
            <PagerEnd
              label="Next →"
              href={href({ page: page + 1 })}
              disabled={page >= pages}
              reason={
                pages === 1
                  ? `All ${total} contacts fit on one page — there is no next page.`
                  : "You are on the last page."
              }
            />
          </div>
        </div>
      </div>
    </PageChrome>
  );
}
