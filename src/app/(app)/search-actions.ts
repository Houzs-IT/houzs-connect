"use server";

import { and, desc, eq } from "drizzle-orm";
import { getCurrentMember } from "@/lib/current-member";
import { getDb } from "@/db/client";
import { contact } from "@/db/schema";
import { contactsWhere } from "./contacts/queries";
import { searchConversations } from "./inbox/actions";
import { attrs, displayName, formatPhone, waIdentifier } from "@/lib/format";

/** One result in the command palette. `link` is where Enter / click goes. */
export type GlobalHit = {
  id: string;
  title: string;
  subtitle: string | null;
  link: string;
};

export type GlobalSearchResult = {
  conversations: GlobalHit[];
  contacts: GlobalHit[];
  /** Sources that failed to read, so the palette can say "couldn't search X"
   *  instead of implying the record does not exist. */
  degraded: string[];
};

/** How many hits per source the palette shows. */
const PER_SOURCE = 8;

/**
 * Cross-entity search for the Cmd/Ctrl+K palette: conversations (by customer
 * name, phone, order number or message text — the inbox's own whole-book search)
 * and contacts (name / email / order ref / phone). Each source runs
 * independently so one failing does not blank the other; a failed source is
 * reported in `degraded` rather than silently shown as "no results".
 */
export async function globalSearch(term: string): Promise<GlobalSearchResult> {
  const me = await getCurrentMember();
  const cleaned = (term ?? "").trim();
  if (!me || !cleaned) return { conversations: [], contacts: [], degraded: [] };
  const db = getDb();

  const [convos, contacts] = await Promise.allSettled([
    searchConversations(cleaned),
    searchContacts(db, me.companyId, cleaned),
  ]);

  const degraded: string[] = [];

  let conversations: GlobalHit[] = [];
  if (convos.status === "fulfilled") {
    conversations = convos.value.items.slice(0, PER_SOURCE).map((c) => ({
      id: c.id,
      title: c.name,
      subtitle: c.orderRef ? `${c.orderRef} · ${waIdentifier(c.phone).text}` : waIdentifier(c.phone).text,
      link: `/inbox/${c.id}`,
    }));
  } else {
    degraded.push("conversations");
  }

  let contactHits: GlobalHit[] = [];
  if (contacts.status === "fulfilled") {
    contactHits = contacts.value;
  } else {
    degraded.push("contacts");
  }

  return { conversations, contacts: contactHits, degraded };
}

/** The contacts source: the same predicate the Contacts page uses, capped. */
async function searchContacts(
  db: ReturnType<typeof getDb>,
  companyId: string,
  term: string
): Promise<GlobalHit[]> {
  const digits = term.replace(/\D/g, "");
  const rows = await db
    .select({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      attributes: contact.attributes,
    })
    .from(contact)
    .where(and(contactsWhere(companyId, { q: term, digits: digits || undefined }), eq(contact.blocked, false)))
    .orderBy(desc(contact.updatedAt))
    .limit(PER_SOURCE);

  return rows.map((r) => {
    const a = attrs(r.attributes);
    const ref = a.ref_1 || null;
    return {
      id: r.id,
      title: displayName(r.name, r.phone),
      subtitle: ref ? `${ref} · ${formatPhone(r.phone)}` : formatPhone(r.phone),
      link: `/contacts?id=${r.id}`,
    };
  });
}
