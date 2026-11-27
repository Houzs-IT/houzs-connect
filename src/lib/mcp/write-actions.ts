// AI Connector round 4b — write actions (owner approved 2026-11-26). Same
// pattern as Hookka's mcp-write-actions.ts (hookka-erp-testing PR #1633):
// propose → the person sees a summary → confirm_action → ONE call to Connect's
// OWN existing write code, as the person.
//
//   propose_chat_reply           lib/inbox-writes.ts sendReplyCore — the
//                                composer's send (sendOutbound: blocked
//                                contacts refused; LIVE → Meta). Only inside
//                                the 24-hour window (the composer refuses free
//                                text outside it; a template is sent from the
//                                inbox). SENDS TO THE CUSTOMER — its own switch.
//   propose_conversation_assign  assignConversationCore / setConversationStatusCore
//                                — the inbox's Assign and Resolve buttons.
//   propose_contact_note         saveContactRemarksCore (the contact's Remarks,
//                                one dated line appended) or
//                                addConversationNoteCore (the composer's
//                                internal Note — never reaches the customer).
//
// Never: campaigns / broadcasts, deletes, contact imports.
//
// RBAC is Connect's own, applied in the same order the app applies it:
//   1. the module (Settings → Access): inbox for chats, contacts for a contact
//      found on the Contacts page;
//   2. the conversation must pass the inbox rail's visibility predicate for
//      this person — the connector reads it through readEndpoint
//      (/conversations/:id), so an agent who cannot see a chat gets Connect's
//      own "not one this person can see" and nothing is proposed;
//   3. the inbox's company rule (inbox-writes.ts authorizeConversationFor),
//      the same check every server action runs.
// Then the admin switches (main + per action), then — at confirm — the daily
// cap and the single-use claim, the payload fence and the re-checks.
//
// Pure, or I/O through `WriteDeps`, so the whole propose → confirm path is
// tested with fakes (scripts/smoke-mcp-actions.mjs) and end to end against
// Postgres (scripts/smoke-mcp-db.mjs).

import type { Module } from "@/lib/module-access";
import { ACTIONS_PER_DAY, CONFIRMATION_ID, kindRefusal, myDayStartIso, type ActionStore, type WriteKind } from "./actions";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as unknown[]).map(obj) : []);
const s = (v: unknown): string => (v === undefined || v === null ? "" : v instanceof Date ? v.toISOString() : String(v));
const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

export const MAX_REPLY = 4096; // WhatsApp's text limit
export const MAX_NOTE = 1000;
export const REMARKS_MAX = 2000; // lib/inbox-writes.ts REMARKS_MAX
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const ASSIGN_STATUSES = ["OPEN", "PENDING", "CLOSED"] as const;
type AssignStatus = (typeof ASSIGN_STATUSES)[number];

/** What a tool's module gate needs. */
export const KIND_MODULES: Record<WriteKind, Module[]> = {
  chat_reply: ["inbox"],
  conversation_assign: ["inbox"],
  contact_note: ["inbox", "contacts"], // any one: from a chat (inbox) or from the Contacts page (contacts)
};

// ── the I/O a proposal / confirmation needs ─────────────────────────────────

export type ReadReply = { status: number; body: unknown; message: string };

/** The conversation as the write code sees it (after the inbox's company rule). */
export type ConvoState = {
  id: string;
  status: string;
  contactId: string;
  contactBlocked: boolean;
  windowExpiresAt: string | null;
  assignedAgentId: string | null;
  assignedDepartmentId: string | null;
};

export type ExecPort = {
  /** inbox-writes.ts authorizeConversationFor as the person; null = not in their company. */
  conversation(id: string): Promise<ConvoState | null>;
  /** The newest message a PERSON (not the bot) sent on this chat after `sinceIso`, if any. */
  humanReplySince(conversationId: string, sinceIso: string): Promise<{ by: string; at: string } | null>;
  /** Active members / departments of the person's company (who a chat can be assigned to — the Assign menu's list). */
  members(): Promise<{ id: string; name: string; email: string }[]>;
  departments(): Promise<{ id: string; name: string }[]>;
  /** A contact of the person's company with its current Remarks, or null. */
  contact(id: string): Promise<{ id: string; name: string; remarks: string } | null>;
  reply(conversationId: string, text: string): Promise<{ sent: boolean; status: string; reason?: string }>;
  assign(conversationId: string, set: { assignedAgentId?: string | null; assignedDepartmentId?: string | null }, status?: AssignStatus): Promise<void>;
  saveRemarks(contactId: string, remarks: string): Promise<boolean>;
  addNote(conversationId: string, text: string): Promise<void>;
  /** Connect's activity log, for the writes whose core does not record one itself. */
  audit(entry: { entityType: "conversation" | "contact"; entityId: string; action: "replied" | "note_added" | "remarks_updated" }): Promise<void>;
};

export type WriteDeps = {
  store: ActionStore;
  tokenId: string;
  me: { id: string; email: string; name: string };
  modules: Module[];
  /** A catalogue read as the person (server.ts readEndpoint). */
  read: (path: string, query?: Obj) => Promise<ReadReply>;
  exec: ExecPort;
  now?: () => number;
};

export type Outcome = { ok: boolean; text: string; status: number; target: string };
export type ProposeOutcome = Outcome & { confirmationId?: string; summary?: string; warnings?: string[] };

// ── pure: helpers ───────────────────────────────────────────────────────────

const myDate = (now: number) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
const myTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " (Malaysia time)";
};

/** Is the 24-hour customer-service window open at `now`? (the composer's own test) */
export function windowOpen(windowExpiresAt: string | null, now: number): boolean {
  if (!windowExpiresAt) return false;
  const t = new Date(windowExpiresAt).getTime();
  return Number.isFinite(t) && t > now;
}

/** Pick one row by exact email, exact name, or the only name containing the text (case-insensitive). */
export function pickByName<T extends { name: string; email?: string }>(list: T[], raw: string): { ok: true; item: T } | { ok: false; error: string } {
  const q = raw.trim().toLowerCase();
  if (!q) return { ok: false, error: "Give a name." };
  const exact = list.filter((m) => (m.email ?? "").toLowerCase() === q || m.name.trim().toLowerCase() === q);
  if (exact.length === 1) return { ok: true, item: exact[0] };
  const part = exact.length > 1 ? exact : list.filter((m) => m.name.toLowerCase().includes(q));
  if (part.length === 1) return { ok: true, item: part[0] };
  if (part.length === 0) return { ok: false, error: `No one called "${raw.trim()}".` };
  return { ok: false, error: `"${raw.trim()}" matches ${part.length}: ${part.slice(0, 8).map((m) => m.name).join(", ")} — give the full name.` };
}

/** The conversation detail read (/conversations/:id) → what a summary shows. */
export function readThread(body: unknown) {
  const b = obj(body);
  const customer = obj(b.customer);
  const msgs = arr(b.messages);
  const lastIn = [...msgs].reverse().find((m) => s(m.from) === "customer");
  return {
    id: s(b.id),
    status: s(b.status),
    assignedTo: s(b.assignedTo) || null,
    department: s(b.department) || null,
    customerId: s(customer.id),
    customer: s(customer.name) || "the customer",
    lastCustomerMessage: lastIn ? cut(oneLine(s(lastIn.text)), 300) : "",
    lastCustomerAt: lastIn ? s(lastIn.at) : "",
    newestAt: msgs.length ? s(msgs[msgs.length - 1].at) : "",
  };
}
export type ThreadView = ReturnType<typeof readThread>;

/** One dated Remarks line: "[2026-11-27 Lim Wei, via AI Connector] …". */
export function remarksLine(text: string, who: string, today: string): string {
  return `[${today} ${who || "staff"}, via AI Connector] ${text}`;
}

/** The Remarks with one line appended; null when it would pass the 2,000-character limit. */
export function appendRemarks(existing: string, line: string): string | null {
  const next = existing.trim() ? `${existing.trim()}\n${line}` : line;
  return next.length > REMARKS_MAX ? null : next;
}

/** The call-log line: kind + which record. Never a message body or note text. */
export function writeTarget(kind: WriteKind, p: Obj): string {
  if (kind === "contact_note") return s(p.target) === "internal_note" ? `contact_note: internal note on conversation ${s(p.conversationId)}` : `contact_note: remarks of contact ${s(p.contactId)}`;
  if (kind === "conversation_assign") {
    const parts = [
      "agentId" in p ? `agent ${s(p.agentId) || "none"}` : "",
      "departmentId" in p ? `department ${s(p.departmentId) || "none"}` : "",
      p.status ? `status ${s(p.status)}` : "",
    ].filter(Boolean);
    return `conversation_assign: ${s(p.conversationId)} → ${parts.join(", ")}`;
  }
  return `chat_reply: conversation ${s(p.conversationId)} (${s(p.text).length} chars)`;
}

// ── the write fence: what a confirmed payload may carry ─────────────────────

const PAYLOAD_KEYS: Record<WriteKind, readonly string[]> = {
  chat_reply: ["conversationId", "text", "proposedAt"],
  conversation_assign: ["conversationId", "agentId", "departmentId", "status"],
  contact_note: ["target", "contactId", "conversationId", "text"],
};

/** True when `p` carries only the keys and shapes `kind` may send — anything else is never written. */
export function payloadAllowed(kind: WriteKind, p: unknown): boolean {
  const keys = PAYLOAD_KEYS[kind];
  if (!keys || !p || typeof p !== "object" || Array.isArray(p)) return false;
  const o = p as Obj;
  if (!Object.keys(o).every((k) => keys.includes(k))) return false;
  const id = (v: unknown) => typeof v === "string" && SAFE_ID.test(v);
  const idOrNull = (v: unknown) => v === null || id(v);
  if (kind === "chat_reply") return id(o.conversationId) && typeof o.text === "string" && o.text.trim().length > 0 && o.text.length <= MAX_REPLY && typeof o.proposedAt === "string";
  if (kind === "conversation_assign") {
    if (!id(o.conversationId)) return false;
    if ("agentId" in o && !idOrNull(o.agentId)) return false;
    if ("departmentId" in o && !idOrNull(o.departmentId)) return false;
    if ("status" in o && !(ASSIGN_STATUSES as readonly string[]).includes(s(o.status))) return false;
    return "agentId" in o || "departmentId" in o || "status" in o;
  }
  if (typeof o.text !== "string" || !o.text.trim() || o.text.length > MAX_NOTE) return false;
  if (o.target === "remarks") return id(o.contactId) && (!("conversationId" in o) || id(o.conversationId));
  if (o.target === "internal_note") return id(o.conversationId) && !("contactId" in o);
  return false;
}

// ── pure: proposals ─────────────────────────────────────────────────────────

export type Proposal = { ok: true; payload: Obj; summary: string; warnings: string[] } | { ok: false; error: string; status: number };

export function buildReplyProposal(args: Obj, t: ThreadView, c: ConvoState, now: number): Proposal {
  const text = s(args.text ?? args.message).trim();
  if (!text) return { ok: false, error: "Write the reply (text).", status: 400 };
  if (text.length > MAX_REPLY) return { ok: false, error: `The reply is too long (WhatsApp allows ${MAX_REPLY} characters).`, status: 400 };
  if (c.contactBlocked) return { ok: false, error: `${t.customer} is blocked in Houzs Connect — unblock them on the Contacts page first. Nothing was sent.`, status: 409 };
  if (!windowOpen(c.windowExpiresAt, now)) {
    return {
      ok: false,
      status: 409,
      error: `The 24-hour reply window with ${t.customer} is closed, so WhatsApp refuses a typed reply. Send an approved template from the conversation in Houzs Connect instead. Nothing was sent.`,
    };
  }
  const warnings: string[] = [];
  if (c.status === "CLOSED") warnings.push("This conversation is resolved (closed); the reply goes out anyway.");
  const closesAt = c.windowExpiresAt ? myTime(c.windowExpiresAt) : "";
  const summary =
    `SEND a WhatsApp reply to ${t.customer} — this goes to the customer, from Houzs Connect, as you.\n` +
    `Conversation: ${t.status || c.status}, assigned to ${t.assignedTo ?? "nobody"}${t.department ? ` (${t.department})` : ""}.\n` +
    (t.lastCustomerMessage ? `Their last message: "${t.lastCustomerMessage}"\n` : "") +
    `Reply (exactly as it will be sent):\n${text}\n` +
    (closesAt ? `The 24-hour reply window closes ${closesAt}. ` : "") +
    "If a colleague replies to this chat before you confirm, it will NOT be sent.";
  return { ok: true, payload: { conversationId: c.id, text, proposedAt: new Date(now).toISOString() }, summary, warnings };
}

export function buildAssignProposal(
  args: Obj,
  t: ThreadView,
  c: ConvoState,
  people: { members: { id: string; name: string; email: string }[]; departments: { id: string; name: string }[] },
  me: { id: string; name: string }
): Proposal {
  const payload: Obj = { conversationId: c.id };
  const lines: string[] = [];
  const who = s(args.assign_to ?? args.assignTo).trim();
  if (who) {
    const w = who.toLowerCase();
    if (["nobody", "none", "unassign", "no one"].includes(w)) {
      payload.agentId = null;
      lines.push(`Person: ${t.assignedTo ?? "nobody"} → nobody (unassigned)`);
    } else {
      const m = w === "me" ? { ok: true as const, item: people.members.find((x) => x.id === me.id) ?? { id: me.id, name: me.name, email: "" } } : pickByName(people.members, who);
      if (!m.ok) return { ok: false, error: `${m.error} Only active people of this company can have a chat.`, status: 400 };
      payload.agentId = m.item.id;
      lines.push(`Person: ${t.assignedTo ?? "nobody"} → ${m.item.name}`);
    }
  }
  const dept = s(args.department).trim();
  if (dept) {
    if (["none", "no department", "nobody"].includes(dept.toLowerCase())) {
      payload.departmentId = null;
      lines.push(`Department: ${t.department ?? "none"} → none`);
    } else {
      const d = pickByName(people.departments, dept);
      if (!d.ok) return { ok: false, error: `${d.error} Departments: ${people.departments.map((x) => x.name).join(", ") || "none"}.`, status: 400 };
      payload.departmentId = d.item.id;
      lines.push(`Department: ${t.department ?? "none"} → ${d.item.name}`);
    }
  }
  const st0 = s(args.status).trim().toUpperCase();
  if (st0) {
    const st = st0 === "RESOLVED" || st0 === "RESOLVE" || st0 === "CLOSE" ? "CLOSED" : st0;
    if (!(ASSIGN_STATUSES as readonly string[]).includes(st)) return { ok: false, error: "status must be open, pending or resolved.", status: 400 };
    payload.status = st;
    lines.push(`Status: ${t.status || c.status} → ${st === "CLOSED" ? "resolved (closed)" : st.toLowerCase()}`);
  }
  if (lines.length === 0) return { ok: false, error: "Say what to change: assign_to (a person, \"me\" or \"nobody\"), department, and/or status (open, pending, resolved).", status: 400 };
  const summary = `Change the conversation with ${t.customer} in Houzs Connect (no message is sent to the customer):\n${lines.join("\n")}`;
  return { ok: true, payload, summary, warnings: [] };
}

export function buildRemarksProposal(text: string, contact: { id: string; name: string; remarks: string }, viaConversationId: string | null, me: { name: string }, now: number): Proposal {
  const line = remarksLine(text, me.name, myDate(now));
  if (appendRemarks(contact.remarks, line) === null) return { ok: false, error: `${contact.name}'s Remarks are full (${REMARKS_MAX} characters). Tidy them on the Contacts page first.`, status: 409 };
  return {
    ok: true,
    payload: { target: "remarks", contactId: contact.id, text, ...(viaConversationId ? { conversationId: viaConversationId } : {}) },
    summary: `Add a line to ${contact.name}'s Remarks in Houzs Connect (not sent to the customer):\n${line}`,
    warnings: [],
  };
}

export function buildInternalNoteProposal(text: string, t: ThreadView): Proposal {
  return {
    ok: true,
    payload: { target: "internal_note", conversationId: t.id, text },
    summary: `Add an internal note to the conversation with ${t.customer} (only staff see it; it is never sent to the customer):\n"${text}"`,
    warnings: [],
  };
}

/** The note text the person asked for: one paragraph, capped. */
export function noteText(args: Obj): { ok: true; text: string } | { ok: false; error: string } {
  const text = oneLine(s(args.note ?? args.text));
  if (!text) return { ok: false, error: "Write the note." };
  if (text.length > MAX_NOTE) return { ok: false, error: `The note is too long (at most ${MAX_NOTE} characters).` };
  return { ok: true, text };
}

// ── propose → confirm (I/O through deps) ────────────────────────────────────

const modulesOk = (deps: WriteDeps, kind: WriteKind) => KIND_MODULES[kind].some((m) => deps.modules.includes(m));
const NO_MODULE: Record<WriteKind, string> = {
  chat_reply: "Not available to your role: Service (the inbox) is not turned on for this account in Houzs Connect.",
  conversation_assign: "Not available to your role: Service (the inbox) is not turned on for this account in Houzs Connect.",
  contact_note: "Not available to your role: neither Service nor Contacts is turned on for this account in Houzs Connect.",
};
const OTHER_COMPANY = "That conversation is in another company of your inbox — switch to that company in Houzs Connect first. Nothing was done.";

/** The conversation, as the person: Connect's visibility (read) then the company rule (exec). */
async function conversationAsPerson(deps: WriteDeps, args: Obj): Promise<{ ok: true; t: ThreadView; c: ConvoState } | { ok: false; error: string; status: number }> {
  if (!deps.modules.includes("inbox")) return { ok: false, error: NO_MODULE.chat_reply, status: 403 };
  let id = s(args.conversationId ?? args.conversation_id).trim();
  if (!id) {
    const q = s(args.query).trim().slice(0, 100);
    if (!q) return { ok: false, error: "Give the conversationId (from waiting_now, search or another answer), or a customer name / phone / order number (query).", status: 400 };
    const r = await deps.read("/conversations", { q, limit: 5 });
    if (r.status !== 200) return { ok: false, error: r.message, status: r.status };
    const list = arr(obj(r.body).conversations);
    if (list.length === 0) return { ok: false, error: `No conversation you can see in Service matches "${q}".`, status: 404 };
    if (list.length > 1) return { ok: false, error: `"${q}" matches ${list.length} conversations: ${list.map((v) => `${s(v.customer) || "?"} (${s(v.id)})`).join(", ")} — give the conversationId.`, status: 400 };
    id = s(list[0].id);
  }
  if (!SAFE_ID.test(id)) return { ok: false, error: "That conversationId cannot be read.", status: 400 };
  const r = await deps.read(`/conversations/${id}`, { limit: 10 });
  if (r.status !== 200) return { ok: false, error: r.message, status: r.status }; // Connect's own visibility refusal
  const c = await deps.exec.conversation(id);
  if (!c) return { ok: false, error: OTHER_COMPANY, status: 403 };
  return { ok: true, t: readThread(r.body), c };
}

/** propose_*: switches → module → the record as the person → validate → ONE pending row. Nothing is written to Connect. */
export async function proposeWrite(deps: WriteDeps, kind: WriteKind, args: Obj): Promise<ProposeOutcome> {
  const now = deps.now?.() ?? Date.now();
  let target = `propose:${kind}`;
  const fail = (text: string, status: number): ProposeOutcome => ({ ok: false, text, status, target });
  const off = kindRefusal(await deps.store.switches(), kind);
  if (off) return fail(off, 403);
  if (!modulesOk(deps, kind)) return fail(NO_MODULE[kind], 403);

  let p: Proposal;
  if (kind === "chat_reply" || kind === "conversation_assign") {
    const cv = await conversationAsPerson(deps, args);
    if (!cv.ok) return fail(cv.error, cv.status);
    if (kind === "chat_reply") p = buildReplyProposal(args, cv.t, cv.c, now);
    else {
      const [members, departments] = await Promise.all([deps.exec.members(), deps.exec.departments()]);
      p = buildAssignProposal(args, cv.t, cv.c, { members, departments }, deps.me);
    }
  } else {
    const nt = noteText(args);
    if (!nt.ok) return fail(nt.error, 400);
    const as = s(args.as).trim() || "remarks";
    if (as !== "remarks" && as !== "internal_note") return fail('as must be "remarks" (the contact\'s Remarks) or "internal_note" (a staff-only note on a chat).', 400);
    const fromChat = !!(s(args.conversationId ?? args.conversation_id).trim() || (as === "internal_note" && s(args.query).trim()));
    if (as === "internal_note" || fromChat) {
      // From a chat: the inbox's visibility + company rule, as the Remarks box / Note mode in the chat's side panel.
      const cv = await conversationAsPerson(deps, args);
      if (!cv.ok) return fail(cv.error, cv.status);
      if (as === "internal_note") p = buildInternalNoteProposal(nt.text, cv.t);
      else {
        const ct = await deps.exec.contact(cv.c.contactId);
        if (!ct) return fail("That customer could not be read.", 404);
        p = buildRemarksProposal(nt.text, ct, cv.c.id, deps.me, now);
      }
    } else {
      // From the Contacts page: the contacts module, company scope.
      if (!deps.modules.includes("contacts")) return fail("Not available to your role: Contacts is not turned on for this account — give the conversationId instead (a chat you can see).", 403);
      const raw = s(args.contact ?? args.contactId ?? args.query).trim().slice(0, 100);
      if (!raw) return fail("Give the contact (name, phone or id) or a conversationId.", 400);
      let contactId = SAFE_ID.test(raw) ? raw : "";
      const direct = contactId ? await deps.read(`/contacts/${contactId}`) : null;
      if (!direct || direct.status !== 200) {
        const r = await deps.read("/contacts", { q: raw, limit: 5 });
        if (r.status !== 200) return fail(r.message, r.status);
        const list = arr(obj(r.body).contacts);
        if (list.length === 0) return fail(`No contact matches "${raw}".`, 404);
        if (list.length > 1) return fail(`"${raw}" matches ${list.length} contacts: ${list.map((x) => `${s(x.name)} (${s(x.id)})`).join(", ")} — give the contact id.`, 400);
        contactId = s(list[0].id);
      }
      const ct = await deps.exec.contact(contactId);
      if (!ct) return fail("Contact not found in this company.", 404);
      p = buildRemarksProposal(nt.text, ct, null, deps.me, now);
    }
  }
  if (!p.ok) return fail(p.error, p.status);
  if (!payloadAllowed(kind, p.payload)) return fail("That action is not allowed.", 400);
  target = writeTarget(kind, p.payload);
  const id = await deps.store.create({ tokenId: deps.tokenId, memberId: deps.me.id, email: deps.me.email, kind, payload: p.payload, summary: p.summary });
  return { ok: true, text: "", status: 200, target, confirmationId: id, summary: p.summary, warnings: p.warnings };
}

/**
 * confirm_action: the main switch → under the daily cap → the action's own
 * switch (peeked, so a switched-off action is refused without using it up) →
 * single-use claim → the payload fence → re-check as the person NOW (module,
 * visibility, company, window, colleague replied) → ONE write.
 */
export async function confirmWrite(deps: WriteDeps, raw: unknown): Promise<Outcome> {
  const now = deps.now?.() ?? Date.now();
  const cid = s(raw).trim();
  let target = `confirm:${cid.slice(0, 40)}`;
  const fail = (text: string, status: number): Outcome => ({ ok: false, text, status, target });
  if (!CONFIRMATION_ID.test(cid)) return fail("Give the confirmationId from the propose_… tool.", 400);
  const sw = await deps.store.switches();
  if (!sw.main) return fail(kindRefusal(sw, "chat_reply") ?? "AI actions are switched off.", 403);
  if ((await deps.store.confirmedSince(deps.me.email, myDayStartIso(now))) >= ACTIONS_PER_DAY) {
    return fail(`You have reached today's limit of ${ACTIONS_PER_DAY} AI actions. Do it in Houzs Connect instead, or try again tomorrow.`, 429);
  }
  const peek = await deps.store.peek(cid, deps.tokenId, deps.me.id);
  if (peek) {
    const off = kindRefusal(sw, peek);
    if (off) return fail(off, 403);
  }
  const act = await deps.store.consume(cid, deps.tokenId, deps.me.id);
  if (!act) return fail("That confirmation is unknown, already used, cancelled, expired (10 minutes) or not yours. Propose it again.", 404);
  const p = act.payload;
  target = writeTarget(act.kind, p);
  const done = async (text: string, status: number, ok = false): Promise<Outcome> => {
    await deps.store.finish(cid, status, text);
    return { ok, text, status, target };
  };
  if (!payloadAllowed(act.kind, p)) return done("Not done — the request was blocked by the AI connector's write fence.", 400);
  if (!modulesOk(deps, act.kind)) return done(`Not done — ${NO_MODULE[act.kind]}`, 403);

  // Re-check the conversation as the person now: access may have changed in the last 10 minutes.
  const convId = s(p.conversationId);
  let c: ConvoState | null = null;
  if (convId) {
    if (!deps.modules.includes("inbox")) return done(`Not done — ${NO_MODULE.chat_reply}`, 403);
    const r = await deps.read(`/conversations/${convId}`, { limit: 1 });
    if (r.status !== 200) return done(`Not done — ${r.message}`, r.status);
    c = await deps.exec.conversation(convId);
    if (!c) return done(`Not done — ${OTHER_COMPANY}`, 403);
  }

  try {
    if (act.kind === "chat_reply") {
      if (!c) return done("Not done — that conversation could not be read now.", 404);
      if (c.contactBlocked) return done("Not sent — the customer is blocked in Houzs Connect.", 409);
      if (!windowOpen(c.windowExpiresAt, now)) return done("Not sent — the 24-hour reply window closed after the proposal. Send an approved template from the conversation in Houzs Connect.", 409);
      const other = await deps.exec.humanReplySince(convId, s(p.proposedAt));
      if (other) return done(`Not sent — ${other.by} already replied at ${myTime(other.at)}. Read their reply first; propose again if you still want to send.`, 409);
      const out = await deps.exec.reply(convId, s(p.text));
      if (!out.sent) return done(`Not sent — ${out.reason ?? "Houzs Connect refused it"}.`, 409);
      await deps.exec.audit({ entityType: "conversation", entityId: convId, action: "replied" });
      if (out.status === "FAILED") return done(`Recorded in the chat, but WhatsApp did not deliver it: ${out.reason ?? "Meta refused the message"}. It is in System Logs to retry.`, 502);
      return done("Reply sent to the customer. It is in the conversation in Houzs Connect.", 200, true);
    }
    if (act.kind === "conversation_assign") {
      if (!c) return done("Not done — that conversation could not be read now.", 404);
      const set: { assignedAgentId?: string | null; assignedDepartmentId?: string | null } = {};
      if ("agentId" in p) {
        const id = p.agentId === null ? null : s(p.agentId);
        if (id && !(await deps.exec.members()).some((m) => m.id === id)) return done("Not done — that person is no longer an active member of this company.", 409);
        set.assignedAgentId = id;
      }
      if ("departmentId" in p) {
        const id = p.departmentId === null ? null : s(p.departmentId);
        if (id && !(await deps.exec.departments()).some((d) => d.id === id)) return done("Not done — that department no longer exists.", 409);
        set.assignedDepartmentId = id;
      }
      await deps.exec.assign(convId, set, p.status ? (s(p.status) as AssignStatus) : undefined);
      return done("Done — the conversation is updated in Houzs Connect.", 200, true);
    }
    // contact_note
    if (p.target === "internal_note") {
      await deps.exec.addNote(convId, s(p.text));
      await deps.exec.audit({ entityType: "conversation", entityId: convId, action: "note_added" });
      return done("Internal note added to the conversation (staff only).", 200, true);
    }
    const contactId = s(p.contactId);
    if (!convId && !deps.modules.includes("contacts")) return done("Not done — Contacts is not turned on for this account.", 403);
    if (c && c.contactId !== contactId) return done("Not done — that conversation now belongs to another contact.", 409);
    const ct = await deps.exec.contact(contactId);
    if (!ct) return done("Not done — contact not found in this company.", 404);
    // Appended to what is stored NOW, so a line added by someone else since the proposal is kept.
    const next = appendRemarks(ct.remarks, remarksLine(s(p.text), deps.me.name, myDate(now)));
    if (next === null) return done(`Not saved — ${ct.name}'s Remarks are full (${REMARKS_MAX} characters).`, 409);
    if (!(await deps.exec.saveRemarks(contactId, next))) return done("Not saved — contact not found in this company.", 404);
    await deps.exec.audit({ entityType: "contact", entityId: contactId, action: "remarks_updated" });
    return done(`Note added to ${ct.name}'s Remarks.`, 200, true);
  } catch (e) {
    console.error("[mcp] confirmed action failed:", act.kind, e);
    return done("Not done — Houzs Connect could not do that just now. Check the conversation before trying again.", 500);
  }
}

/** cancel_action: drop a pending proposal of this token + person. */
export async function cancelWrite(deps: Pick<WriteDeps, "store" | "tokenId" | "me">, raw: unknown): Promise<Outcome> {
  const cid = s(raw).trim();
  const target = `cancel:${cid.slice(0, 40)}`;
  if (!CONFIRMATION_ID.test(cid)) return { ok: false, text: "Give the confirmationId from the propose_… tool.", status: 400, target };
  const ok = await deps.store.cancel(cid, deps.tokenId, deps.me.id);
  return ok
    ? { ok: true, text: "Cancelled. Nothing was sent or changed.", status: 200, target }
    : { ok: false, text: "Nothing to cancel: that confirmation is unknown, already used or not yours.", status: 404, target };
}
