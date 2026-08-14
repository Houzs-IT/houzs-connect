"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  templateConfig,
  type RemoteTemplate,
  type TemplateCategory,
  type TemplateDraft,
} from "@/lib/whatsapp/templates";
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

/** Form-action wrapper for the composer. */
export async function submitTemplateForm(formData: FormData): Promise<void> {
  const buttonsRaw = String(formData.get("buttons") ?? "").trim();
  const examplesRaw = String(formData.get("examples") ?? "").trim();
  await submitTemplate({
    name: String(formData.get("name") ?? ""),
    language: String(formData.get("language") ?? "en"),
    category: (String(formData.get("category") ?? "UTILITY") as TemplateCategory),
    body: String(formData.get("body") ?? ""),
    footer: String(formData.get("footer") ?? "") || undefined,
    examples: examplesRaw ? examplesRaw.split("\n").map((s) => s.trim()).filter(Boolean) : [],
    buttons: buttonsRaw
      ? buttonsRaw
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((text) => ({ type: "QUICK_REPLY" as const, text }))
      : undefined,
  });
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
