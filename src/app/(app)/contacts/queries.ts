import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, contactField, contactTag, conversation, message, tag } from "@/db/schema";

/*
  Contacts reads, all scoped to one company. Segments are defined here once and
  used by both the secondary-menu counts and the list, so a count can never
  disagree with the rows it leads to.
*/

export type Segment = "all" | "open-order" | "balance-due" | "waiting" | "blocked";

export type ContactFilters = {
  q?: string;
  /** Phone digits for q, when q looks like a number (normalisePhone). */
  digits?: string;
  segment?: Segment;
  tagId?: string;
  source?: string;
  sales?: string;
  state?: string;
};

const attr = (key: string) => sql<string>`${contact.attributes} ->> ${key}`;

/**
 * Segment predicates.
 *  - Open order: carries an order reference (ref_1, written by the ERP order
 *    event) and the driver app has not marked it delivered.
 *  - Balance due: tagged with a tag whose name says "balance" — the team's own
 *    marker (e.g. "balance collection"). Connect holds no ERP balance.
 *  - Waiting on reply: has a conversation that is not closed whose newest
 *    message is the customer's.
 */
function segmentWhere(seg: Segment | undefined): SQL | undefined {
  switch (seg) {
    case "open-order":
      return sql`(${attr("ref_1")}) is not null and coalesce(${attr("tms_status")}, '') !~* 'deliver'`;
    case "balance-due":
      return sql`exists (select 1 from connect.contact_tag ct join connect.tag t on t.id = ct.tag_id
        where ct.contact_id = ${contact.id} and t.name ilike '%balance%')`;
    case "waiting":
      return sql`exists (select 1 from connect.conversation c
        join lateral (select direction from connect.message m where m.conversation_id = c.id
          order by m.created_at desc limit 1) lm on true
        where c.contact_id = ${contact.id} and c.status <> 'CLOSED' and lm.direction = 'IN')`;
    case "blocked":
      return eq(contact.blocked, true);
    default:
      return undefined;
  }
}

export function contactsWhere(companyId: string, f: ContactFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(contact.companyId, companyId), segmentWhere(f.segment)];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, "")}%`;
    conds.push(
      or(
        ilike(contact.name, like),
        ilike(contact.email, like),
        sql`${attr("ref_1")} ilike ${like}`,
        f.digits ? sql`${contact.phone} like ${`%${f.digits}%`}` : undefined
      )
    );
  }
  if (f.tagId) {
    conds.push(
      sql`exists (select 1 from connect.contact_tag ct where ct.contact_id = ${contact.id} and ct.tag_id = ${f.tagId})`
    );
  }
  if (f.source) {
    conds.push(f.source === "none" ? sql`${contact.source} is null` : eq(contact.source, f.source));
  }
  if (f.sales) conds.push(sql`${attr("sales_person")} = ${f.sales}`);
  if (f.state) conds.push(sql`${attr("address_state")} = ${f.state}`);
  return and(...conds);
}

/** Secondary-menu counts: segments, tags, sources. */
export async function menuCounts(companyId: string) {
  const db = getDb();
  const seg = (s: Segment) => db.$count(contact, contactsWhere(companyId, { segment: s }));
  const [all, openOrder, balanceDue, waiting, blocked, tags, sources] = await Promise.all([
    seg("all"),
    seg("open-order"),
    seg("balance-due"),
    seg("waiting"),
    seg("blocked"),
    db
      .select({ id: tag.id, name: tag.name, color: tag.color, n: count(contactTag.contactId) })
      .from(tag)
      .leftJoin(contactTag, eq(contactTag.tagId, tag.id))
      .where(eq(tag.companyId, companyId))
      .groupBy(tag.id, tag.name, tag.color)
      .orderBy(asc(tag.name)),
    db
      .select({ source: contact.source, n: count() })
      .from(contact)
      .where(eq(contact.companyId, companyId))
      .groupBy(contact.source)
      .orderBy(desc(count())),
  ]);
  return { all, openOrder, balanceDue, waiting, blocked, tags, sources };
}

/** Values offered by the Sales person / State filters. */
export async function filterOptions(companyId: string) {
  const db = getDb();
  const [sales, states] = await Promise.all([
    db
      .selectDistinct({ v: attr("sales_person") })
      .from(contact)
      .where(and(eq(contact.companyId, companyId), sql`${attr("sales_person")} is not null`))
      .orderBy(attr("sales_person"))
      .limit(100),
    db
      .selectDistinct({ v: attr("address_state") })
      .from(contact)
      .where(and(eq(contact.companyId, companyId), sql`${attr("address_state")} is not null`))
      .orderBy(attr("address_state"))
      .limit(50),
  ]);
  return { sales: sales.map((r) => r.v).filter(Boolean), states: states.map((r) => r.v).filter(Boolean) };
}

/** Each contact's newest message (body, direction, when) — one query per page. */
export async function lastMessages(contactIds: string[]) {
  const out = new Map<string, { body: string | null; direction: string; at: Date }>();
  if (!contactIds.length) return out;
  const db = getDb();
  const rows = await db
    .selectDistinctOn([conversation.contactId], {
      contactId: conversation.contactId,
      body: message.body,
      direction: message.direction,
      at: message.createdAt,
    })
    .from(conversation)
    .innerJoin(message, eq(message.conversationId, conversation.id))
    .where(inArray(conversation.contactId, contactIds))
    .orderBy(conversation.contactId, desc(message.createdAt));
  for (const r of rows) out.set(r.contactId, { body: r.body, direction: r.direction, at: r.at });
  return out;
}

/**
 * Possible duplicates: two contacts whose phone numbers end in the same nine
 * digits (one stored with a country code, one without; or a username row next
 * to the number row). Phone is unique per company, so identical strings can't
 * collide — near-identical ones are the duplicates that slip through.
 */
export async function duplicates(companyId: string) {
  const db = getDb();
  const rows = (await db.execute(sql`
    with t as (
      select id, name, phone, source, right(regexp_replace(phone, '\\D', '', 'g'), 9) as tail
      from connect.contact where company_id = ${companyId}
    )
    select a.id as a_id, a.name as a_name, a.phone as a_phone, a.source as a_source,
           b.id as b_id, b.name as b_name, b.phone as b_phone, b.source as b_source
    from t a join t b on a.tail = b.tail and length(a.tail) = 9 and a.id < b.id
    limit 50
  `)) as unknown as {
    a_id: string; a_name: string | null; a_phone: string; a_source: string | null;
    b_id: string; b_name: string | null; b_phone: string; b_source: string | null;
  }[];
  return rows.map((r) => ({
    a: { id: r.a_id, name: r.a_name, phone: r.a_phone, source: r.a_source },
    b: { id: r.b_id, name: r.b_name, phone: r.b_phone, source: r.b_source },
  }));
}

/** The detail panel: the contact, its tags, recent conversations, fields. */
export async function contactDetail(companyId: string, id: string) {
  const db = getDb();
  const c = await db.query.contact.findFirst({
    where: and(eq(contact.id, id), eq(contact.companyId, companyId)),
    with: { tagLinks: { with: { tag: true } } },
  });
  if (!c) return null;
  const [convos, fields] = await Promise.all([
    db.query.conversation.findMany({
      where: eq(conversation.contactId, id),
      orderBy: desc(conversation.lastMessageAt),
      limit: 4,
      with: {
        assignedDepartment: true,
        messages: { orderBy: desc(message.createdAt), limit: 1 },
      },
    }),
    db.query.contactField.findMany({
      where: eq(contactField.companyId, companyId),
      orderBy: asc(contactField.createdAt),
    }),
  ]);
  return { c, convos, fields };
}

const TZ = "Asia/Kuala_Lumpur";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** "10:04" today, "Yesterday", else "28 Sep" — Malaysian time. */
export function shortWhen(d: Date, yesterday: string): string {
  const now = Date.now();
  if (dayKey(d) === dayKey(new Date(now))) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  }
  if (dayKey(d) === dayKey(new Date(now - 86_400_000))) return yesterday;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: TZ }).replace("Sept", "Sep");
}
