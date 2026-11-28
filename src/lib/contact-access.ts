// Who may delete a contact (audit 2026-11-28). Not in contacts/actions.ts on
// purpose: everything exported from a "use server" module is a public POST
// endpoint, and this takes the member as an argument.

import { myModules } from "@/lib/full-access";
import { can } from "@/lib/permissions";

/**
 * Who may delete a contact: the Contacts module (Settings → Access, the page's
 * own gate) AND the Roles page's "Manage settings" (owners / admins by default,
 * editable per company) — the company-data bar Connect already uses for
 * Settings writes. The page hides Delete for everyone else.
 */
export async function mayDeleteContacts(me: { companyId: string; role: string } | null): Promise<boolean> {
  if (!me) return false;
  if (!(await myModules()).includes("contacts")) return false;
  return can(me, "settings");
}
