// Publish a houzs-connect form as a Meta WhatsApp Flow (a "form"), so the
// send_form automation node can send it (src/lib/automation/engine.ts ->
// cloud-api.ts sendFlow). DEMO-safe: without LIVE mode + a WABA id this does
// nothing and publishing a form just flips its status column.
// Docs: https://developers.facebook.com/docs/whatsapp/flows/reference/flowsapi
import { isLive } from "./cloud-api";
import { metaToken } from "./token";
import { readFields, keyFromLabel } from "@/app/(app)/forms/fields";

const GRAPH = "https://graph.facebook.com/v23.0";
// The Flow JSON version this builder targets; bump if Meta deprecates it.
const FLOW_JSON_VERSION = "7.0";
const SCREEN_ID = "FORM";

/** True when a form CAN be published to Meta (LIVE + a Business Account id). */
export function isFlowsConfigured(): boolean {
  return isLive() && !!process.env.WHATSAPP_WABA_ID;
}

/** Options for a `select` field live on the raw jsonb row (`options: string[]`);
 *  the clean FormField drops them, so read them back by matching the field key. */
function optionsFor(raw: Record<string, unknown>[], key: string): string[] {
  const row = raw.find((x) => {
    if (!x || typeof x !== "object") return false;
    const rawKey = typeof x.key === "string" ? x.key.trim() : "";
    const label = typeof x.label === "string" ? x.label : "";
    return (rawKey || keyFromLabel(label)) === key;
  });
  const o = row?.options;
  return Array.isArray(o) ? o.map((v) => String(v)).filter(Boolean) : [];
}

/**
 * Build a Meta Flow JSON (one terminal screen) from a form's fields. Each field
 * becomes an input whose `name` is the field key, and Submit completes the flow
 * returning { <key>: value } — which the inbound webhook writes onto the contact.
 * A `select` with options renders a Dropdown; without options it falls back to a
 * text input (the field model has no options UI yet).
 */
export function buildFlowJson(name: string, rawFields: unknown): Record<string, unknown> {
  const fields = readFields(rawFields);
  const raw = Array.isArray(rawFields) ? (rawFields as Record<string, unknown>[]) : [];

  const children: Record<string, unknown>[] = [];
  const payload: Record<string, string> = {};
  for (const f of fields) {
    payload[f.key] = `\${form.${f.key}}`;
    const label = f.label.slice(0, 80);
    if (f.type === "date") {
      children.push({ type: "DatePicker", name: f.key, label });
    } else if (f.type === "select") {
      const opts = optionsFor(raw, f.key);
      if (opts.length) {
        children.push({
          type: "Dropdown",
          name: f.key,
          label,
          "data-source": opts.map((o, i) => ({ id: String(i), title: o.slice(0, 30) })),
        });
      } else {
        children.push({ type: "TextInput", name: f.key, label, "input-type": "text" });
      }
    } else {
      const inputType =
        f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "phone" : "text";
      children.push({ type: "TextInput", name: f.key, label, "input-type": inputType });
    }
  }
  children.push({
    type: "Footer",
    label: "Submit",
    "on-click-action": { name: "complete", payload },
  });

  return {
    version: FLOW_JSON_VERSION,
    screens: [
      {
        id: SCREEN_ID,
        title: name.slice(0, 30),
        terminal: true,
        data: {},
        layout: {
          type: "SingleColumnLayout",
          children: [{ type: "Form", name: "form", children }],
        },
      },
    ],
  };
}

export type PublishFlowResult =
  /** `reused` = an already-PUBLISHED flow of this id/name was found; nothing was sent. */
  | { ok: true; flowId: string; reused?: boolean }
  /** `flowId` is set when the flow EXISTS on Meta (created or adopted) but could
   *  not be published — the caller stores it so the next attempt updates that
   *  draft instead of creating a second flow (which Meta refuses: names must
   *  be unique within a WABA). */
  | { ok: false; error: string; flowId?: string };

interface MetaBody {
  id?: string;
  success?: boolean;
  status?: string;
  data?: { id?: string; name?: string; status?: string }[];
  validation_errors?: { message?: string }[];
  error?: { error_user_msg?: string; message?: string; code?: number; error_subcode?: number };
}

async function graphCall(
  token: string,
  path: string,
  init: { method?: string; json?: unknown; form?: FormData }
): Promise<{ res: Response; body: MetaBody | null } | null> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${GRAPH}/${path}`, { method: init.method ?? "GET", headers, body }).catch(
    () => null
  );
  if (!res) return null;
  const parsed = (await res.json().catch(() => null)) as MetaBody | null;
  return { res, body: parsed };
}

function metaError(r: { res: Response; body: MetaBody | null } | null, fallback: string): string {
  if (!r) return "Could not reach Meta (network error).";
  const e = r.body?.error;
  return e?.error_user_msg ?? e?.message ?? `${fallback} (HTTP ${r.res.status}).`;
}

function validationMessage(body: MetaBody | null): string | null {
  const v = body?.validation_errors;
  if (!v?.length) return null;
  return `Flow validation failed: ${v.map((x) => x.message).filter(Boolean).join("; ") || "see Meta Flow Builder"}`;
}

/** Meta's wording when the WABA already has a flow of that name. */
function isNameTaken(message: string): boolean {
  return /unique|already (exists|in use|taken)|another name/i.test(message);
}

/** The flow's status on Meta, or null when it cannot be read (deleted, wrong id). */
async function flowStatus(token: string, flowId: string): Promise<string | null> {
  const r = await graphCall(token, `${flowId}?fields=status`, {});
  if (!r || !r.res.ok) return null;
  return r.body?.status ?? null;
}

/**
 * The WABA's flow with exactly this name, DRAFT preferred over PUBLISHED, so an
 * earlier half-finished attempt (created, never published) is picked up rather
 * than an old live one. DEPRECATED / BLOCKED ones are ignored.
 */
async function findFlowByName(
  token: string,
  waba: string,
  name: string
): Promise<{ id: string; status: string } | null> {
  const r = await graphCall(token, `${waba}/flows?fields=id,name,status&limit=200`, {});
  const rows = r?.res.ok ? (r.body?.data ?? []) : [];
  const same = rows.filter((f) => f.id && f.name === name);
  const pick = same.find((f) => f.status === "DRAFT") ?? same.find((f) => f.status === "PUBLISHED");
  return pick ? { id: String(pick.id), status: String(pick.status ?? "") } : null;
}

/**
 * Publish a form as a Meta WhatsApp Flow, idempotently.
 *
 * Meta's create call (`POST /{WABA}/flows` with `publish: true`) is two things
 * in one: it CREATES the flow (which succeeds and leaves a DRAFT behind) and then
 * PUBLISHES it (which can fail — integrity checks, validation). The first
 * version of this function treated that as one failure, so a retry asked Meta to
 * create a SECOND flow of the same name and got "Flow name should be unique".
 * Now: an existing flow (the stored id, or one of this name on the WABA) is
 * UPDATED and published; only a genuinely new form creates one. Whatever
 * happens, the flow id is returned so the caller can store it.
 *
 * Caller must check isFlowsConfigured() first.
 */
export async function publishFlow(form: {
  name: string;
  fields: unknown;
  metaFlowId?: string | null;
}): Promise<PublishFlowResult> {
  const waba = process.env.WHATSAPP_WABA_ID;
  const token = metaToken();
  if (!waba || !token) {
    return { ok: false, error: "WhatsApp Flows is not configured (WHATSAPP_WABA_ID / token)." };
  }
  const name = form.name.slice(0, 200);
  const flowJson = JSON.stringify(buildFlowJson(form.name, form.fields));

  // 1. A flow we already know about.
  let flowId = (form.metaFlowId ?? "").trim();
  if (flowId) {
    const status = await flowStatus(token, flowId);
    if (status === "PUBLISHED") return { ok: true, flowId, reused: true };
    if (status === null || status === "DEPRECATED" || status === "BLOCKED") flowId = "";
  }

  // 2. Nothing usable stored: create a DRAFT, or adopt the WABA's flow of this name.
  let mustUpload = true;
  if (!flowId) {
    const created = await graphCall(token, `${waba}/flows`, {
      method: "POST",
      json: { name, categories: ["OTHER"], flow_json: flowJson },
    });
    if (created?.res.ok && created.body?.id) {
      flowId = String(created.body.id);
      mustUpload = false; // the create carried the JSON
      const v = validationMessage(created.body);
      if (v) return { ok: false, flowId, error: v };
    } else {
      const msg = metaError(created, "Meta refused to create the flow");
      if (!isNameTaken(msg)) return { ok: false, error: msg };
      const existing = await findFlowByName(token, waba, name);
      if (!existing) {
        return {
          ok: false,
          error: `${msg} — and no flow named "${name}" is visible on this Business Account to reuse.`,
        };
      }
      if (existing.status === "PUBLISHED") return { ok: true, flowId: existing.id, reused: true };
      flowId = existing.id;
    }
  }

  // 3. Bring the draft's JSON up to date with the form as it is now.
  if (mustUpload) {
    const fd = new FormData();
    fd.append("file", new Blob([flowJson], { type: "application/json" }), "flow.json");
    fd.append("name", "flow.json");
    fd.append("asset_type", "FLOW_JSON");
    const up = await graphCall(token, `${flowId}/assets`, { method: "POST", form: fd });
    if (!up?.res.ok) return { ok: false, flowId, error: metaError(up, "Meta refused the flow content") };
    const v = validationMessage(up.body);
    if (v) return { ok: false, flowId, error: v };
  }

  // 4. Publish. A refusal here ("Integrity requirements not met", unverified
  //    business, …) is Meta's and must be fixed in Business Manager; the draft
  //    stays on Meta under this id, and the next attempt goes straight to 3→4.
  const pub = await graphCall(token, `${flowId}/publish`, { method: "POST", json: {} });
  if (!pub?.res.ok || pub.body?.success === false) {
    return {
      ok: false,
      flowId,
      error: `Saved on Meta as draft flow ${flowId}, but publishing failed: ${metaError(pub, "Meta refused to publish")}`,
    };
  }
  return { ok: true, flowId };
}
