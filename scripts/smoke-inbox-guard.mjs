// Pure smoke for lib/inbox-guard.ts — who may write to a Service conversation
// (audit 2026-11-28). Before the fix the inbox server actions checked only the
// company: an agent could reply to / assign / close any chat id in the company,
// and the Roles page's "Reply to customers" / "Assign chats" were enforced
// nowhere. No DB, no network.

import fs from "node:fs";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const G = await import("../src/lib/inbox-guard.ts");
const { getVisibility } = await import("../src/lib/access.ts");

// ── visibility: the rail's org-chart rule, in memory ──
const members = [
  { id: "boss", managerId: null },
  { id: "lead", managerId: "boss" },
  { id: "agentA", managerId: "lead" },
  { id: "agentB", managerId: "lead" },
  { id: "driver", managerId: null },
];
const agentA = getVisibility({ id: "agentA", role: "AGENT", departmentId: "sales" }, members);
const lead = getVisibility({ id: "lead", role: "MANAGER", departmentId: null }, members);
const admin = getVisibility({ id: "boss", role: "ADMIN", departmentId: null }, members);
const driver = getVisibility({ id: "driver", role: "DRIVER", departmentId: "sales" }, members);
const seeAll = getVisibility({ id: "agentB", role: "AGENT", departmentId: null }, members, true);

const mine = { assignedAgentId: "agentA", assignedDepartmentId: null };
const colleagues = { assignedAgentId: "agentB", assignedDepartmentId: null };
const salesQueue = { assignedAgentId: null, assignedDepartmentId: "sales" };
const nobody = { assignedAgentId: null, assignedDepartmentId: null };

assert(G.conversationVisible(agentA, mine), "an agent sees their own chat");
assert(!G.conversationVisible(agentA, colleagues), "an agent does NOT see a colleague's chat");
assert(G.conversationVisible(agentA, salesQueue), "an agent sees their department's chat");
assert(!G.conversationVisible(agentA, nobody), "an agent does not see a chat with no agent and no department (same as the rail)");
assert(G.conversationVisible(agentA, colleagues, true), "a colleague added as a chat member may act on it");
assert(G.conversationVisible(lead, mine) && G.conversationVisible(lead, colleagues), "a manager sees their reports' chats");
assert(!G.conversationVisible(lead, salesQueue), "a manager outside the department does not see its unassigned chats");
assert(G.conversationVisible(admin, nobody) && G.conversationVisible(seeAll, colleagues), "admins and 'See every chat' see everything");
assert(!G.conversationVisible(driver, salesQueue), "a driver sees only chats assigned to them, not the department's");

// ── the Roles switches ──
const all = { reply: true, assign: true };
assert(G.inboxWriteRefusal("reply", true, all) === null, "visible + Reply to customers → may reply");
assert(G.inboxWriteRefusal("reply", false, all) === G.NOT_VISIBLE, "invisible → refused, even with every switch");
assert(G.inboxWriteRefusal("assign", false, all) === G.NOT_VISIBLE && G.inboxWriteRefusal("other", false, all) === G.NOT_VISIBLE, "invisible → no assign, no status/notes either");
assert(G.inboxWriteRefusal("reply", true, { reply: false, assign: true }) === G.NO_REPLY, "Reply to customers off → reply refused");
assert(G.inboxWriteRefusal("assign", true, { reply: true, assign: false }) === G.NO_ASSIGN, "Assign chats off → assign refused");
assert(G.inboxWriteRefusal("other", true, { reply: false, assign: false }) === null, "status / note / tag need visibility only");
assert(G.NO_REPLY.includes("Reply to customers") && G.NO_ASSIGN.includes("Assign chats"), "refusals name the Roles page's own labels");

// ── the actions actually ask for the right write (source pins) ──
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const app = read("src/app/actions.ts");
const inbox = read("src/app/(app)/inbox/actions.ts");
const media = read("src/app/(app)/inbox/media-actions.ts");
const body = (src, fn) => {
  const i = src.indexOf(`export async function ${fn}(`);
  assert(i >= 0, `${fn} exists`);
  const j = src.indexOf("\nexport ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
};
for (const [src, file] of [[app, "app/actions.ts"], [inbox, "inbox/actions.ts"], [media, "inbox/media-actions.ts"]]) {
  assert(src.includes("authorizeInboxWrite("), `${file}: authorizes through authorizeInboxWrite (company + visibility + switches)`);
}
assert(/kind === "note" \? "other" : "reply"/.test(body(app, "sendMessage")), "sendMessage: a reply needs Reply to customers, a note does not");
assert(body(app, "sendTemplateMessage").includes('authorizeConversation(conversationId, "reply")'), "sendTemplateMessage needs Reply to customers");
assert(body(app, "assignConversation").includes('authorizeConversation(conversationId, "assign")'), "assignConversation needs Assign chats");
assert(body(inbox, "unassignConversation").includes('authorizeConversation(conversationId, "assign")'), "unassignConversation needs Assign chats");
assert(/authorizeInboxWrite\(db, me, conversationId, "reply"\)/.test(media), "attachments / voice notes / contact cards need Reply to customers");

console.log(`smoke-inbox-guard: ok (${n} assertions)`);
