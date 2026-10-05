"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, contactTag, conversationTag, tag } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { can } from "@/lib/permissions";

type Result = { ok: boolean; error?: string };

/** Tags are company-wide: changing or deleting one is a Settings permission. */
async function manager() {
  const me = await getCurrentMember();
  if (!me || !(await can(me, "settings"))) return null;
  return me;
}

/** Everywhere a tag's name and colour show: Contacts' menu, Service, Settings. */
function refresh() {
  revalidatePath("/contacts", "layout");
  revalidatePath("/inbox", "layout");
  revalidatePath("/settings", "layout");
}

const cleanColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : "#16695f");

export async function createTag(name: string, color: string): Promise<Result> {
  const me = await manager();
  if (!me) return { ok: false, error: "Only people who can change settings can add tags." };
  const n = name.trim().slice(0, 40);
  if (!n) return { ok: false, error: "Give the tag a name." };
  const db = getDb();
  const dup = await db.query.tag.findFirst({ where: and(eq(tag.companyId, me.companyId), eq(tag.name, n)), columns: { id: true } });
  if (dup) return { ok: false, error: "A tag with that name already exists." };
  await db.insert(tag).values({ companyId: me.companyId, name: n, color: cleanColor(color) });
  refresh();
  return { ok: true };
}

export async function updateTag(id: string, name: string, color: string): Promise<Result> {
  const me = await manager();
  if (!me) return { ok: false, error: "Only people who can change settings can edit tags." };
  const n = name.trim().slice(0, 40);
  if (!n) return { ok: false, error: "Give the tag a name." };
  const db = getDb();
  const clash = await db.query.tag.findFirst({ where: and(eq(tag.companyId, me.companyId), eq(tag.name, n)), columns: { id: true } });
  if (clash && clash.id !== id) return { ok: false, error: "A tag with that name already exists." };
  await db
    .update(tag)
    .set({ name: n, color: cleanColor(color) })
    .where(and(eq(tag.id, id), eq(tag.companyId, me.companyId)));
  refresh();
  return { ok: true };
}

/**
 * Delete a tag and take it off every contact and conversation. Nothing in the
 * database removes those links by itself, and a link left behind points at a
 * tag that no longer exists.
 */
export async function deleteTagEverywhere(id: string): Promise<Result> {
  const me = await manager();
  if (!me) return { ok: false, error: "Only people who can change settings can delete tags." };
  const db = getDb();
  const own = await db.query.tag.findFirst({ where: and(eq(tag.id, id), eq(tag.companyId, me.companyId)), columns: { id: true } });
  if (!own) return { ok: false, error: "That tag is already gone." };
  await db.transaction(async (tx) => {
    await tx.delete(contactTag).where(eq(contactTag.tagId, id));
    await tx.delete(conversationTag).where(eq(conversationTag.tagId, id));
    await tx.delete(tag).where(eq(tag.id, id));
  });
  refresh();
  return { ok: true };
}

/** Put a tag on one contact, or take it off. Anyone who works with contacts can. */
export async function setContactTag(contactId: string, tagId: string, on: boolean): Promise<Result> {
  const me = await getCurrentMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const db = getDb();
  const [c, tg] = await Promise.all([
    db.query.contact.findFirst({ where: and(eq(contact.id, contactId), eq(contact.companyId, me.companyId)), columns: { id: true } }),
    db.query.tag.findFirst({ where: and(eq(tag.id, tagId), eq(tag.companyId, me.companyId)), columns: { id: true } }),
  ]);
  if (!c || !tg) return { ok: false, error: "That contact or tag is not in this company." };
  if (on) await db.insert(contactTag).values({ contactId, tagId }).onConflictDoNothing();
  else await db.delete(contactTag).where(and(eq(contactTag.contactId, contactId), inArray(contactTag.tagId, [tagId])));
  revalidatePath("/contacts", "layout");
  return { ok: true };
}
