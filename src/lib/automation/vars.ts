import { attrs } from "@/lib/format";

export interface VarContext {
  full_name?: string | null;
  phone?: string;
  attributes?: unknown;
}

/**
 * Interpolate {key} and {{key}} placeholders in a message using the contact's
 * attributes plus a few built-ins (full_name, phone).
 */
export function interpolate(template: string, ctx: VarContext): string {
  const a = attrs(ctx.attributes);
  const lookup: Record<string, string> = {
    ...a,
    full_name: ctx.full_name ?? "",
    phone: ctx.phone ?? "",
  };
  return template.replace(/\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g, (_m, key) => {
    const v = lookup[key];
    return v == null || v === "" ? `{${key}}` : String(v);
  });
}

/** Meta rejects an empty body parameter, so an unresolved variable sends this. */
const EMPTY_PARAM = "-";

/**
 * The SAME placeholders `interpolate` would substitute, returned IN ORDER as
 * template body parameters. An approved WhatsApp template numbers its
 * placeholders {{1}}, {{2}}, … positionally, so the copy an operator writes as
 * "Hi {{full_name}}, order {{ref_1}}" maps to params ["Wong", "znt7001"].
 *
 * Meta also rejects a parameter containing a newline or a tab, and rejects an
 * empty one outright — both come back as a 132000-class error with the whole
 * send lost, so they are normalised here rather than at the call site.
 */
export function extractParams(template: string, ctx: VarContext): string[] {
  const a = attrs(ctx.attributes);
  const lookup: Record<string, string> = {
    ...a,
    full_name: ctx.full_name ?? "",
    phone: ctx.phone ?? "",
  };
  const out: string[] = [];
  const re = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const raw = lookup[m[1]];
    const clean = raw == null ? "" : String(raw).replace(/\s+/g, " ").trim();
    out.push(clean === "" ? EMPTY_PARAM : clean);
  }
  return out;
}
