"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { getCurrentMember } from "@/lib/current-member";
import { headerFileProblem, isHeaderMediaFormat, type HeaderMediaFormat } from "@/lib/template-media-limits";
import { saveTemplateMedia } from "@/lib/whatsapp/templateMedia";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  normaliseTemplateName,
  templateConfig,
  templateRequest,
  updateTemplate,
  type RemoteTemplate,
  type TemplateCategory,
  type TemplateDraft,
  type TemplateStatus,
} from "@/lib/whatsapp/templates";
import { saveTemplateBinding } from "@/lib/whatsapp/templateBindings";
import { uploadForHandle } from "@/lib/whatsapp/profile";
import { asBindings, type VarBinding } from "@/lib/automation/vars";
import { brandForCompanyId } from "@/lib/brand-company";
import { starterTemplates } from "./starterTemplates";

/** Auth gate. Templates steer what every customer receives, so a caller must
 *  be a signed-in member — the same bar settings mutations use. */
async function requireMember() {
  return await getCurrentMember();
}

/** A fallback name for a header file the browser handed over unnamed. */
function defaultHeaderName(format: HeaderMediaFormat): string {
  return format === "IMAGE" ? "header.jpg" : format === "VIDEO" ? "header.mp4" : "header.pdf";
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
  revalidatePath("/settings/templates");
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
  /** Standard or call permission request; carousels go through submitCarouselTemplate. */
  kind?: "standard" | "call_permission" | "carousel";
  /** Carousel cards without their images (for Copy as cURL). */
  cards?: { body: string; buttons: string[] }[];
  /** An image / PDF / video header; the file itself goes through submitMediaHeaderTemplate. */
  headerFormat?: "IMAGE" | "DOCUMENT" | "VIDEO";
}

/** The draft a standard / call-permission composer payload describes. */
function draftOf(payload: ComposerPayload): TemplateDraft {
  return {
    name: payload.name,
    language: payload.language,
    category: payload.category,
    header: payload.header?.trim() || undefined,
    body: payload.body,
    footer: payload.footer?.trim() || undefined,
    examples: payload.examples,
    buttons: payload.buttons.slice(0, 3).map((text) => ({ type: "QUICK_REPLY" as const, text })),
    kind: payload.kind === "call_permission" ? "call_permission" : "standard",
  };
}

/** Save the payload's {{n}} mapping under the name Meta will store. */
async function saveComposerBinding(companyId: string, payload: ComposerPayload) {
  const bindings = asBindings(payload.bindings);
  const key = normaliseTemplateName(payload.name);
  if (bindings.length > 0 && key) await saveTemplateBinding(companyId, key, payload.language, bindings);
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

  // Keyed by the name Meta will actually store (createTemplate normalises it too).
  await saveComposerBinding(me.companyId, payload);
  return await submitTemplate(draftOf(payload));
}

/**
 * Submit a template whose header is an image or a PDF. `payload` is the
 * ComposerPayload as JSON (with headerFormat); the file arrives as `header`.
 *
 * The file goes to Meta twice over its life: here, as the sample Meta reviews
 * (a Resumable Upload handle), and on every send, where Meta wants it again.
 * So once Meta accepts the template, Connect keeps the file for the sends.
 */
export async function submitMediaHeaderTemplate(fd: FormData): Promise<SubmitResult> {
  const me = await requireMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const cfg = templateConfig();
  if (!cfg) return { ok: false, error: "WhatsApp is not connected yet — WHATSAPP_WABA_ID and WHATSAPP_TOKEN are not set on the Worker." };
  let payload: ComposerPayload;
  try {
    payload = JSON.parse(String(fd.get("payload") ?? "{}")) as ComposerPayload;
  } catch {
    return { ok: false, error: "The template could not be read." };
  }
  const format = payload.headerFormat;
  if (!isHeaderMediaFormat(format)) return { ok: false, error: "The header type is missing." };
  const file = fd.get("header");
  if (!(file instanceof File)) return { ok: false, error: "Choose the header file." };
  const problem = headerFileProblem(format, file);
  if (problem) return { ok: false, error: problem };

  const bytes = await file.arrayBuffer();
  const fileName = file.name || defaultHeaderName(format);
  const up = await uploadForHandle(cfg, bytes, file.type, fileName);
  if (!up.ok) return { ok: false, error: `Header file: ${up.error}` };

  await saveComposerBinding(me.companyId, payload);
  const res = await submitTemplate({ ...draftOf(payload), header: undefined, kind: "standard", headerMedia: { format, handle: up.data } });
  if (!res.ok) return res;
  try {
    await saveTemplateMedia(getDb(), {
      name: normaliseTemplateName(payload.name),
      language: payload.language,
      format,
      mimeType: file.type,
      fileName,
      bytes,
      by: me.id,
    });
  } catch (e) {
    console.warn("[templates] header file not kept:", e);
    return {
      ok: false,
      error: "Meta accepted the template, but Connect could not keep its header file. Add the file again from the template's panel on the Templates page before sending it.",
    };
  }
  return res;
}

/**
 * Give an existing image / PDF header template the file Connect attaches when
 * sending it: one made outside Connect, or one whose file should change. Meta
 * is not asked to review anything; this only changes what each send carries.
 */
export async function setTemplateHeaderFile(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await requireMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const name = String(fd.get("name") ?? "").trim();
  const language = String(fd.get("language") ?? "").trim();
  const format = String(fd.get("format") ?? "");
  const file = fd.get("file");
  if (!name || !language || !isHeaderMediaFormat(format)) return { ok: false, error: "The template could not be read." };
  if (!(file instanceof File)) return { ok: false, error: "Choose the header file." };
  const problem = headerFileProblem(format, file);
  if (problem) return { ok: false, error: problem };
  try {
    await saveTemplateMedia(getDb(), {
      name,
      language,
      format,
      mimeType: file.type,
      fileName: file.name || defaultHeaderName(format),
      bytes: await file.arrayBuffer(),
      by: me.id,
    });
  } catch (e) {
    console.warn("[templates] header file not saved:", e);
    return { ok: false, error: "The file could not be saved. Try again." };
  }
  revalidatePath("/settings/templates");
  return { ok: true };
}

/**
 * The submit request as a cURL command, for the editor's "Copy as cURL". The
 * access token is never included — the command reads it from $WHATSAPP_TOKEN.
 */
export async function templateCurl(payload: ComposerPayload): Promise<{ ok: boolean; curl?: string; error?: string }> {
  if (!(await requireMember())) return { ok: false, error: "Not signed in." };
  const req = templateRequest(templateConfig()?.wabaId ?? "<WABA_ID>", {
    name: payload.name,
    language: payload.language,
    category: payload.category,
    header: payload.header?.trim() || undefined,
    body: payload.body,
    footer: payload.footer?.trim() || undefined,
    examples: payload.examples,
    buttons: payload.buttons.slice(0, 3).map((text) => ({ type: "QUICK_REPLY" as const, text })),
    kind: payload.kind ?? "standard",
    // A card's image handle only exists after the upload; the command shows where it goes.
    cards: payload.cards?.map((c) => ({ ...c, imageHandle: "<IMAGE_HANDLE>" })),
    // Same for a header file.
    headerMedia: payload.headerFormat ? { format: payload.headerFormat, handle: "<HEADER_HANDLE>" } : undefined,
  });
  if (!req.ok) return { ok: false, error: req.error };
  // Close the shell's single quote, emit an escaped quote, reopen: ' -> '\''
  const json = JSON.stringify(req.body, null, 2).replace(/'/g, `'\\''`);
  const bs = "\\";
  return {
    ok: true,
    curl: [
      `curl -X POST '${req.url}' ${bs}`,
      `  -H "Authorization: Bearer $WHATSAPP_TOKEN" ${bs}`,
      `  -H 'Content-Type: application/json' ${bs}`,
      `  -d '${json}'`,
    ].join("\n"),
  };
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
  revalidatePath("/settings/templates");
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
  revalidatePath("/settings/templates");
  return { ok: true };
}

export async function removeTemplate(formData: FormData): Promise<void> {
  if (!(await requireMember())) return;
  const cfg = templateConfig();
  if (!cfg) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await deleteTemplate(cfg, name);
  revalidatePath("/settings/templates");
}

export interface StarterResult {
  name: string;
  ok: boolean;
  status?: string;
  error?: string;
}

/** Submit every starter template that is not already on the WABA. */
export async function submitStarterSet(): Promise<StarterResult[]> {
  const me = await requireMember();
  if (!me) return [];
  // Worded for the signed-in company's brand (Houzs by default).
  const templates = starterTemplates(await brandForCompanyId(me.companyId));
  const cfg = templateConfig();
  if (!cfg) {
    return templates.map((t) => ({
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
  for (const t of templates) {
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
  revalidatePath("/settings/templates");
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
  revalidatePath("/settings/templates");
}

/**
 * Submit a carousel template: upload each card's image to Meta for a sample
 * handle, then create the template. `payload` is the ComposerPayload as JSON
 * plus `cards` ({ body, buttons }[]); the images arrive as image0, image1, …
 */
export async function submitCarouselTemplate(fd: FormData): Promise<SubmitResult> {
  const me = await requireMember();
  if (!me) return { ok: false, error: "Not signed in." };
  const cfg = templateConfig();
  if (!cfg) return { ok: false, error: "WhatsApp is not connected yet — WHATSAPP_WABA_ID and WHATSAPP_TOKEN are not set on the Worker." };
  let payload: ComposerPayload;
  try {
    payload = JSON.parse(String(fd.get("payload") ?? "{}")) as ComposerPayload;
  } catch {
    return { ok: false, error: "The template could not be read." };
  }
  const cards = payload.cards ?? [];
  const withImages = [];
  for (let i = 0; i < cards.length; i++) {
    const file = fd.get(`image${i}`);
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: `Card ${i + 1} has no image.` };
    if (!/^image\/(jpeg|png)$/.test(file.type)) return { ok: false, error: `Card ${i + 1}: Meta takes JPEG or PNG images only.` };
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: `Card ${i + 1}: the image is over 5 MB.` };
    const up = await uploadForHandle(cfg, await file.arrayBuffer(), file.type, file.name || `card-${i + 1}`);
    if (!up.ok) return { ok: false, error: `Card ${i + 1}: ${up.error}` };
    withImages.push({ imageHandle: up.data, body: cards[i].body, buttons: cards[i].buttons.filter((b) => b.trim()) });
  }
  await saveComposerBinding(me.companyId, payload);
  return await submitTemplate({
    name: payload.name,
    language: payload.language,
    category: payload.category,
    body: payload.body,
    examples: payload.examples,
    kind: "carousel",
    cards: withImages,
  });
}
