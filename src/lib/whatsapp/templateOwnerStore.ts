// Reading and writing the MANUAL company override for a WhatsApp template.
//
// `templateOwner()` (templateCompany.ts) infers a template's brand from its
// wording; this is the human's last word when that guess is wrong — most often
// a Houzs template whose copy never says "Houzs" and so looked SHARED. Global
// (a template is one shared-WABA asset) and keyed by template NAME, so it holds
// across the template's language variants.

import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { templateOwnerOverride } from "@/db/schema";
import { ensureTemplateOwnerTable } from "@/db/ensure-template-owner";
import { SHARED_OWNER, type TemplateOwner } from "./templateCompany";

const OWNERS = new Set<TemplateOwner>(["HOUZS", "2990", "HOOKKA", "THECONTS", SHARED_OWNER]);

/** A stored string back to a TemplateOwner, or null if it is not one we know. */
export function asTemplateOwner(v: string | null | undefined): TemplateOwner | null {
  return v && OWNERS.has(v as TemplateOwner) ? (v as TemplateOwner) : null;
}

/** Every manual override, keyed by template name. */
export async function loadTemplateOwnerOverrides(): Promise<Map<string, TemplateOwner>> {
  const db = getDb();
  await ensureTemplateOwnerTable(db);
  const rows = await db.query.templateOwnerOverride.findMany();
  const out = new Map<string, TemplateOwner>();
  for (const r of rows) {
    const owner = asTemplateOwner(r.owner);
    if (owner) out.set(r.templateName, owner);
  }
  return out;
}

/**
 * Pin a template's company, or clear the override (owner `null`) to fall back
 * to the wording-based guess. SHARED is a real choice — it forces "no brand"
 * even when the wording would otherwise detect one.
 */
export async function setTemplateOwnerOverride(
  templateName: string,
  owner: TemplateOwner | null,
  by?: string | null
): Promise<void> {
  const db = getDb();
  await ensureTemplateOwnerTable(db);
  if (!owner) {
    await db.delete(templateOwnerOverride).where(eq(templateOwnerOverride.templateName, templateName));
    return;
  }
  await db
    .insert(templateOwnerOverride)
    .values({ templateName, owner, updatedBy: by ?? null })
    .onConflictDoUpdate({
      target: templateOwnerOverride.templateName,
      set: { owner, updatedBy: by ?? null, updatedAt: new Date() },
    });
}
