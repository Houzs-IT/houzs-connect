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
  | { ok: true; flowId: string }
  | { ok: false; error: string };

/**
 * Create AND publish a Meta Flow for a form in one call, returning the published
 * flow id. Meta's `POST /{WABA-ID}/flows` accepts `flow_json` + `publish` to
 * create, validate and publish together; a validation failure comes back in the
 * body (2xx), not as a non-2xx. Caller must check isFlowsConfigured() first.
 */
export async function publishFlow(form: { name: string; fields: unknown }): Promise<PublishFlowResult> {
  const waba = process.env.WHATSAPP_WABA_ID;
  const token = metaToken();
  if (!waba || !token) {
    return { ok: false, error: "WhatsApp Flows is not configured (WHATSAPP_WABA_ID / token)." };
  }
  const flowJson = buildFlowJson(form.name, form.fields);
  const res = await fetch(`${GRAPH}/${waba}/flows`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.name.slice(0, 200),
      categories: ["OTHER"],
      flow_json: JSON.stringify(flowJson),
      publish: true,
    }),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Could not reach Meta (network error)." };
  const body = (await res.json().catch(() => null)) as {
    id?: string;
    validation_errors?: { message?: string }[];
    error?: { error_user_msg?: string; message?: string };
  } | null;
  if (!res.ok) {
    const e = body?.error;
    return { ok: false, error: e?.error_user_msg ?? e?.message ?? `Meta returned HTTP ${res.status}.` };
  }
  if (body?.validation_errors?.length) {
    const msg = body.validation_errors.map((v) => v.message).filter(Boolean).join("; ");
    return { ok: false, error: `Flow validation failed: ${msg || "see Meta Flow Builder"}` };
  }
  if (!body?.id) return { ok: false, error: "Meta accepted the request but returned no flow id." };
  return { ok: true, flowId: body.id };
}
