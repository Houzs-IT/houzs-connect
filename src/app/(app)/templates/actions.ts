"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  templateConfig,
  updateTemplate,
  type RemoteTemplate,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateStatus,
} from "@/lib/whatsapp/templates";
import { saveTemplateBinding } from "@/lib/whatsapp/templateBindings";
import { asBindings, type VarBinding } from "@/lib/automation/vars";
import { STARTER_TEMPLATES } from "./starterTemplates";

/** Auth gate. Templates steer what every customer receives, so a caller must
 *  be a signed-in member — the same bar settings mutations use. */
async function requireMember() {
  return await getCurrentMember();
}

export interface TemplateListResult {
  configured: boolean;
  templates: RemoteTemplate[];
  error?: string;
}

/** Pull the live template list off the WABA (Seampify's "Synchronize"). */
export async function fetchTemplates(): Promise<TemplateListResult> {
  if (!(await requireMember())) return { configured: false, templates: [] };
  const cfg = templateConfig();
  if (!cfg) return { configured: false, templates: [] };
  const res = await listTemplates(cfg);
  if (!res.ok) return { configured: true, templates: [], error: res.error };
  return { configured: true, templates: res.templates };
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  id?: string;
  status?: string;
}

/** Submit one template to Meta for review. */
export async function submitTemplate(draft: TemplateDraft): Promise<SubmitResult> {
  if (!(await requireMember())) return { ok: false, error: "Not signed in." };
  const cfg = templateConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "WhatsApp is not connected yet — WHATSAPP_WABA_ID and WHATSAPP_TOKEN are not set on the Worker.",
    };
  }
  const res = await createTemplate(cfg, draft);
  revalidatePath("/templates");
  return res.ok ? { ok: true, id: res.id, status: res.status } : { ok: false, error: res.error };
}

/** What the composer posts: the template, plus what fills each of its {{n}}. */
export interface ComposerPayload {
  name: string;
  language: string;
  category: TemplateCategory;
  header?: string;
  body: string;
  footer?: string;
  examples: string[];
  buttons: string[];
  bindings: VarBinding[];
}

/**
 * Submit a template AND save its variable mapping in one action.
 *
 * The two belong together: a template submitted without a mapping is a template
 * whose automated sends would arrive with "-" in every slot, and the moment to
 * capture the mapping is while the person who wrote the copy is still looking
 * at it. The mapping is saved even when Meta rejects the submission, so a
 * resubmit under the same name does not have to be re-mapped.
 */
export async function submitTemplateWithBinding(
  payload: ComposerPayload
): Promise<SubmitResult> {
  const me = await requireMember();
  if (!me) return { ok: false, error: "Not signed in." };

  const draft: TemplateDraft = {
    name: payload.name,
    language: payload.language,
    category: payload.category,
    header: payload.header?.trim() || undefined,
    body: payload.body,
    footer: payload.footer?.trim() || undefined,
    examples: payload.examples,
    buttons: payload.buttons.slice(0, 3).map((text) => ({ type: "QUICK_REPLY" as const, text })),
  };

  const bindings = asBindings(payload.bindings);
  if (bindings.length > 0) {
    // normaliseTemplateName runs inside createTemplate; mirror it here so the
    // mapping is keyed by the name Meta will actually store.
    const key = payload.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (key) await saveTemplateBinding(me.companyId, key, payload.language, bindings);
  }

  return await submitTemplate(draft);
}

/** Save (or replace) the {{n}} → field mapping for one existing template. */
export async function saveBindingAction(
  templateName: string,
  language: string,
  bindings: VarBinding[]
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireMember();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!templateName || !language) return { ok: false, error: "Missing template name or language." };
  await saveTemplateBinding(me.companyId, templateName, language, asBindings(bindings));
  revalidatePath("/templates");
  return { ok: true };
}

/** What an edit sends to Meta. Name and language are fixed — Meta identifies the
 *  template by them and its update endpoint does not accept a change to either. */
export interface EditPayload {
  templateId: string;
  status: TemplateStatus;
  header?: string;
  body: string;
  footer?: string;
  examples: string[];
  buttons: string[];
  /** Carried so the mapping can be re-saved alongside the new copy. */
  templateName: string;
  language: string;
  bindings: VarBinding[];
}

/**
 * Edit an approved / rejected / paused template.
 *
 * Meta re-reviews after an edit, so an approved template goes back to PENDING
 * briefly and returns to APPROVED unless the new copy fails review.
 */
export async function editTemplateAction(
  payload: EditPayload
): Promise<{ ok: boolean; error?: string }> {
  const me = await requireMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const cfg = templateConfig();
  if (!cfg) {
    return {
      ok: false,
      error: "WhatsApp is not connected yet — WHATSAPP_WABA_ID and WHATSAPP_TOKEN are not set on the Worker.",
    };
  }

  const res = await updateTemplate(cfg, payload.templateId, payload.status, {
    name: payload.templateName,
    language: payload.language,
    category: "UTILITY", // unused by updateTemplate — category is never sent on an edit
    header: payload.header?.trim() || undefined,
    body: payload.body,
    footer: payload.footer?.trim() || undefined,
    examples: payload.examples,
    buttons: payload.buttons.slice(0, 3).map((text) => ({ type: "QUICK_REPLY" as const, text })),
  });
  if (!res.ok) return { ok: false, error: res.error };

  // The copy changed, so the mapping may have too (a new {{5}}, a reordered
  // body). Save it in the same breath rather than leaving the two out of step.
  await saveTemplateBinding(
    me.companyId,
    payload.templateName,
    payload.language,
    asBindings(payload.bindings)
  );
  revalidatePath("/templates");
  return { ok: true };
}

export async function removeTemplate(formData: FormData): Promise<void> {
  if (!(await requireMember())) return;
  const cfg = templateConfig();
  if (!cfg) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await deleteTemplate(cfg, name);
  revalidatePath("/templates");
}

export interface StarterResult {
  name: string;
  ok: boolean;
  status?: string;
  error?: string;
}

/** Submit every starter template that is not already on the WABA. */
export async function submitStarterSet(): Promise<StarterResult[]> {
  if (!(await requireMember())) return [];
  const cfg = templateConfig();
  if (!cfg) {
    return STARTER_TEMPLATES.map((t) => ({
      name: t.name,
      ok: false,
      error: "WhatsApp is not connected yet (WHATSAPP_WABA_ID / WHATSAPP_TOKEN missing).",
    }));
  }

  // Skip anything already there — resubmitting an existing name is a 400 from
  // Meta, and a partial run must be safe to repeat.
  const existing = await listTemplates(cfg);
  const have = new Set(existing.ok ? existing.templates.map((t) => t.name) : []);

  const out: StarterResult[] = [];
  for (const t of STARTER_TEMPLATES) {
    if (have.has(t.name)) {
      out.push({ name: t.name, ok: true, status: "ALREADY_EXISTS" });
      continue;
    }
    const res = await createTemplate(cfg, t);
    out.push(
      res.ok
        ? { name: t.name, ok: true, status: res.status }
        : { name: t.name, ok: false, error: res.error }
    );
  }
  revalidatePath("/templates");
  return out;
}

/**
 * Seampify's "Synchronize with Facebook".
 *
 * This page already reads templates live from the Graph API on every render, so
 * there is no local copy to reconcile — what a sync button does here is discard
 * the rendered page and ask Meta again. That matters while templates sit in
 * PENDING: approval lands on Meta's side with no notification to us, and the
 * only way to learn about it is to look again.
 */
export async function syncTemplates(): Promise<void> {
  revalidatePath("/templates");
}
