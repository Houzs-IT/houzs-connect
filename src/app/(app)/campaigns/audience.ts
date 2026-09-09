// Resolving a campaign audience to actual contacts.
//
// Server-only (it queries the database) but NOT a "use server" module — it holds
// the one resolver that both the live recipient count and the send loop run, so
// the number an operator is shown before pressing Send is produced by the same
// code that decides who is written to. Two separate implementations is how a
// count starts lying.

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  contact as contactTable,
  contactTag as contactTagTable,
  tag as tagTable,
} from "@/db/schema";
import { attrs } from "@/lib/format";
import type { AudienceSpec } from "./spec";

export type ContactRow = typeof contactTable.$inferSelect;

/** How many matched contacts step 3 lists under the count. */
const SAMPLE_ROWS = 8;

export interface ResolvedAudience {
  /** Everyone the audience rule matched, before any exclusion. */
  matched: number;
  /** Excluded because the contact is blocked. */
  blocked: number;
  /** Excluded because the contact opted out of marketing. */
  optedOut: number;
  /** Who will actually be written to. matched = blocked + optedOut + this. */
  recipients: ContactRow[];
  /**
   * The first few MATCHED contacts, excluded ones included and flagged. A count
   * on its own is not evidence — Seampify's step 3 shows the contact table with
   * a Blocked column for exactly this reason.
   */
  sample: ContactRow[];
}

/**
 * Contacts the audience rule matches, then the two exclusions applied in a
 * fixed order so the four numbers always add up.
 *
 * Both exclusions are load-bearing, not politeness:
 *
 *  - `blocked` — `sendOutbound` in src/lib/whatsapp/transport.ts refuses a
 *    blocked contact and returns null. Counting them as recipients would show a
 *    number the send could never reach, on the one screen where the number is
 *    the whole decision.
 *  - `marketingOptIn` — a broadcast is promotional by definition. Meta scores
 *    messages to people who opted out against the number's quality rating, so
 *    sending to them costs the whole account, not just that customer's goodwill.
 */
export async function resolveAudience(
  db: DB,
  companyId: string,
  aud: AudienceSpec
): Promise<ResolvedAudience> {
  let matched: ContactRow[];

  if (aud.kind === "tag" && aud.tag) {
    const tagRow = await db.query.tag.findFirst({
      where: and(eq(tagTable.companyId, companyId), eq(tagTable.name, aud.tag)),
    });
    const links = tagRow
      ? await db.query.contactTag.findMany({ where: eq(contactTagTable.tagId, tagRow.id) })
      : [];
    const ids = links.map((l) => l.contactId);
    matched = ids.length
      ? await db.query.contact.findMany({
          where: and(eq(contactTable.companyId, companyId), inArray(contactTable.id, ids)),
        })
      : [];
  } else if (aud.kind === "attribute" && aud.attrKey) {
    // `attributes` is a free-form jsonb map, so the match runs in JS. Same rule
    // the previous version used: a blank value means "has this attribute".
    const all = await db.query.contact.findMany({
      where: eq(contactTable.companyId, companyId),
    });
    const wanted = (aud.attrValue ?? "").trim().toLowerCase();
    matched = all.filter((c) => {
      const v = attrs(c.attributes)[aud.attrKey as string];
      if (v == null) return false;
      return wanted === "" ? true : String(v).toLowerCase() === wanted;
    });
  } else {
    matched = await db.query.contact.findMany({
      where: eq(contactTable.companyId, companyId),
    });
  }

  const notBlocked = matched.filter((c) => !c.blocked);
  const recipients = notBlocked.filter((c) => c.marketingOptIn);

  return {
    matched: matched.length,
    blocked: matched.length - notBlocked.length,
    optedOut: notBlocked.length - recipients.length,
    recipients,
    sample: matched.slice(0, SAMPLE_ROWS),
  };
}
