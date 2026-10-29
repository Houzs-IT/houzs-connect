import { cache } from "react";
import { asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact as contactTable, contactField, form } from "@/db/schema";
import { attrs } from "@/lib/format";
import { BUILT_IN_FIELDS, templateBindingGaps } from "@/lib/automation/vars";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { getCurrentMember } from "@/lib/current-member";
import { brandForCompanyId } from "@/lib/brand-company";
import { DEFAULT_BRAND } from "@/lib/brand";
import { demoTemplates } from "@/lib/whatsapp/demo-templates";
import { listTemplates, templateConfig, type RemoteTemplate } from "@/lib/whatsapp/templates";
import { bindingKey, loadTemplateBindings, type StoredBinding } from "@/lib/whatsapp/templateBindings";
import type { FieldOption, SampleContact } from "./types";

/*
  Reads shared by the Templates & Forms menu and its pages. Wrapped in React's
  per-request cache so the menu (in the layout) and the page ask Meta for the
  template list once per render, not twice.
*/

export type TemplateList = { configured: boolean; templates: RemoteTemplate[]; error?: string };

export const loadTemplateList = cache(async (): Promise<TemplateList> => {
  const cfg = templateConfig();
  // DEMO mode shows sample templates so the page can be tried before Meta is
  // connected; a LIVE install without Meta settings still says so. The samples
  // are worded for the current company's brand (Houzs by default).
  if (!cfg) {
    if (isLive()) return { configured: false, templates: [] };
    const me = await getCurrentMember();
    const brand = me ? await brandForCompanyId(me.companyId) : DEFAULT_BRAND;
    return { configured: true, templates: demoTemplates(brand) };
  }
  const res = await listTemplates(cfg);
  if (!res.ok) return { configured: true, templates: [], error: res.error };
  return { configured: true, templates: res.templates };
});

/** Saved {{n}} mappings. Degrades to empty (with the error) rather than throwing. */
export const loadBindings = cache(
  async (companyId: string): Promise<{ map: Map<string, StoredBinding>; error: string | null }> => {
    try {
      return { map: await loadTemplateBindings(companyId), error: null };
    } catch (e) {
      return { map: new Map(), error: e instanceof Error ? e.message : String(e) };
    }
  }
);

/** Templates whose body has a {{n}} with nothing saved behind it. */
export function needsMapping(t: RemoteTemplate, map: Map<string, StoredBinding>): boolean {
  return templateBindingGaps(t.body, map.get(bindingKey(t.name, t.language))?.bindings ?? []).length > 0;
}

export const loadFormCounts = cache(async (companyId: string) => {
  const rows = await getDb()
    .select({ status: form.status, n: count() })
    .from(form)
    .where(eq(form.companyId, companyId))
    .groupBy(form.status);
  const by = new Map(rows.map((r) => [r.status, r.n]));
  const total = rows.reduce((n, r) => n + r.n, 0);
  return { total, published: by.get("published") ?? 0, draft: total - (by.get("published") ?? 0) };
});

/**
 * Everything a {{n}} can point at, and a real contact to preview with — the one
 * with the most attributes filled in, so the preview exercises as many bindings
 * as possible. Real, not invented: a preview from made-up values proves nothing
 * about whether the mapping points at fields this company's contacts carry.
 */
export const loadFieldsAndSample = cache(
  async (companyId: string): Promise<{ fields: FieldOption[]; sample: SampleContact | null; samples: SampleContact[] }> => {
    const builtins: FieldOption[] = BUILT_IN_FIELDS.map((f) => ({ ...f, builtin: true }));
    const db = getDb();
    const [custom, contacts] = await Promise.all([
      db.query.contactField.findMany({ where: eq(contactField.companyId, companyId), orderBy: asc(contactField.name) }),
      db.query.contact.findMany({
        where: eq(contactTable.companyId, companyId),
        orderBy: desc(contactTable.updatedAt),
        limit: 25,
      }),
    ]);
    const ranked = contacts.map((r) => {
      const a = attrs(r.attributes);
      const s: SampleContact = {
        label: r.name?.trim() || r.phone,
        name: r.name,
        phone: r.phone,
        email: r.email,
        source: r.source,
        sourceId: r.sourceId,
        sourceUrl: r.sourceUrl,
        attributes: a,
      };
      return { s, filled: Object.values(a).filter((v) => v != null && String(v).trim() !== "").length };
    });
    ranked.sort((x, y) => y.filled - x.filled);
    const clean = ranked.map((r) => r.s);
    return {
      fields: [...builtins, ...custom.map((f) => ({ key: f.key, name: f.name }))],
      sample: clean[0] ?? null,
      samples: clean.slice(0, 8),
    };
  }
);
