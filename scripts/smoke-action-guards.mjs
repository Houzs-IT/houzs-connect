// Pure smoke (source pins, no DB) for the server-action guards fixed in the
// 2026-11-28 audit. A "use server" export is a public POST endpoint: hiding a
// button is not a guard, so each of these pins the check on the server side.
//   - templates/actions.ts: submit / delete / edit reached Meta with only a
//     sign-in (X4) — now the Settings module, the same as the Templates pages.
//   - contacts/actions.ts deleteContact: any member could wipe a contact and its
//     chats and payments — now lib/contact-access.ts mayDeleteContacts.
//   - campaigns/actions.ts listBroadcastContacts read every company's
//     contact-tag links (X5) — now joined to this company's tags.

import fs from "node:fs";

let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const bodyOf = (src, fn) => {
  const from = src.indexOf(`export async function ${fn}(`);
  assert(from >= 0, `${fn} exists`);
  const next = src.indexOf("\nexport ", from + 10);
  return src.slice(from, next < 0 ? undefined : next);
};
const exportedFns = (src) => [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);

// ── Templates ──
const tpl = read("src/app/(app)/templates/actions.ts");
const gate = tpl.slice(tpl.indexOf("async function requireMember()"), tpl.indexOf("const NO_ACCESS"));
assert(/myModules\(\)\)\.includes\("settings"\)/.test(gate), "templates requireMember needs the Settings module (same as settings/templates/layout.tsx)");
assert(read("src/app/(app)/settings/templates/layout.tsx").includes('requireModule("settings")'), "the Templates pages are gated on the Settings module");
for (const fn of exportedFns(tpl)) {
  if (fn === "syncTemplates") continue; // revalidatePath only — reads and writes nothing
  assert(bodyOf(tpl, fn).includes("requireMember()"), `templates/actions.ts ${fn} goes through requireMember()`);
}

// ── Contacts: delete ──
const contacts = read("src/app/(app)/contacts/actions.ts");
assert(bodyOf(contacts, "deleteContact").includes("mayDeleteContacts("), "deleteContact checks mayDeleteContacts before deleting");
const access = read("src/lib/contact-access.ts");
assert(access.includes('includes("contacts")') && access.includes('can(me, "settings")'), "mayDeleteContacts = Contacts module + the Roles page's Manage settings");
assert(!/^\s*["']use server["']/m.test(access), "mayDeleteContacts is not itself a public server action");
assert(read("src/app/(app)/contacts/page.tsx").includes("mayDeleteContacts(me)"), "the Contacts page hides Delete for everyone else");

// ── Broadcast picker: this company's tag links only ──
const camp = read("src/app/(app)/campaigns/actions.ts");
const picker = bodyOf(camp, "listBroadcastContacts");
assert(!/contactTag\.findMany\(\{\s*columns/.test(picker), "the picker no longer reads every contact-tag link in the database");
assert(/\.innerJoin\(tagTable, eq\(tagTable\.id, contactTagTable\.tagId\)\)\s*\.where\(eq\(tagTable\.companyId, c\.companyId\)\)/.test(picker), "contact-tag links are joined to this company's tags");

// ── Module guards on the pages the 2026-11-28 audit found open by URL ──
for (const [file, mod] of [
  ["src/app/(app)/inbox/layout.tsx", "inbox"],
  ["src/app/(app)/contacts/layout.tsx", "contacts"],
  ["src/app/(app)/internal/layout.tsx", "internal"],
  ["src/app/(app)/settings/(center)/auto-assign/layout.tsx", "settings"],
]) assert(read(file).includes(`requireModule("${mod}")`), `${file} requires the ${mod} module`);

console.log(`smoke-action-guards: ok (${n} assertions)`);
