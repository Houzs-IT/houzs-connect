import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, contactField, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { attrs, formatPhone, previewText, waIdentifier } from "@/lib/format";
import { getDict } from "@/lib/i18n/server";
import { ensureContactColumns, normalisePhone } from "./actions";
import { ContactDetail } from "./ContactDetail";
import { PhoneList } from "./PhoneList";
import { ContactsView, type ContactRow } from "./ContactsView";
import { HeaderActions } from "./HeaderActions";
import {
  contactsWhere,
  duplicates as findDuplicates,
  filterOptions,
  lastMessages,
  shortWhen,
  type Segment,
} from "./queries";

/**
 * Rows per page. The CRM is fed by ERP order sync, so this list grows without
 * bound; everything past the first page is reachable through the pager.
 */
// Header sorting and funnels (components/DataTable.tsx) work over the page the
// browser holds, so a page is big enough to hold a normal book of customers.
const PAGE_SIZE = 200;
const SEGMENTS: Segment[] = ["open-order", "balance-due", "waiting", "blocked"];

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const sp = await searchParams;
  const t = await getDict();
  const s = t.contacts;

  const q = one(sp.q);
  const segment = SEGMENTS.find((x) => x === one(sp.segment));
  // "Updated" shows the newest message (or the record's own change), so it
  // sorts on the same thing.
  const lastActivity = sql`greatest(${contact.updatedAt}, (select max(cv.last_message_at) from connect.conversation cv where cv.contact_id = ${contact.id}))`;
  const sortCol = one(sp.sort) === "created" ? contact.createdAt : lastActivity;
  const dir = one(sp.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  const activeId = one(sp.id) || null;

  // Search through the same normaliser contacts are stored with, so any way of
  // writing a number finds the row; the same box also matches names, emails
  // and order numbers.
  const digits = q && /\d{3,}/.test(q) ? await normalisePhone(q) : "";
  const where = contactsWhere(me.companyId, {
    q,
    digits,
    segment,
    tagId: one(sp.tag) || undefined,
    source: one(sp.source) || undefined,
    sales: one(sp.sales) || undefined,
    state: one(sp.state) || undefined,
  });
  const offset = (page - 1) * PAGE_SIZE;

  await ensureContactColumns();
  const [total, contacts, fieldRows, tagRows, opts, dups] = await Promise.all([
    db.$count(contact, where),
    db.query.contact.findMany({
      where,
      orderBy: dir === "asc" ? asc(sortCol) : desc(sortCol),
      limit: PAGE_SIZE,
      offset,
      with: { tagLinks: { with: { tag: true } } },
    }),
    // The CSV importer's mappable fields and taggable tags.
    db.query.contactField.findMany({ where: eq(contactField.companyId, me.companyId), orderBy: asc(contactField.name) }),
    db.query.tag.findMany({ where: eq(tag.companyId, me.companyId), orderBy: asc(tag.name) }),
    filterOptions(me.companyId),
    findDuplicates(me.companyId),
  ]);
  const last = await lastMessages(contacts.map((c) => c.id));

  const rows: ContactRow[] = contacts.map((c) => {
    const a = attrs(c.attributes);
    const ident = waIdentifier(c.phone);
    const lm = last.get(c.id);
    return {
      id: c.id,
      name: c.name ?? (ident.isPhone ? formatPhone(c.phone) : ident.text),
      phone: ident.isPhone ? formatPhone(c.phone) : ident.text,
      blocked: c.blocked,
      orderRef: a.ref_1 ?? null,
      orderSub: [a.brand_1, a.product_1].filter(Boolean).join(" · ") || null,
      sales: a.sales_person ?? null,
      tags: c.tagLinks.map((l) => ({ id: l.tag.id, name: l.tag.name, color: l.tag.color })),
      last: lm ? { body: previewText(lm, t.service) || "—", inbound: lm.direction === "IN" } : null,
      updated: shortWhen(lm && lm.at > c.updatedAt ? lm.at : c.updatedAt, t.service.yesterday),
      updatedTs: (lm && lm.at > c.updatedAt ? lm.at : c.updatedAt).getTime(),
      email: c.email,
      source: c.source,
      sourceId: c.sourceId,
      sourceUrl: c.sourceUrl,
      company: a.company ?? null,
      remarks: a.remarks ?? null,
      created: shortWhen(c.createdAt, t.service.yesterday),
      createdTs: c.createdAt.getTime(),
    };
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = rows.length === 0 ? 0 : offset + 1;
  const to = rows.length === 0 ? 0 : offset + rows.length;
  const closeParams = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (k === "id" || v == null ? [] : [[k, one(v)]]))
  );

  return (
    <PageChrome
      section="contacts"
      crumbs={[`${t.page.allContacts} · ${total.toLocaleString("en-MY")}`]}
      actions={
        <HeaderActions
          fields={fieldRows.map((f) => ({ key: f.key, name: f.name }))}
          tags={tagRows.map((x) => ({ id: x.id, name: x.name }))}
        />
      }
    >
      <div className="flex h-full min-h-0">
        {!activeId && <PhoneList companyId={me.companyId} rows={rows} q={q} segment={segment} s={s} />}
        <div className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1`}>
        <ContactsView
          rows={rows}
          total={total}
          page={page}
          pages={pages}
          from={from}
          to={to}
          q={q}
          tagOptions={tagRows.map((x) => ({ id: x.id, name: x.name, color: x.color }))}
          salesOptions={opts.sales}
          stateOptions={opts.states}
          duplicates={dups}
          activeId={activeId}
        />
        </div>
        {activeId && (
          <ContactDetail
            companyId={me.companyId}
            id={activeId}
            closeHref={`/contacts${closeParams.size ? `?${closeParams}` : ""}`}
            s={s}
            statusLabel={t.service.statusLabel}
            yesterday={t.service.yesterday}
          />
        )}
      </div>
    </PageChrome>
  );
}
