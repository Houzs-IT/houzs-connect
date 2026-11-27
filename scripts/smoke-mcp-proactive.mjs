// Pure smoke for AI Connector round 4d (src/lib/mcp/proactive.ts + lib/mail.ts):
// the opt-in (off by default, validation, row reading), when a brief is due,
// who one tick serves (bounded), the alerts per role (an agent never gets the
// supervisor-only alerts), the debounce (at most once a day per alert), the
// HTML builders (escaped, no full phone number, unsubscribe link, Monday data
// gaps) and the mail switch (nothing is sent without a key or on a preview
// copy). No DB, no network: the mail test uses a fake fetch.

import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const P = await import("../src/lib/mcp/proactive.ts");
const M = await import("../src/lib/mail.ts");
const S = await import("../src/lib/mcp/proactive-store.ts");
const core = await import("../src/lib/mcp/core.ts");

const ORIGIN = "https://chat.example";
// Friday 2026-11-27 10:00 Malaysia time = 02:00 UTC.
const FRI_10 = new Date("2026-11-27T02:00:00Z");
const now = P.mytNow(FRI_10);
assert(now.day === "2026-11-27" && now.hhmm === "10:00" && now.weekday === 5, `mytNow is Malaysia time (${JSON.stringify(now)})`);
assert(P.mytNow(new Date("2026-11-27T16:30:00Z")).day === "2026-11-28", "after 16:00 UTC it is already tomorrow in Malaysia");

// ── opt-in ──
assert(P.DEFAULT_SUBSCRIPTION.briefEnabled === false && P.DEFAULT_SUBSCRIPTION.alertsEnabled === false, "everything is off by default");
let r = P.parseSubscriptionInput({}, "m1");
assert(r.ok && !r.value.briefEnabled && !r.value.alertsEnabled && r.value.briefTime === "08:00" && r.value.briefDays === "weekdays", "an empty form saves the defaults: off, 08:00, weekdays");
r = P.parseSubscriptionInput({ briefEnabled: true, briefTime: "07:30", briefDays: "daily", alertsEnabled: true, memberId: "someone-else" }, "m1");
assert(r.ok && r.value.memberId === "m1" && r.value.briefTime === "07:30" && r.value.briefDays === "daily", "a valid form; the member id always comes from the session, never the form");
for (const bad of [{ briefTime: "07:15" }, { briefTime: "24:00" }, { briefTime: "8:00" }, { briefDays: "weekends" }, { briefEnabled: "yes" }, { alertsEnabled: 1 }]) {
  assert(!P.parseSubscriptionInput(bad, "m1").ok, `refused: ${JSON.stringify(bad)}`);
}
assert(!P.parseSubscriptionInput(null, "m1").ok && !P.parseSubscriptionInput([], "m1").ok, "refused: not an object");
const row = P.subscriptionFromRow({ member_id: "m1", brief_enabled: true, brief_time: "nonsense", brief_days: "x", alerts_enabled: "t" });
assert(row.briefEnabled && row.alertsEnabled && row.briefTime === "08:00" && row.briefDays === "weekdays", "a stored row is read safely (bad time / days fall back)");
assert(!P.subscriptionFromRow({ member_id: "m1" }).briefEnabled, "a row with no flags is off");

// ── when a brief is due ──
const sub = (o = {}) => ({ memberId: "m1", briefEnabled: true, briefTime: "08:00", briefDays: "weekdays", alertsEnabled: false, ...o });
assert(P.isBriefDue(sub(), now), "08:00 brief is due at 10:00");
assert(!P.isBriefDue(sub({ briefTime: "10:30" }), now), "not before its time");
assert(!P.isBriefDue(sub({ briefTime: "05:30" }), now), "skipped when more than 4 hours late");
assert(!P.isBriefDue(sub({ briefEnabled: false }), now), "not when off");
const sat = P.mytNow(new Date("2026-11-28T02:00:00Z"));
assert(!P.isBriefDue(sub(), sat) && P.isBriefDue(sub({ briefDays: "daily" }), sat), "weekdays skips Saturday; daily does not");
assert(P.isMonday(P.mytNow(new Date("2026-11-30T01:00:00Z"))) && !P.isMonday(now), "Monday is Monday in Malaysia");
assert(P.inAlertHours(now) && !P.inAlertHours(P.mytNow(new Date("2026-11-27T14:30:00Z"))) && !P.inAlertHours(P.mytNow(new Date("2026-11-26T23:30:00Z"))), "alerts only 08:00-22:00 Malaysia");

// ── who one tick serves (bounded) ──
const many = Array.from({ length: 12 }, (_, i) => ({ ...sub({ memberId: `m${i}`, alertsEnabled: true }), lastAlertCheckAt: i === 0 ? new Date(FRI_10.getTime() - 5 * 60_000).toISOString() : i === 1 ? "" : new Date(FRI_10.getTime() - (60 + i) * 60_000).toISOString() }));
let w = P.pickTickWork(many, now, new Set(["m2"]), FRI_10.getTime());
assert(w.briefs.length === P.PROACTIVE_CONFIG.maxBriefsPerTick && !w.briefs.some((s) => s.memberId === "m2"), "briefs: capped per tick, and not twice in a day");
assert(w.alerts.length === P.PROACTIVE_CONFIG.alerts.maxPeoplePerTick, "alert checks capped per tick");
assert(!w.alerts.some((s) => s.memberId === "m0"), "a person checked 5 minutes ago is not checked again");
assert(w.alerts[0].memberId === "m1", "never-checked first, then least recently checked");
w = P.pickTickWork(many, P.mytNow(new Date("2026-11-27T15:00:00Z")), new Set(), FRI_10.getTime());
assert(w.alerts.length === 0, "no alert checks at 23:00");

// ── alerts per role ──
const nowMs = FRI_10.getTime();
const ago = (min) => new Date(nowMs - min * 60_000).toISOString();
const waitingBody = {
  longestFirst: [
    { conversationId: "c1", customer: "60123456789", waitingSince: ago(95), unansweredMessages: 3, assignedTo: "Agent A", lastMessage: "Hello <b>where</b> is my sofa?? call me 0123456789 please, it has been a very very long time" },
    { conversationId: "c2", customer: "Siti", waitingSince: ago(40), unansweredMessages: 1, assignedTo: null, lastMessage: "ok" },
    { conversationId: "c3", customer: "Ali", waitingSince: ago(10), unansweredMessages: 1, assignedTo: "Agent B", lastMessage: "hi" },
  ],
};
const reviewToday = { quality: { negativeMood: 6 } };
const reviewWeek = { repeatComplainers: [{ conversationId: "c9", customer: "Mr Tan", complaintMessages: 4, onDays: 2, keywordHints: ["refund", "lambat"], assignedTo: "Agent A", stillWaiting: true, samples: [{ text: "secret long complaint text" }] }] };
const sup = P.computeAlerts({ origin: ORIGIN, nowMs, role: "MANAGER", waiting: waitingBody, myWaiting: null, reviewToday, reviewWeek });
assert(sup.filter((a) => a.kind === "wait").map((a) => a.key).join() === "wait:c1,wait:c2", `supervisor: customers waiting > 30 min (${sup.map((a) => a.key)})`);
assert(sup.some((a) => a.key === "mood") && sup.some((a) => a.key === "complainer:c9"), "supervisor: mood spike + repeat complainer");
assert(!JSON.stringify(sup).includes("60123456789") && !JSON.stringify(sup).includes("0123456789"), "no full phone number in any alert (label or snippet)");
assert(!JSON.stringify(sup).includes("secret long complaint text"), "complainer alerts carry keyword hints, never the messages");
assert(sup.find((a) => a.key === "wait:c1").detail.length < 140, "snippets are short");
assert(sup.find((a) => a.key === "wait:c1").link === `${ORIGIN}/inbox/open/c1`, "each alert links to the chat");
assert(P.computeAlerts({ origin: ORIGIN, nowMs, role: "MANAGER", waiting: null, myWaiting: null, reviewToday: { quality: { negativeMood: 4 } }, reviewWeek: null }).length === 0, "below the mood level / no access to the reads → nothing");
// An agent: even if supervisor-only reads were handed in, they yield nothing.
const agent = P.computeAlerts({ origin: ORIGIN, nowMs, role: "AGENT", waiting: waitingBody, myWaiting: { longestFirst: [waitingBody.longestFirst[1]] }, reviewToday, reviewWeek });
assert(agent.length === 1 && agent[0].key === "mywait:c2", `agent: only their own assigned chats (${agent.map((a) => a.key)})`);
assert(P.computeAlerts({ origin: ORIGIN, nowMs, role: "AGENT", waiting: null, myWaiting: null, reviewToday: null, reviewWeek: null }).length === 0, "agent without inbox access → nothing");
for (const role of ["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER"]) assert(P.computeAlerts({ origin: ORIGIN, nowMs, role, waiting: null, myWaiting: null, reviewToday, reviewWeek: null }).length === 1, `${role} is a supervisor (Connect's chat-content rule)`);
for (const role of ["AGENT", "VIEWER", "", null]) assert(P.computeAlerts({ origin: ORIGIN, nowMs, role, waiting: null, myWaiting: null, reviewToday, reviewWeek: null }).length === 0, `${role} gets no mood alert`);

// ── the debounce ──
const today = "2026-11-27";
let sent = new Map([["wait:c1", today], ["complainer:c9", "2026-11-24"], ["mood", "2026-11-26"]]);
let out = P.alertsToSend(sup, sent, today);
assert(!out.some((a) => a.key === "wait:c1"), "an alert sent today is not sent again today");
assert(out.some((a) => a.key === "wait:c2"), "a new alert is sent");
assert(out.some((a) => a.key === "mood"), "the mood alert can come again the next day");
assert(!out.some((a) => a.key === "complainer:c9"), "a repeat complainer is not re-sent within 7 days");
sent = new Map([["complainer:c9", "2026-11-20"]]);
assert(P.alertsToSend(sup, sent, today).some((a) => a.key === "complainer:c9"), "…but is after 7 days");
assert(P.alertsToSend([...sup, ...sup], new Map(), today).length === sup.length, "duplicate keys in one tick are sent once");
assert(P.debounceSince(today) === "2026-11-20", "the ledger is read back 7 days");

// ── HTML builders ──
const brief = {
  myConversations: { assignedToMeNotClosed: 7, waitingForMyReply: 2, unread: 1, top: [{ customer: "60198765432", status: "OPEN", orderRef: "SO-1", waitingOnUs: true, url: `${ORIGIN}/inbox/open/c5` }, { customer: "<script>alert(1)</script>", status: "OPEN", url: "javascript:alert(1)" }] },
  inbox: { waitingForUs: 9, longestWait: "2 h", unassignedWaiting: 3, longestWaiting: [{ customer: "Siti", waiting: "2 h", assignedTo: "(unassigned)", url: `${ORIGIN}/inbox/open/c2` }] },
  paymentsToCheck: { unavailable: "You do not have access to payments in Houzs Connect." },
  failedMessages: { failedLast24h: 4, latest: [{ to: "60111222333", error: "x" }] },
};
const gaps = { contacts: { noName: { count: 12, examples: [{ phone: "60111222333" }] }, noPhone: 2, phoneTooShort: { count: 1, examples: [] } }, conversations: { noAgentAssigned: 8, noAgentAssignedAndWaiting: 3, examples: [{ customer: "60177777777", department: "Delivery", waitingOnUs: true, url: `${ORIGIN}/inbox/open/c7` }] } };
const mail = P.buildBriefEmail({ brief, gaps, name: "Lee Wei", company: "Houzs", date: today, settingsUrl: `${ORIGIN}/settings/ai-connector`, unsubscribeUrl: `${ORIGIN}/api/mcp/unsubscribe?t=abc` });
assert(mail.subject.includes("6 items") && mail.items === 6, `subject counts the items (my waiting 2 + failed 4) (${mail.subject})`);
assert(mail.html.includes("Good morning, Lee.") && mail.html.includes("Friday, 27 November 2026"), "greets by first name with the date");
assert(!mail.html.includes("<script>") && mail.html.includes("&lt;script&gt;"), "HTML is escaped");
assert(!mail.html.includes("javascript:"), "only http(s) links are rendered");
for (const ph of ["60198765432", "60111222333", "60177777777"]) assert(!mail.html.includes(ph) && !mail.text.includes(ph), `no full phone number in the brief (${ph})`);
assert(mail.html.includes(`href="${ORIGIN}/inbox/open/c5"`), "lines link into Connect");
assert(mail.html.includes("You do not have access to payments"), "a list the person may not read is named, not shown");
assert(mail.html.includes("Monday: data to clean up") && mail.html.includes("Open chats with no one assigned"), "data gaps section when given");
assert(mail.html.includes("api/mcp/unsubscribe?t=abc") && mail.text.includes("Unsubscribe:"), "unsubscribe link in HTML and text");
assert(!P.buildBriefEmail({ brief, gaps: null, name: "", company: "", date: today, settingsUrl: "", unsubscribeUrl: "" }).html.includes("Monday: data"), "no gaps section on other days");
assert(P.buildBriefEmail({ brief, name: "A", company: "", date: today, settingsUrl: "", unsubscribeUrl: "", test: true }).subject.startsWith("[Test] "), "a test brief says so");
assert(P.buildBriefEmail({ brief: {}, name: "A", company: "", date: today, settingsUrl: "", unsubscribeUrl: "" }).html.includes("does not cover any of its lists"), "an empty brief explains why");
const am = P.buildAlertEmail({ alerts: sup, date: today, settingsUrl: `${ORIGIN}/settings/ai-connector`, unsubscribeUrl: `${ORIGIN}/api/mcp/unsubscribe?t=abc`, maxLines: 2 });
assert(am.subject === `Houzs Connect alert: ${sup.length} new items need attention`, am.subject);
assert(am.html.includes("…and") && am.html.includes("Unsubscribe"), "alert email caps its lines and carries the unsubscribe link");
assert(!am.html.includes("60123456789"), "no phone number in the alert email");
assert(P.safeCustomer("Ali 60123456789") === "Ali 60•••••6789" && P.safeCustomer("") === "(no name)" && P.safeCustomer("Siti") === "Siti", "safeCustomer masks numbers, keeps names");
assert(P.escapeHtml(`"'<>&`) === "&quot;&#39;&lt;&gt;&amp;", "escapeHtml");
assert(P.thresholdsForDisplay().length >= 6 && P.thresholdsForDisplay().some((t) => t.value.includes("30 minutes")), "thresholds shown from the one config");

// ── mail switch: nothing is sent without a key, or from a preview copy ──
assert(M.mailOffReason({}) !== null && !M.mailConfigured({ BRIEF_MAIL_FROM: "a@b.c" }), "no key → off");
assert(M.mailOffReason({ RESEND_API_KEY: "k", BRIEF_MAIL_FROM: "a@b.c", CONNECT_PREVIEW: "1" }).includes("preview"), "preview / staging never sends");
assert(M.mailConfigured({ RESEND_API_KEY: "k", BRIEF_MAIL_FROM: "Houzs <a@b.c>" }), "key + from → on");
assert(!(M.mailOffReason({}) ?? "").includes("undefined"), "the reason is plain words");
let calls = 0;
const fakeFetch = async (url, init) => {
  calls++;
  const b = JSON.parse(init.body);
  assert(url === "https://api.resend.com/emails" && b.to[0] === "x@y.z" && init.headers.Authorization === "Bearer k", "Resend request shape");
  return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
};
let res = await M.sendMail({}, { to: "x@y.z", subject: "s", html: "h", text: "t" }, fakeFetch);
assert(!res.ok && calls === 0, "not configured → nothing is sent");
res = await M.sendMail({ RESEND_API_KEY: "k", BRIEF_MAIL_FROM: "a@b.c" }, { to: "not-an-email", subject: "s", html: "h", text: "t" }, fakeFetch);
assert(!res.ok && calls === 0, "a bad address → nothing is sent");
res = await M.sendMail({ RESEND_API_KEY: "k", BRIEF_MAIL_FROM: "a@b.c" }, { to: "x@y.z", subject: "s", html: "h", text: "t" }, fakeFetch);
assert(res.ok && res.id === "re_1" && calls === 1, "configured → one provider call");
res = await M.sendMail({ RESEND_API_KEY: "k", BRIEF_MAIL_FROM: "a@b.c" }, { to: "x@y.z", subject: "s", html: "h", text: "t" }, async () => new Response(JSON.stringify({ message: "bad from" }), { status: 422 }));
assert(!res.ok && res.error.includes("422"), "a provider refusal is reported");

// ── tokens and clients ──
assert(S.UNSUB_TOKEN_RE.test(core.randomToken(24)), "an unsubscribe token is what randomToken(24) makes");
assert(!S.UNSUB_TOKEN_RE.test("short") && !S.UNSUB_TOKEN_RE.test("x".repeat(31) + "!"), "anything else is refused");
assert(core.isInternalClient("mcpc_morning_brief") && core.isInternalClient("mcpc_leak_check") && !core.isInternalClient("mcpc_abc"), "the brief's client is internal (never usable through OAuth)");

console.log(`smoke-mcp-proactive: ok (${n} assertions)`);
