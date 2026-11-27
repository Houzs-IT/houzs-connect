// Pure smoke for AI Connector rounds 4b + 4c (src/lib/mcp/write-actions.ts,
// actions.ts, round4c.ts, server.ts toolsFor): the propose → confirm path with
// an in-memory store and fake Connect I/O — a proposal writes nothing, a
// confirmation writes once, a switched-off action is refused, a person who
// cannot see the chat gets Connect's own refusal — plus the write fence, role-
// aware tools/list, prompts per role, structured output, links and the cache.
// No DB, no network. The same flows run against Postgres in smoke-mcp-db.mjs.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const A = await import("../src/lib/mcp/actions.ts");
const W = await import("../src/lib/mcp/write-actions.ts");
const C = await import("../src/lib/mcp/round4c.ts");
const srv = await import("../src/lib/mcp/server.ts");
const { MODULES } = await import("../src/lib/module-access.ts");

const NOW = Date.parse("2026-11-27T04:00:00Z"); // Friday 12:00 Malaysia time
const inAnHour = new Date(NOW + 3600_000).toISOString();

// ── an in-memory ActionStore ──
function fakeStore(sw) {
  const rows = new Map();
  let seq = 0;
  return {
    rows,
    sw,
    async switches() {
      return { ...sw };
    },
    async create(a) {
      const id = `mcpx_${String(++seq).padStart(24, "0")}`;
      rows.set(id, { ...a, createdAt: NOW, expiresAt: NOW + A.ACTION_TTL_MS, usedAt: null, cancelledAt: null, outcome: null });
      return id;
    },
    async peek(id, tokenId, memberId) {
      const r = rows.get(id);
      return r && r.tokenId === tokenId && r.memberId === memberId && !r.usedAt && !r.cancelledAt && r.expiresAt > store.now() ? r.kind : null;
    },
    async consume(id, tokenId, memberId) {
      const r = rows.get(id);
      if (!r || r.tokenId !== tokenId || r.memberId !== memberId || r.usedAt || r.cancelledAt || r.expiresAt <= store.now()) return null;
      r.usedAt = store.now();
      return { kind: r.kind, payload: r.payload, summary: r.summary };
    },
    async finish(id, status, note) {
      const r = rows.get(id);
      if (r) {
        r.payload = null;
        r.outcome = { status, note };
      }
    },
    async cancel(id, tokenId, memberId) {
      const r = rows.get(id);
      if (!r || r.tokenId !== tokenId || r.memberId !== memberId || r.usedAt || r.cancelledAt) return false;
      r.cancelledAt = store.now();
      r.payload = null;
      return true;
    },
    async confirmedSince(email, sinceIso) {
      return [...rows.values()].filter((r) => r.email === email && r.usedAt && r.usedAt >= Date.parse(sinceIso)).length + (store.extraConfirmed ?? 0);
    },
  };
}
let store;

// ── fake Connect: what the person can see, and every write recorded ──
function fakeConnect() {
  const writes = [];
  const convos = {
    v1: { id: "v1", status: "OPEN", contactId: "c1", contactBlocked: false, windowExpiresAt: inAnHour, assignedAgentId: null, assignedDepartmentId: "d1" },
    v3: { id: "v3", status: "OPEN", contactId: "c3", contactBlocked: false, windowExpiresAt: new Date(NOW - 60_000).toISOString(), assignedAgentId: null, assignedDepartmentId: "d1" },
    v4: { id: "v4", status: "OPEN", contactId: "c4", contactBlocked: false, windowExpiresAt: inAnHour, assignedAgentId: null, assignedDepartmentId: "d1" }, // another company
  };
  const visible = new Set(["v1", "v3", "v4"]); // v2 is another department's chat
  const contacts = { c1: { id: "c1", name: "Wong Ah Kow", remarks: "VIP" }, c9: { id: "c9", name: "Tan Bee", remarks: "" } };
  let colleague = null;
  const thread = (id) => ({
    id,
    status: "OPEN",
    assignedTo: null,
    department: "Delivery",
    customer: { id: convos[id]?.contactId ?? "c?", name: id === "v1" ? "Wong Ah Kow" : "Lim" },
    messages: [{ at: new Date(NOW - 600_000), from: "customer", text: "When is my sofa delivered?" }],
  });
  return {
    writes,
    contacts,
    convos,
    setColleague: (c) => (colleague = c),
    read: async (path, q) => {
      const m = /^\/conversations\/(\w+)$/.exec(path);
      if (m) {
        if (!visible.has(m[1])) return { status: 404, body: null, message: "Conversation not found, or not one this person can see in Service." };
        return { status: 200, body: thread(m[1]), message: "" };
      }
      if (path === "/conversations") {
        const list = String(q?.q ?? "").toLowerCase().includes("wong") ? [{ id: "v1", customer: "Wong Ah Kow" }] : String(q?.q).includes("many") ? [{ id: "v1" }, { id: "v3" }] : [];
        return { status: 200, body: { conversations: list }, message: "" };
      }
      const c = /^\/contacts\/(\w+)$/.exec(path);
      if (c) return contacts[c[1]] ? { status: 200, body: { id: c[1] }, message: "" } : { status: 404, body: null, message: "Contact not found in this company." };
      if (path === "/contacts") return { status: 200, body: { contacts: String(q?.q).includes("Tan") ? [{ id: "c9", name: "Tan Bee" }] : [] }, message: "" };
      return { status: 404, body: null, message: "Unknown path" };
    },
    exec: {
      async conversation(id) {
        return id === "v4" ? null : convos[id] ? { ...convos[id] } : null;
      },
      async humanReplySince() {
        return colleague;
      },
      async members() {
        return [
          { id: "a", name: "Agent A", email: "a@x" },
          { id: "b", name: "Agent B", email: "b@x" },
          { id: "b2", name: "Bobby Lee", email: "bobby@x" },
        ];
      },
      async departments() {
        return [
          { id: "d1", name: "Delivery" },
          { id: "d2", name: "Service" },
        ];
      },
      async contact(id) {
        return contacts[id] ? { ...contacts[id] } : null;
      },
      async reply(conversationId, text) {
        writes.push(["reply", conversationId, text]);
        return { sent: true, status: "SENT" };
      },
      async assign(conversationId, set, status) {
        writes.push(["assign", conversationId, set, status]);
      },
      async saveRemarks(contactId, remarks) {
        writes.push(["remarks", contactId, remarks]);
        contacts[contactId].remarks = remarks;
        return true;
      },
      async addNote(conversationId, text) {
        writes.push(["note", conversationId, text]);
      },
      async audit(e) {
        writes.push(["audit", e.action, e.entityId]);
      },
    },
  };
}

const ALL_ON = { main: true, chat_reply: true, conversation_assign: true, contact_note: true };
let clock = NOW;
function setup(sw = ALL_ON, modules = [...MODULES]) {
  store = fakeStore({ ...sw });
  store.now = () => clock;
  const cx = fakeConnect();
  const deps = { store, tokenId: "t1", me: { id: "a", email: "a@x", name: "Agent A" }, modules, read: cx.read, exec: cx.exec, now: () => clock };
  return { deps, cx };
}
const realWrites = (cx) => cx.writes.filter((w) => w[0] !== "audit");

// ── 1. A proposal writes nothing; confirm writes ONCE ──
let { deps, cx } = setup();
let p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "Your sofa arrives Friday 2-4pm." });
assert(p.ok && /^mcpx_/.test(p.confirmationId), `chat_reply proposed (${p.text})`);
assert(realWrites(cx).length === 0 && cx.writes.length === 0, "a proposal writes nothing to Connect");
assert(store.rows.size === 1 && [...store.rows.values()][0].payload.text === "Your sofa arrives Friday 2-4pm.", "one pending row holds the exact text");
assert(p.summary.includes("SEND a WhatsApp reply to Wong Ah Kow") && p.summary.includes("Your sofa arrives Friday 2-4pm.") && p.summary.includes("When is my sofa delivered?"), "summary: who, the exact text, the conversation");
assert(!p.target.includes("sofa"), `the call-log target never carries the message (${p.target})`);
let c1 = await W.confirmWrite(deps, p.confirmationId);
assert(c1.ok && c1.status === 200 && c1.text.startsWith("Reply sent"), `confirm sends (${c1.text})`);
assert(realWrites(cx).length === 1 && realWrites(cx)[0][0] === "reply" && realWrites(cx)[0][2] === "Your sofa arrives Friday 2-4pm.", "confirm wrote exactly once, the exact text");
assert(cx.writes.some((w) => w[0] === "audit" && w[1] === "replied"), "the reply is in Connect's activity log");
let c2 = await W.confirmWrite(deps, p.confirmationId);
assert(!c2.ok && c2.status === 404 && realWrites(cx).length === 1, "a confirmation is single use");
assert([...store.rows.values()][0].payload === null, "the payload (message text) is dropped once it ran");

// ── 2. Switched off → refused (propose and confirm), nothing written ──
({ deps, cx } = setup({ ...ALL_ON, main: false }));
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hi" });
assert(!p.ok && p.status === 403 && p.text.startsWith("AI actions are switched off"), `main switch off → refused (${p.text})`);
({ deps, cx } = setup({ ...ALL_ON, chat_reply: false }));
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hi" });
assert(!p.ok && p.status === 403 && p.text.includes("SENDS TO THE CUSTOMER") && p.text.includes("switched off"), `reply switch off → refused (${p.text})`);
assert(store.rows.size === 0, "a refused proposal stores nothing");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", status: "resolved" });
assert(p.ok, "another action's switch is independent");
// Switched off between proposal and confirm: refused WITHOUT using the confirmation up.
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hi there" });
store.sw.chat_reply = false;
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.status === 403 && realWrites(cx).length === 0, "switched off after the proposal → confirm refused, nothing sent");
store.sw.chat_reply = true;
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(c1.ok && realWrites(cx).length === 1, "the peeked confirmation was not used up");
store.sw.main = false;
p = await W.proposeWrite({ ...deps }, "contact_note", { conversationId: "v1", note: "x" });
assert(!p.ok && p.status === 403, "main switch off → every action refused");

// ── 3. A person who cannot see the chat gets Connect's own refusal ──
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v2", text: "hi" });
assert(!p.ok && p.status === 404 && p.text === "Conversation not found, or not one this person can see in Service.", `invisible chat → Connect's own refusal (${p.text})`);
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v2", assign_to: "me" });
assert(!p.ok && p.status === 404, "assign: same refusal");
p = await W.proposeWrite(deps, "contact_note", { conversationId: "v2", note: "hello" });
assert(!p.ok && p.status === 404, "note: same refusal");
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v4", text: "hi" });
assert(!p.ok && p.status === 403 && p.text.includes("another company"), "the inbox's company rule (authorizeConversationFor)");
assert(store.rows.size === 0 && cx.writes.length === 0, "nothing stored, nothing written");
// Access lost between proposal and confirm: re-checked as the person at confirm.
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hello" });
const origRead = deps.read;
deps.read = async (path, q) => (path === "/conversations/v1" ? { status: 404, body: null, message: "Conversation not found, or not one this person can see in Service." } : origRead(path, q));
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.status === 404 && realWrites(cx).length === 0, "visibility re-checked at confirm");
deps.read = origRead;
// Module ticked off on Settings → Access.
({ deps, cx } = setup(ALL_ON, ["contacts", "dashboard"]));
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hi" });
assert(!p.ok && p.status === 403 && p.text.startsWith("Not available to your role"), "no inbox module → refused");

// ── 4. Connect's send rules: 24 h window, blocked, colleague replied ──
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v3", text: "hi" });
assert(!p.ok && p.status === 409 && p.text.includes("24-hour reply window") && p.text.includes("template"), `window closed → refused, template suggested (${p.text})`);
cx.convos.v1.contactBlocked = true;
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hi" });
assert(!p.ok && p.text.includes("blocked"), "blocked contact → refused");
cx.convos.v1.contactBlocked = false;
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "x".repeat(4097) });
assert(!p.ok && p.status === 400, "over 4096 characters refused");
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "Coming Friday" });
cx.setColleague({ by: "Agent B", at: new Date(NOW + 60_000).toISOString() });
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.status === 409 && c1.text.includes("Agent B already replied") && realWrites(cx).length === 0, "a colleague replied first → not sent");
cx.setColleague(null);
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "Coming Friday" });
cx.convos.v1.windowExpiresAt = new Date(NOW - 1).toISOString();
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.text.includes("window closed") && realWrites(cx).length === 0, "window closed after the proposal → not sent");
cx.convos.v1.windowExpiresAt = inAnHour;
p = await W.proposeWrite(deps, "chat_reply", { query: "wong", text: "Found you by name" });
assert(p.ok && store.rows.get(p.confirmationId).payload.conversationId === "v1", "a query matching one chat works");
p = await W.proposeWrite(deps, "chat_reply", { query: "many", text: "?" });
assert(!p.ok && p.text.includes("give the conversationId"), "a query matching several asks for the id");

// ── 5. Expiry, not yours, cancel, daily cap ──
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "Agent B" });
clock = NOW + A.ACTION_TTL_MS + 1;
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.status === 404 && c1.text.includes("expired"), "expired after 10 minutes");
clock = NOW;
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "Agent B" });
c1 = await W.confirmWrite({ ...deps, tokenId: "other-token" }, p.confirmationId);
assert(!c1.ok && c1.status === 404, "another connection cannot confirm it");
c1 = await W.confirmWrite({ ...deps, me: { id: "b", email: "b@x", name: "Agent B" } }, p.confirmationId);
assert(!c1.ok && c1.status === 404, "another person cannot confirm it");
let cn = await W.cancelWrite(deps, p.confirmationId);
assert(cn.ok && cn.text.startsWith("Cancelled"), "cancel");
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && realWrites(cx).length === 0, "a cancelled proposal cannot be confirmed");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "Agent B" });
store.extraConfirmed = A.ACTIONS_PER_DAY;
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.status === 429 && c1.text.includes(`limit of ${A.ACTIONS_PER_DAY}`), "daily cap");
store.extraConfirmed = 0;
c1 = await W.confirmWrite(deps, "mcpx_bad");
assert(!c1.ok && c1.status === 400, "a malformed id is refused");

// ── 6. Assign: names, me / nobody, department, status ──
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "agent b", department: "service", status: "resolved" });
assert(p.ok && p.summary.includes("→ Agent B") && p.summary.includes("→ Service") && p.summary.includes("resolved"), `assign summary (${p.summary})`);
c1 = await W.confirmWrite(deps, p.confirmationId);
const aw = realWrites(cx)[0];
assert(c1.ok && aw[0] === "assign" && aw[2].assignedAgentId === "b" && aw[2].assignedDepartmentId === "d2" && aw[3] === "CLOSED", "assign + department + resolve written once");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "b" });
assert(!p.ok && p.text.includes("matches 2"), "an ambiguous name lists the matches");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "Ghost" });
assert(!p.ok && p.text.includes("No one called"), "an unknown person is refused");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "nobody" });
assert(p.ok && store.rows.get(p.confirmationId).payload.agentId === null, "nobody = unassign");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", assign_to: "me" });
assert(p.ok && store.rows.get(p.confirmationId).payload.agentId === "a", "me = the person");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1" });
assert(!p.ok && p.status === 400, "nothing to change → refused");
p = await W.proposeWrite(deps, "conversation_assign", { conversationId: "v1", status: "deleted" });
assert(!p.ok, "only open / pending / resolved");

// ── 7. Contact notes: Remarks appended to what is stored at confirm; internal note ──
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "contact_note", { conversationId: "v1", note: "Prefers afternoon delivery" });
assert(p.ok && p.summary.includes("Wong Ah Kow's Remarks") && p.summary.includes("Prefers afternoon delivery"), "remarks proposal from a chat");
cx.contacts.c1.remarks = "VIP\nAdded by a colleague meanwhile";
c1 = await W.confirmWrite(deps, p.confirmationId);
const rw = realWrites(cx)[0];
assert(c1.ok && rw[0] === "remarks" && rw[2].startsWith("VIP\nAdded by a colleague meanwhile\n[2026-11-27 Agent A, via AI Connector] Prefers afternoon delivery"), `appended to the CURRENT remarks (${JSON.stringify(rw[2])})`);
p = await W.proposeWrite(deps, "contact_note", { contact: "Tan", note: "Called back" });
assert(p.ok && store.rows.get(p.confirmationId).payload.contactId === "c9", "remarks from the Contacts page (contacts module)");
({ deps, cx } = setup(ALL_ON, ["inbox"]));
p = await W.proposeWrite(deps, "contact_note", { contact: "Tan", note: "Called back" });
assert(!p.ok && p.status === 403 && p.text.includes("Contacts is not turned on"), "without the contacts module only a chat's contact can get a note");
p = await W.proposeWrite(deps, "contact_note", { conversationId: "v1", as: "internal_note", note: "Escalate to Lim" });
assert(p.ok && p.summary.includes("never sent to the customer"), "internal note proposal");
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(c1.ok && realWrites(cx)[0][0] === "note" && realWrites(cx)[0][2] === "Escalate to Lim", "internal note written once");
cx.contacts.c1.remarks = "x".repeat(1990);
p = await W.proposeWrite(deps, "contact_note", { conversationId: "v1", note: "One more line" });
assert(!p.ok && p.text.includes("full"), "Remarks over 2,000 characters refused");

// ── 8. The write fence ──
assert(W.payloadAllowed("chat_reply", { conversationId: "v1", text: "hi", proposedAt: "x" }), "fence: a reply");
assert(!W.payloadAllowed("chat_reply", { conversationId: "v1", text: "hi", proposedAt: "x", template: "promo" }), "fence: no extra key (no template / broadcast)");
assert(!W.payloadAllowed("chat_reply", { conversationId: "../x", text: "hi", proposedAt: "x" }), "fence: ids are safe");
assert(W.payloadAllowed("conversation_assign", { conversationId: "v1", agentId: null }), "fence: unassign");
assert(!W.payloadAllowed("conversation_assign", { conversationId: "v1", status: "DELETED" }), "fence: no other status");
assert(!W.payloadAllowed("conversation_assign", { conversationId: "v1" }), "fence: something must change");
assert(!W.payloadAllowed("contact_note", { target: "remarks", contactId: "c1", text: "x", attributes: {} }), "fence: no other contact field");
assert(!W.payloadAllowed("contact_note", { target: "delete", contactId: "c1", text: "x" }), "fence: only remarks / internal note");
assert(!W.payloadAllowed("campaign", { name: "x" }), "fence: unknown kind");
// A tampered pending row is refused at confirm.
({ deps, cx } = setup());
p = await W.proposeWrite(deps, "chat_reply", { conversationId: "v1", text: "hi" });
store.rows.get(p.confirmationId).payload.template = "promo_blast";
c1 = await W.confirmWrite(deps, p.confirmationId);
assert(!c1.ok && c1.text.includes("write fence") && realWrites(cx).length === 0, "a payload outside the fence is never written");

// ── 9. Pure helpers ──
assert(W.windowOpen(inAnHour, NOW) && !W.windowOpen(null, NOW) && !W.windowOpen(new Date(NOW - 1).toISOString(), NOW), "windowOpen");
assert(W.appendRemarks("", "a") === "a" && W.appendRemarks("x", "a") === "x\na" && W.appendRemarks("x".repeat(2000), "a") === null, "appendRemarks");
assert(!W.writeTarget("chat_reply", { conversationId: "v1", text: "secret words" }).includes("secret"), "writeTarget never logs text");
assert(A.myDayStartIso(NOW) === "2026-11-26T16:00:00.000Z", `Malaysia midnight (${A.myDayStartIso(NOW)})`);
assert(A.kindRefusal({ main: true, chat_reply: true }, "chat_reply") === null && A.kindRefusal({ main: false, chat_reply: true }, "chat_reply") === A.ACTIONS_OFF_MESSAGE, "kindRefusal");

// ── 10. Round 4c P1: role-aware tools/list ──
const allMods = [...MODULES];
const names = (mods, role, sw) => srv.toolsFor(mods, role, sw).map((t) => t.name);
const WRITE = ["propose_chat_reply", "propose_conversation_assign", "propose_contact_note", "confirm_action", "cancel_action"];
assert(WRITE.every((t) => !names(allMods, "SUPER_ADMIN", null).includes(t)), "actions off → no write tool listed");
assert(WRITE.every((t) => !names(allMods, "SUPER_ADMIN", { ...ALL_ON, main: false }).includes(t)), "main switch off → none listed");
let ls = names(allMods, "AGENT", { ...ALL_ON, chat_reply: false });
assert(!ls.includes("propose_chat_reply") && ls.includes("propose_conversation_assign") && ls.includes("confirm_action"), "a switched-off action is hidden, the others stay");
ls = names(["contacts"], "AGENT", ALL_ON);
assert(!ls.includes("propose_chat_reply") && !ls.includes("propose_conversation_assign") && ls.includes("propose_contact_note"), "write tools follow modules");
ls = names([], "AGENT", ALL_ON);
assert(!ls.some((t) => WRITE.includes(t)) && !ls.includes("search") && !ls.includes("daily_brief") && !ls.includes("export_excel"), "no modules → no write / composite tools");
const listed = srv.toolsFor(allMods, "ADMIN", ALL_ON);
assert(listed.every((t) => !["module", "anyModule", "supervisorOnly", "writeKind", "actionTool"].some((k) => k in t)), "no internal keys sent");
assert(listed.find((t) => t.name === "propose_chat_reply").annotations.readOnlyHint === false && listed.find((t) => t.name === "inbox_overview").annotations.readOnlyHint === true, "annotations: writes are not read-only");
assert(listed.find((t) => t.name === "propose_chat_reply").title.includes("SENDS TO THE CUSTOMER"), "the reply tool says it reaches the customer");
// A hidden tool called directly still says "no access" (toolAllowed is the gate callTool uses).
const ds = srv.TOOLS.find((t) => t.name === "daily_brief");
assert(!srv.toolAllowed(ds, [], "AGENT", null) && srv.toolAllowed(ds, ["payments"], "AGENT", null), "toolAllowed: composite tools");
assert(!srv.toolAllowed(srv.TOOLS.find((t) => t.name === "chat_review"), allMods, "AGENT", null), "toolAllowed: chat content stays supervisor-only");

// ── P3: structured output on the quick answers ──
assert(listed.filter((t) => t.outputSchema).map((t) => t.name).sort().join() === [...C.STRUCTURED_TOOLS].filter((t) => listed.some((x) => x.name === t)).sort().join(), "quick answers carry outputSchema");
assert(!listed.find((t) => t.name === "connect_get").outputSchema, "general tools do not");
assert(C.parseAnswer('Credential fields removed: x.\n{"a":1}').a === 1 && C.parseAnswer("[1]") === null && C.parseAnswer("cut {") === null, "parseAnswer");

// ── P5: links on every row ──
const O = "https://chat.example";
const lk = C.withLinks("inbox_overview", { longestWaiting: [{ id: "v1", customer: "W" }], nested: { rows: [{ conversationId: "v2" }, { contactId: "c1" }, { url: "keep" }] } }, O);
assert(lk.link === `${O}/inbox` && lk.longestWaiting[0].url === `${O}/inbox/open/v1`, `top-level page link + bare-id rows (${JSON.stringify(lk)})`);
assert(lk.nested.rows[0].url === `${O}/inbox/open/v2` && lk.nested.rows[1].url === `${O}/contacts?id=c1` && lk.nested.rows[2].url === "keep", "conversation / contact rows linked; an existing url kept");
assert(C.withLinks("campaign_summary", { latest: [{ id: "k1", name: "Promo" }] }, O).latest[0].url === `${O}/campaigns/k1`, "campaign rows linked");
assert(C.withLinks("agent_workload", { byAgent: [{ id: "m1" }] }, O).byAgent[0].url === undefined, "a member id is not mistaken for a record");

// ── P2: prompts per role ──
assert(C.ROLE_PROMPTS.map((p) => p.name).join() === "supervisor_morning,my_queue,weekly_quality_review", "role prompts");
assert(C.PROMPT_TOOL.supervisor_morning === "chat_review" && C.PROMPT_TOOL.my_queue === "waiting_now", "a prompt follows its tool's visibility");
assert(C.rolePromptText("supervisor_morning", NOW).includes("from=2026-11-26, to=2026-11-26") && C.rolePromptText("supervisor_morning", NOW).includes("waiting_now"), "supervisor morning = waiting_now + yesterday's chat_review");
assert(C.rolePromptText("weekly_quality_review", NOW).includes("period=week") && C.rolePromptText("my_queue", NOW).includes("never send"), "weekly review + my queue");
assert(C.rolePromptText("nope") === null, "unknown prompt");

// ── P4: the per-person cache ──
const cache = new C.AnswerCache(60_000, 3);
const k1 = C.AnswerCache.key({ memberId: "a", role: "AGENT", modules: ["inbox"], tool: "inbox_overview", args: { b: 1, a: 2 } });
assert(k1 === C.AnswerCache.key({ memberId: "a", role: "AGENT", modules: ["inbox"], tool: "inbox_overview", args: { a: 2, b: 1 } }), "argument order does not matter");
assert(k1 !== C.AnswerCache.key({ memberId: "b", role: "AGENT", modules: ["inbox"], tool: "inbox_overview", args: { a: 2, b: 1 } }), "per person");
assert(k1 !== C.AnswerCache.key({ memberId: "a", role: "MANAGER", modules: ["inbox"], tool: "inbox_overview", args: { a: 2, b: 1 } }), "a role change misses the cache");
assert(k1 !== C.AnswerCache.key({ memberId: "a", role: "AGENT", modules: ["inbox", "dashboard"], tool: "inbox_overview", args: { a: 2, b: 1 } }), "a module change misses the cache");
cache.set(k1, "a", "v", 1000);
assert(cache.get(k1, 1000 + 59_000) === "v" && cache.get(k1, 1000 + 60_001) === undefined, "60 s TTL");
cache.set("x1", "a", 1, 0);
cache.set("x2", "b", 2, 0);
cache.clearMember("a");
assert(cache.get("x1", 0) === undefined && cache.get("x2", 0) === 2, "clearMember drops only that person");
for (let i = 0; i < 10; i++) cache.set(`y${i}`, "c", i, 0);
assert(cache.size <= 3, "bounded size");
assert(!C.CACHED_TOOLS.has("waiting_now") && !C.CACHED_TOOLS.has("daily_brief") && C.CACHED_TOOLS.has("chat_review"), "only heavy summaries are cached (waiting_now / daily_brief stay live)");

console.log(`smoke-mcp-actions: ok (${n} assertions)`);
