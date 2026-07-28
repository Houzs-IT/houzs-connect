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
