"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";
import { ensureContactColumns as ensureColumns } from "@/db/ensure";
import {
  automationRun,
  contact,
  contactTag,
  conversation,
  conversationTag,
  driverEvent,
  formResponse,
  message,
  note,
  payment,
  tag,
} from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { attrs } from "@/lib/format";
import {
  CHUNK_ROWS,
  checkPhone,
  type ImportChunkInput,
  type ImportChunkResult,
  type PhonePreview,
  type RowOutcome,
} from "./csv";

/** Auth + company scope for every contact mutation. */
async function ctx() {
  const me = await getCurrentMember();
  if (!me) return null;
  return { db: getDb(), companyId: me.companyId };
}

/**
 * Idempotently add `blocked` / `updated_at`. They reached the Drizzle schema
 * before the live database, and Drizzle selects the full column list on every
 * contact read — so without this, a deploy that beats `pnpm db:migrate` 500s not
 * just here but anywhere a contact row is loaded.
 *
 * The DDL itself lives in db/ensure.ts, NOT here, for one reason: this module is
 * auth-gated, and the path that must not break is the WhatsApp webhook, which
 * has no session. Two copies would also mean two memo flags — the webhook's
 * would never be set by a page view, and vice versa. Migration 0003 is the real
 * fix; both callers are what makes a deploy that lands first survive.
 */
export async function ensureContactColumns(): Promise<void> {
  const c = await ctx();
  if (!c) return;
  await ensureColumns(c.db);
}

/**
 * Normalise a Malaysian number to the digits WhatsApp uses as a wa_id: no
 * plus, no spaces, no leading zero, country code included. "011-1110 8822"
 * and "+60 11-1110 8822" must land on the same contact, or the same customer
 * ends up duplicated across the CRM.
 */
export async function normalisePhone(raw: string): Promise<string> {
  let d = raw.replace(/[^\d]/g, "");
  if (d.startsWith("0")) d = `60${d.slice(1)}`;
  return d;
}

/** Result of an add, so the form can confirm it worked (it saved silently before,
 *  which read as "nothing happened" and got clicked again). Shaped for
 *  useActionState: the first arg is the previous state. */
export interface AddContactState {
  ok?: boolean;
  /** Who was just saved, for the confirmation line. */
  saved?: string;
  error?: string;
}

export async function addContact(
  _prev: AddContactState,
  formData: FormData
): Promise<AddContactState> {
  const c = await ctx();
  if (!c) return { error: "Your session has expired. Sign in again." };
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!rawPhone) return { error: "Enter a phone number." };

  const phone = await normalisePhone(rawPhone);
  if (!phone) return { error: "That does not look like a phone number." };

  await ensureContactColumns();
  await c.db
    .insert(contact)
    .values({
      companyId: c.companyId,
      phone,
      name: name || null,
      email: email || null,
      source: "manual",
    })
    // Adding a number that already exists should update the name, not fail.
    .onConflictDoUpdate({
      target: [contact.companyId, contact.phone],
      set: { name: name || null, ...(email ? { email } : {}) },
    });

  revalidatePath("/contacts");
  return { ok: true, saved: name || phone };
}

/** Block / unblock — Seampify's "Mark as Block". */
export async function setContactBlocked(formData: FormData): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("contactId") ?? "");
  const blocked = String(formData.get("blocked") ?? "") === "1";
  if (!id) return;
  await ensureContactColumns();
  await c.db
    .update(contact)
    .set({ blocked })
    .where(and(eq(contact.id, id), eq(contact.companyId, c.companyId)));
  revalidatePath("/contacts");
  revalidatePath("/inbox");
}

/**
 * Delete a contact and everything hanging off it.
 *
 * There are no ON DELETE CASCADE constraints in this schema — the foreign keys
 * are conventions, not database rules — so removing the contact row alone would
 * leave conversations pointing at nothing, and every page that joins through
 * `conversation -> contact` would start throwing on the orphans. Ten tables
 * reference a contact directly or through its conversations; they are deleted
 * children-first, in one transaction, so a failure half-way cannot leave the
 * inbox in that state.
 *
 * This is destructive and irreversible: the message history goes with it. It is
 * how the seeded demo customers (Wong, Esther Lee, Janice, TEOH CHOON KHIM from
 * scripts/seed.ts) get removed from a live database — they cannot simply be
 * hidden, because a campaign audience reads the contact table directly.
 */
export async function deleteContact(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Ownership is checked BEFORE anything is deleted: `id` arrives from the
  // browser, and every delete below keys off it.
  const target = await c.db.query.contact.findFirst({
    where: and(eq(contact.id, id), eq(contact.companyId, c.companyId)),
  });
  if (!target) return;

  await c.db.transaction(async (tx) => {
    const convos = await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.contactId, id));
    const convoIds = convos.map((r) => r.id);

    if (convoIds.length) {
      await tx.delete(message).where(inArray(message.conversationId, convoIds));
      await tx.delete(note).where(inArray(note.conversationId, convoIds));
      await tx
        .delete(conversationTag)
        .where(inArray(conversationTag.conversationId, convoIds));
    }

    // payment carries both contactId and conversationId; keying on the contact
    // catches the rows whose conversation link is null.
    await tx.delete(payment).where(eq(payment.contactId, id));
    await tx.delete(driverEvent).where(eq(driverEvent.contactId, id));
    await tx.delete(contactTag).where(eq(contactTag.contactId, id));
    await tx.delete(automationRun).where(eq(automationRun.contactId, id));
    await tx.delete(formResponse).where(eq(formResponse.contactId, id));
    await tx.delete(conversation).where(eq(conversation.contactId, id));
    await tx.delete(contact).where(eq(contact.id, id));
  });

  revalidatePath("/contacts");
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  revalidatePath("/logs");
  revalidatePath("/payments");
}

/**
 * The free-text note Seampify keeps on a contact ("Remarks").
 *
 * Stored in `contact.attributes` under `remarks` rather than behind a new
 * column: attributes is already the CRM's open field bag, it needs no migration
 * on a live database, and the Contacts table can surface it the same way it
 * surfaces every other synced attribute.
 */
export async function setContactRemarks(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("contactId") ?? "");
  const remarks = String(formData.get("remarks") ?? "").trim().slice(0, 2000);
  if (!id) return;

  const target = await c.db.query.contact.findFirst({
    where: and(eq(contact.id, id), eq(contact.companyId, c.companyId)),
  });
  if (!target) return;

  const next: Record<string, unknown> = {
    ...(target.attributes as Record<string, unknown> | null),
  };
  // An emptied box clears the note rather than storing "".
  if (remarks) next.remarks = remarks;
  else delete next.remarks;

  await c.db
    .update(contact)
    .set({ attributes: next })
    .where(and(eq(contact.id, id), eq(contact.companyId, c.companyId)));
  revalidatePath("/contacts");
  revalidatePath("/inbox");
}

/**
 * Fold one contact into another — Seampify has no equivalent, but this CRM
 * needs it: WhatsApp can hand us the same human twice.
 *
 * A customer whose account has a username reaches us as `MY.3816205081852835`
 * with no phone number anywhere in Meta's payload, while the ERP sync knows them
 * as +60…. Nothing can link those automatically, so the same person ends up with
 * two contacts and two threads, and an agent answers in the one the customer is
 * not reading.
 *
 * Everything hanging off the loser moves to the keeper — conversations, and with
 * them the whole message history — then the loser row goes. Attributes merge
 * keeper-wins, so a value someone has already corrected is not overwritten by a
 * stale duplicate. Tags are unioned. One transaction: a half-merge would scatter
 * a customer's history across two records with no way back.
 */
export async function mergeContacts(formData: FormData) {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };
  const keepId = String(formData.get("keepId") ?? "");
  const mergeId = String(formData.get("mergeId") ?? "");
  if (!keepId || !mergeId) return { ok: false, error: "Pick two contacts." };
  if (keepId === mergeId) return { ok: false, error: "That is the same contact." };

  const [keep, loser] = await Promise.all([
    c.db.query.contact.findFirst({
      where: and(eq(contact.id, keepId), eq(contact.companyId, c.companyId)),
    }),
    c.db.query.contact.findFirst({
      where: and(eq(contact.id, mergeId), eq(contact.companyId, c.companyId)),
    }),
  ]);
  if (!keep || !loser) return { ok: false, error: "One of those contacts no longer exists." };

  await c.db.transaction(async (tx) => {
    // Point the loser's records at the keeper.
    await tx.update(conversation).set({ contactId: keepId }).where(eq(conversation.contactId, mergeId));
    await tx.update(payment).set({ contactId: keepId }).where(eq(payment.contactId, mergeId));
    await tx.update(driverEvent).set({ contactId: keepId }).where(eq(driverEvent.contactId, mergeId));
    await tx.update(automationRun).set({ contactId: keepId }).where(eq(automationRun.contactId, mergeId));
    await tx.update(formResponse).set({ contactId: keepId }).where(eq(formResponse.contactId, mergeId));

    // contact_tag is keyed (contact_id, tag_id), so a tag both already carry
    // would collide on the primary key — take the union, then drop the rest.
    const loserTags = await tx.select({ tagId: contactTag.tagId }).from(contactTag).where(eq(contactTag.contactId, mergeId));
    if (loserTags.length) {
      await tx
        .insert(contactTag)
        .values(loserTags.map((t) => ({ contactId: keepId, tagId: t.tagId })))
        .onConflictDoNothing();
      await tx.delete(contactTag).where(eq(contactTag.contactId, mergeId));
    }

    const merged: Record<string, unknown> = {
      ...(loser.attributes as Record<string, unknown> | null),
      ...(keep.attributes as Record<string, unknown> | null),
    };
    await tx
      .update(contact)
      .set({
        attributes: merged,
        name: keep.name ?? loser.name,
        email: keep.email ?? loser.email,
        // If either side was blocked, the merged customer stays blocked — the
        // safer of the two, since one of them asked not to be messaged.
        blocked: keep.blocked || loser.blocked,
        // Same for opt-out: an opt-out on either record wins.
        marketingOptIn: keep.marketingOptIn && loser.marketingOptIn,
      })
      .where(eq(contact.id, keepId));

    await tx.delete(contact).where(eq(contact.id, mergeId));
  });

  revalidatePath("/contacts");
  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

/** Rename a contact / fix their email from the conversation panel. */
export async function updateContactProfile(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("contactId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  if (!id) return;
  await c.db
    .update(contact)
    // Blank clears the field rather than storing "", so an emptied box reverts
    // the row to "no name known" and the UI falls back to the phone number.
    .set({ name: name || null, email: email || null })
    .where(and(eq(contact.id, id), eq(contact.companyId, c.companyId)));
  revalidatePath("/contacts");
  revalidatePath("/inbox");
}

/**
 * Star a contact — Seampify's favourite on the conversation header.
 *
 * Lives in `attributes.starred` for the same reason remarks does: no migration
 * against a live database for what is a one-bit UI preference.
 */
export async function setContactStarred(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("contactId") ?? "");
  const starred = String(formData.get("starred") ?? "") === "1";
  if (!id) return;
  const target = await c.db.query.contact.findFirst({
    where: and(eq(contact.id, id), eq(contact.companyId, c.companyId)),
  });
  if (!target) return;
  const next: Record<string, unknown> = {
    ...(target.attributes as Record<string, unknown> | null),
  };
  if (starred) next.starred = "1";
  else delete next.starred;
  await c.db
    .update(contact)
    .set({ attributes: next })
    .where(and(eq(contact.id, id), eq(contact.companyId, c.companyId)));
  revalidatePath("/contacts");
  revalidatePath("/inbox");
}

// ─────────────────────────── CSV import ───────────────────────────

/**
 * Show the operator what `normalisePhone` will actually store, before they
 * commit thousands of rows.
 *
 * The whole reason the import cannot be trusted blind is that the phone column
 * is the identity key: "011-1110 8822", "+60 11-1110 8822" and "601111108822"
 * are one customer, and a column of order references that happens to be mapped
 * to Phone is 4,000 junk contacts. Rendering the normalised value next to the
 * raw one makes both obvious in a glance at five rows.
 *
 * Auth-gated like every other action here even though it only transforms
 * strings — an unauthenticated endpoint that normalises phone numbers is a free
 * oracle, and the guard costs one memoised session read.
 */
export async function previewImportPhones(raws: string[]): Promise<PhonePreview[]> {
  const c = await ctx();
  if (!c) return [];
  const list = Array.isArray(raws) ? raws.slice(0, 20) : [];
  const out: PhonePreview[] = [];
  for (const raw of list) {
    const value = String(raw ?? "");
    const check = checkPhone(value, await normalisePhone(value));
    out.push(
      check.ok
        ? { raw: value, phone: check.phone, ok: true, message: "" }
        : { raw: value, phone: "", ok: false, message: check.message }
    );
  }
  return out;
}

/**
 * Find or create the tag the import stamps on every row it touches.
 *
 * Read-then-insert-then-read rather than an upsert with a RETURNING clause:
 * `onConflictDoUpdate` would have to set something, and the only settable
 * column is `color` — so re-running an import would repaint a tag the owner had
 * recoloured. `onConflictDoNothing` returns no row on conflict, hence the
 * second read, which only runs in the race.
 */
async function ensureTag(db: DB, companyId: string, name: string): Promise<string | null> {
  const found = await db.query.tag.findFirst({
    where: and(eq(tag.companyId, companyId), eq(tag.name, name)),
  });
  if (found) return found.id;
  await db.insert(tag).values({ companyId, name }).onConflictDoNothing();
  const again = await db.query.tag.findFirst({
    where: and(eq(tag.companyId, companyId), eq(tag.name, name)),
  });
  return again?.id ?? null;
}

interface PreparedRow {
  line: number;
  phone: string;
  name: string;
  email: string;
  attributes: Record<string, string>;
}

/**
 * Write one chunk of a CSV import, and account for every row in it.
 *
 * Called repeatedly by the Contacts import panel — the file is parsed in the
 * browser and arrives CHUNK_ROWS rows at a time, so nothing here holds a whole
 * address book in a 128 MB Worker isolate.
 *
 * Three things make this safe to run twice on the same file:
 *
 *  - The phone goes through `normalisePhone`, the same function `addContact`
 *    and the Contacts search use. One customer, one row, however their number
 *    was typed in the spreadsheet.
 *  - The write is the same `onConflictDoUpdate` on (company_id, phone) that
 *    `addContact` uses, so a number already in the CRM is updated in place.
 *  - Blank cells never overwrite. Name, email and every attribute are merged in
 *    JS against the row already in the database, so a CSV with an empty Email
 *    column does not wipe emails the inbox collected.
 *
 * The chunk is de-duplicated by normalised phone before it is written, because
 * Postgres refuses an ON CONFLICT DO UPDATE that would touch the same row twice
 * in one statement — an export listing a customer on two lines would otherwise
 * fail the entire chunk rather than folding the two lines together.
 */
export async function importContactsChunk(
  input: ImportChunkInput
): Promise<ImportChunkResult> {
  const c = await ctx();
  if (!c) {
    return { ok: false, error: "Your session has expired. Sign in again, then re-run the import." };
  }

  const rows = Array.isArray(input?.rows) ? input.rows.slice(0, CHUNK_ROWS) : [];
  if (rows.length === 0) return { ok: true, outcomes: [] };

  const outcomes: RowOutcome[] = [];
  const prepared = new Map<string, PreparedRow>();

  for (const row of rows) {
    const line = Number(row?.line) || 0;
    const rawPhone = String(row?.phone ?? "");
    const check = checkPhone(rawPhone, await normalisePhone(rawPhone));
    if (!check.ok) {
      outcomes.push({ line, kind: "skipped", reason: check.reason, message: check.message });
      continue;
    }

    const name = String(row?.name ?? "").trim();
    const email = String(row?.email ?? "").trim();
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(row?.attributes ?? {})) {
      const value = String(v ?? "").trim();
      if (value) attributes[k] = value;
    }

    const seen = prepared.get(check.phone);
    if (seen) {
      // Same customer, further down the file. The later line fills in whatever
      // the earlier one left blank and is reported as folded, not as a write.
      seen.name = seen.name || name;
      seen.email = seen.email || email;
      seen.attributes = { ...seen.attributes, ...attributes };
      outcomes.push({ line, kind: "duplicate", phone: check.phone, ofLine: seen.line });
      continue;
    }
    prepared.set(check.phone, { line, phone: check.phone, name, email, attributes });
  }

  const pending = [...prepared.values()];
  if (pending.length === 0) {
    outcomes.sort((a, b) => a.line - b.line);
    return { ok: true, outcomes };
  }

  await ensureContactColumns();

  // Read before write: ON CONFLICT cannot report which rows it inserted and
  // which it updated, and "142 created, 38 updated" is the whole answer the
  // operator is looking for. The same read supplies the values to merge against.
  const existing = await c.db.query.contact.findMany({
    where: and(
      eq(contact.companyId, c.companyId),
      inArray(
        contact.phone,
        pending.map((p) => p.phone)
      )
    ),
  });
  const before = new Map(existing.map((e) => [e.phone, e]));

  const values = pending.map((p) => {
    const prior = before.get(p.phone);
    const merged = { ...attrs(prior?.attributes), ...p.attributes };
    return {
      companyId: c.companyId,
      phone: p.phone,
      name: p.name || prior?.name || null,
      email: p.email || prior?.email || null,
      // Only reached on a real insert: `source` is deliberately absent from the
      // conflict set below, so a contact that first arrived from WhatsApp keeps
      // saying so after a CSV touches it.
      source: "csv",
      attributes: Object.keys(merged).length > 0 ? merged : null,
      updatedAt: new Date(),
    };
  });

  const written = await c.db
    .insert(contact)
    .values(values)
    .onConflictDoUpdate({
      target: [contact.companyId, contact.phone],
      // The merge already happened in JS above, so every column here is just
      // the value this statement is carrying.
      set: {
        name: sql`excluded."name"`,
        email: sql`excluded."email"`,
        attributes: sql`excluded."attributes"`,
        updatedAt: sql`excluded."updated_at"`,
      },
    })
    .returning({ id: contact.id, phone: contact.phone });

  const writtenIds = new Map(written.map((w) => [w.phone, w.id]));
  for (const p of pending) {
    if (!writtenIds.has(p.phone)) {
      // Cannot happen with DO UPDATE, which returns a row per value. Reported
      // rather than assumed, so a row can never leave without a verdict.
      outcomes.push({
        line: p.line,
        kind: "skipped",
        reason: "not-written",
        message: `"${p.phone}" was not confirmed by the database — re-run the import to be sure of it`,
      });
      continue;
    }
    outcomes.push({
      line: p.line,
      kind: before.has(p.phone) ? "updated" : "created",
      phone: p.phone,
    });
  }

  const tagName = String(input?.tagName ?? "").trim().slice(0, 60);
  if (tagName && writtenIds.size > 0) {
    const tagId = await ensureTag(c.db, c.companyId, tagName);
    if (tagId) {
      await c.db
        .insert(contactTag)
        .values([...writtenIds.values()].map((contactId) => ({ contactId, tagId })))
        // contact_tag is keyed (contact_id, tag_id): a contact that already
        // carries the tag from an earlier run would collide on the primary key.
        .onConflictDoNothing();
    }
  }

  // Only the final chunk revalidates. Doing it per chunk would rebuild the
  // Contacts page twenty times behind an open panel for one import.
  if (input?.final) {
    revalidatePath("/contacts");
    revalidatePath("/dashboard");
    revalidatePath("/campaigns");
  }

  outcomes.sort((a, b) => a.line - b.line);
  return { ok: true, outcomes };
}
