"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/current-member";

/** Create a WhatsApp Form. `fieldsText` is one "key | label | type" per line. */
export async function createForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const fieldsText = String(formData.get("fields") ?? "");
  if (!name) return;
  const me = await getCurrentMember();

  const fields = fieldsText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [key, label, type] = l.split("|").map((s) => s.trim());
      return { key: key || label, label: label || key, type: (type || "text").toLowerCase() };
    });

  await db.form.create({
    data: { companyId: me.companyId, name, status: "draft", fields },
  });
  revalidatePath("/forms");
}

export async function setFormStatus(formData: FormData) {
  const id = String(formData.get("formId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["draft", "published"].includes(status)) return;
  await db.form.update({ where: { id }, data: { status } });
  revalidatePath("/forms");
}

/** DEMO: simulate a customer submitting a form — stores a FormResponse and writes
 *  each answer onto the contact's attributes (LIVE captures this from a Meta Flow). */
export async function demoSubmitForm(formData: FormData) {
  const formId = String(formData.get("formId") ?? "");
  const contactId = String(formData.get("contactId") ?? "");
  const form = await db.form.findUnique({ where: { id: formId } });
  if (!form || !contactId) return;

  const fields = Array.isArray(form.fields) ? (form.fields as { key: string }[]) : [];
  const answers: Record<string, string> = {};
  for (const f of fields) {
    const v = String(formData.get(`ans_${f.key}`) ?? "").trim();
    if (v) answers[f.key] = v;
  }

  await db.formResponse.create({ data: { formId, contactId, answers } });

  const contact = await db.contact.findUnique({ where: { id: contactId } });
  if (contact) {
    const cur =
      contact.attributes && typeof contact.attributes === "object"
        ? (contact.attributes as Record<string, string>)
        : {};
    await db.contact.update({
      where: { id: contactId },
      data: { attributes: { ...cur, ...answers } },
    });
  }
  revalidatePath("/forms");
}
