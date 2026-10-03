"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { form as formTable, formResponse as formResponseTable } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { normaliseFields, parseFieldLines, type FormField } from "./fields";

/**
 * A signed-in member, and the form must belong to their company.
 *
 * Every export in a "use server" module is a live POST endpoint. `setFormStatus`
 * had neither check: it took a form id off the wire and flipped that form's
 * status, so anyone who could reach the endpoint with any company's form id
 * could publish or unpublish it. Same pattern as `settings/actions.ts`.
 */
async function authorizeForm(formId: string) {
  if (!formId) return null;
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const row = await db.query.form.findFirst({
    where: and(eq(formTable.id, formId), eq(formTable.companyId, me.companyId)),
  });
  if (!row) return null;
  return { me, db, form: row };
}

/**
 * Create a WhatsApp Form. `fields` is the optional "key | label | type" per
 * line shorthand; questions are normally added on the form's own page, which
 * this opens.
 */
export async function createForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const fieldsText = String(formData.get("fields") ?? "");
  if (!name) return;
  const me = await getCurrentMember();
  if (!me) return;

  const fields = parseFieldLines(fieldsText);

  const db = getDb();
  const [row] = await db
    .insert(formTable)
    .values({ companyId: me.companyId, name, status: "draft", fields })
    .returning();

  revalidatePath("/forms");
  if (row) redirect(`/forms?f=${row.id}`);
}

/** Rename a form and replace its questions. */
export async function updateForm(
  formId: string,
  name: string,
  fields: FormField[]
) {
  const auth = await authorizeForm(formId);
  if (!auth) return { ok: false as const, error: "not found" };
  const clean = name.trim();
  if (!clean) return { ok: false as const, error: "A name is required" };

  await auth.db
    .update(formTable)
    .set({ name: clean, fields: normaliseFields(fields) })
    .where(eq(formTable.id, formId));

  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
  return { ok: true as const };
}

/**
 * Publish a form (customers can be sent it) or pull it back to a draft.
 *
 * The status column stores "draft" / "published"; that wording never reaches
 * the screen — the UI says "In use" and "Draft".
 */
export async function setFormStatus(formId: string, published: boolean) {
  const auth = await authorizeForm(formId);
  if (!auth) return { ok: false as const, error: "not found" };
  await auth.db
    .update(formTable)
    .set({ status: published ? "published" : "draft" })
    .where(eq(formTable.id, formId));
  revalidatePath("/forms");
  revalidatePath(`/forms/${formId}`);
  return { ok: true as const, published };
}

/** Copy a form and its questions as a new draft. */
export async function duplicateForm(formId: string) {
  const auth = await authorizeForm(formId);
  if (!auth) return { ok: false as const, error: "not found" };
  const src = auth.form;
  const [row] = await auth.db
    .insert(formTable)
    .values({
      companyId: src.companyId,
      name: `${src.name} (copy)`,
      status: "draft",
      fields: normaliseFields(src.fields),
    })
    .returning();
  if (!row) return { ok: false as const, error: "could not copy" };
  revalidatePath("/forms");
  return { ok: true as const, id: row.id };
}

/**
 * Delete a form and the answers collected through it. `form_response` points at
 * the form with a plain text column and no database cascade, so the answers are
 * removed here — otherwise every delete strands them.
 */
export async function deleteForm(formId: string) {
  const auth = await authorizeForm(formId);
  if (!auth) return { ok: false as const, error: "not found" };
  await auth.db
    .delete(formResponseTable)
    .where(eq(formResponseTable.formId, formId));
  await auth.db.delete(formTable).where(eq(formTable.id, formId));
  revalidatePath("/forms");
  return { ok: true as const };
}

/*
  Removed: `demoSubmitForm`, which fabricated a form response for any contact id
  and merged the invented answers into that contact's attributes. Nothing in the
  UI called it, but a "use server" export is a live POST endpoint — and this one
  checked neither the session nor the company. Real answers arrive from Meta's
  WhatsApp Flow webhook.
*/
