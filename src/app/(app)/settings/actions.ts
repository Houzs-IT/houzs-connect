"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contactField, contactTag, conversationTag, quickReply, tag } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

/** Auth + company scope for every settings mutation. Null when unauthenticated. */
async function ctx() {
  const me = await getCurrentMember();
  if (!me) return null;
  return { db: getDb(), companyId: me.companyId };
}

// ── Quick replies ──────────────────────────────────────────
export async function addQuickReply(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const shortcut = String(formData.get("shortcut") ?? "").trim().replace(/^\/+/, "");
  const body = String(formData.get("body") ?? "").trim();
  if (!shortcut || !body) return;
  await c.db
    .insert(quickReply)
    .values({ companyId: c.companyId, shortcut, body })
    .onConflictDoUpdate({ target: [quickReply.companyId, quickReply.shortcut], set: { body } });
  revalidatePath("/settings", "layout");
}

export async function deleteQuickReply(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await c.db.delete(quickReply).where(and(eq(quickReply.id, id), eq(quickReply.companyId, c.companyId)));
  revalidatePath("/settings", "layout");
}

// ── Contact fields (the CRM attribute schema) ──────────────
export async function addContactField(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // Derive a stable key from the name when none given.
  const key =
    String(formData.get("key") ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const typeRaw = String(formData.get("type") ?? "TEXT").toUpperCase();
  const type = (["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"].includes(typeRaw) ? typeRaw : "TEXT") as
    | "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT";
  if (!key) return;
  await c.db
    .insert(contactField)
    .values({ companyId: c.companyId, key, name, type })
    .onConflictDoUpdate({ target: [contactField.companyId, contactField.key], set: { name, type } });
  revalidatePath("/settings", "layout");
}

export async function deleteContactField(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await c.db.delete(contactField).where(and(eq(contactField.id, id), eq(contactField.companyId, c.companyId)));
  revalidatePath("/settings", "layout");
}

// ── Tags ────────────────────────────────────────────────────
export async function addTag(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const color = String(formData.get("color") ?? "").trim() || "#16695f";
  await c.db
    .insert(tag)
    .values({ companyId: c.companyId, name, color })
    .onConflictDoUpdate({ target: [tag.companyId, tag.name], set: { color } });
  revalidatePath("/settings", "layout");
}

export async function deleteTag(formData: FormData) {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const own = await c.db.query.tag.findFirst({ where: and(eq(tag.id, id), eq(tag.companyId, c.companyId)), columns: { id: true } });
  if (!own) return;
  // Nothing removes a deleted tag's links by itself; take it off everything first.
  await c.db.transaction(async (tx) => {
    await tx.delete(contactTag).where(eq(contactTag.tagId, id));
    await tx.delete(conversationTag).where(eq(conversationTag.tagId, id));
    await tx.delete(tag).where(eq(tag.id, id));
  });
  revalidatePath("/settings", "layout");
  revalidatePath("/contacts", "layout");
  revalidatePath("/inbox", "layout");
}
