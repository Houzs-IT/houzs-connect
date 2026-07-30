"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  contact as contactTable,
  form as formTable,
  formResponse as formResponseTable,
} from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

/** Create a WhatsApp Form. `fieldsText` is one "key | label | type" per line. */
export async function createForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const fieldsText = String(formData.get("fields") ?? "");
  if (!name) return;
  const me = await getCurrentMember();
  if (!me) return;

  const fields = fieldsText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [key, label, type] = l.split("|").map((s) => s.trim());
      return { key: key || label, label: label || key, type: (type || "text").toLowerCase() };
    });

  const db = getDb();
  await db.insert(formTable).values({ companyId: me.companyId, name, status: "draft", fields });
  revalidatePath("/forms");
}

export async function setFormStatus(formData: FormData) {
  const id = String(formData.get("formId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["draft", "published"].includes(status)) return;
  const db = getDb();
  await db.update(formTable).set({ status }).where(eq(formTable.id, id));
  revalidatePath("/forms");
}

/** DEMO: simulate a customer submitting a form — stores a FormResponse and writes
 *  each answer onto the contact's attributes (LIVE captures this from a Meta Flow). */
export async function demoSubmitForm(formData: FormData) {
  const formId = String(formData.get("formId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const db = getDb();
  const form = await db.query.form.findFirst({ where: eq(formTable.id, formId) });
  if (!form || !contactId) return;

  const fields = Array.isArray(form.fields) ? (form.fields as { key: string }[]) : [];
  const answers: Record<string, string> = {};
  for (const f of fields) {
    const v = String(formData.get(`ans_${f.key}`) ?? "").trim();
    if (v) answers[f.key] = v;
  }

  await db.insert(formResponseTable).values({ formId, contactId, answers });

  const contact = await db.query.contact.findFirst({ where: eq(contactTable.id, contactId) });
  if (contact) {
    const cur =
      contact.attributes && typeof contact.attributes === "object"
        ? (contact.attributes as Record<string, string>)
        : {};
    await db
      .update(contactTable)
      .set({ attributes: { ...cur, ...answers } })
      .where(eq(contactTable.id, contactId));
  }
  revalidatePath("/forms");
}
