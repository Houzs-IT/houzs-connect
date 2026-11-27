// AI Connector round 4d (owner 2026-11-26 「加 全部一起做」): the morning brief
// email (D1), urgent alerts (D2) and the Monday data-gaps list (D4). PURE: no
// database, no network. proactive-run.ts reads AS THE PERSON and hands the
// answers here; proactive-store.ts keeps the opt-ins, the debounce and the log.
//
//   D1  isBriefDue       is this person's brief due on this tick?
//       buildBriefEmail  clean English HTML + text from daily_brief's answer;
//                        Monday adds data_gaps' answer (D4).
//   D2  computeAlerts    from the person's own reads: customers waiting longer
//                        than X minutes (supervisors: everyone in their inbox;
//                        agents: their own assigned chats), a spike in negative
//                        mood today, a customer who becomes a repeat complainer.
//       alertsToSend     the debounce: drop keys already sent in their window.
//       buildAlertEmail  one email per tick with every new alert.
//
// Every threshold lives in PROACTIVE_CONFIG (Settings -> AI Connector shows it
// read-only). No phone number ever reaches an email: customer labels go through
// safeCustomer (a name, else a masked number), and message snippets are clipped.

import { maskPhone, moodScanAllowed } from "./round3";

type Obj = Record<string, unknown>;

/** The ONE place the thresholds live. Shown read-only on Settings -> AI Connector. */
export const PROACTIVE_CONFIG = {
  /** Brief time offered by default (Malaysia time). Times are on the hour or half hour. */
  briefDefaultTime: "08:00",
  /** A brief not sent within this many hours of its time (the scheduler was down) is skipped for the day. */
  briefLateCutoffHours: 4,
  /** At most this many briefs are built on one scheduler tick (every 2 minutes); the rest go on the next. */
  maxBriefsPerTick: 5,
  /** A tick stops starting new people after this long. */
  tickBudgetMs: 10_000,
  alerts: {
    /** Supervisors / admins: a customer in their inbox waiting for a reply longer than this (minutes). */
    waitingMinutes: 30,
    /** Agents: one of their own assigned chats waiting longer than this (minutes). */
    myWaitingMinutes: 30,
    /** Supervisors: this many conversations with complaint words today counts as a negative-mood spike. */
    moodSpikeMin: 5,
    /** Supervisors: repeat complainers are looked for in the last this-many days (chat_review's rule). */
    complainerWindowDays: 7,
    /** The same repeat complainer alerts again only after this many days. */
    complainerRepeatDays: 7,
    /** Alerts are checked between these Malaysia hours (from inclusive, to exclusive). */
    hoursMyt: { from: 8, to: 22 },
    /** A person's alerts are checked at most once in this many minutes. */
    checkEveryMinutes: 30,
    /** At most this many alert lines per email (the rest are counted). */
    maxLinesPerEmail: 10,
    /** At most this many people are checked on one tick (least recently checked first). */
    maxPeoplePerTick: 5,
  },
} as const;

export type AlertCfg = { -readonly [K in keyof typeof PROACTIVE_CONFIG.alerts]: (typeof PROACTIVE_CONFIG.alerts)[K] };

export type BriefDays = "weekdays" | "daily";
export type Subscription = {
  memberId: string;
  briefEnabled: boolean;
  briefTime: string; // HH:MM, Malaysia time, on the hour or half hour
  briefDays: BriefDays;
  alertsEnabled: boolean;
};

export const DEFAULT_SUBSCRIPTION: Omit<Subscription, "memberId"> = {
  briefEnabled: false,
  briefTime: PROACTIVE_CONFIG.briefDefaultTime,
  briefDays: "weekdays",
  alertsEnabled: false,
};

// ── small helpers ───────────────────────────────────────────────────────────

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** A customer label safe for an email: the name, else a masked number. Never a full phone. */
export function safeCustomer(v: unknown): string {
  const t = str(v).trim();
  if (!t) return "(no name)";
  if (/^\+?[\d\s()•-]+$/.test(t)) return t.includes("•") ? t : maskPhone(t) || "(no name)";
  // A name that carries a long digit run (e.g. "Ali 60123456789") keeps only its last 4 digits.
  return t.replace(/\+?\d[\d\s-]{6,}\d/g, (m) => maskPhone(m)).slice(0, 60);
}

/** A short snippet of chat text: one line, at most n characters. */
export function clipSnippet(v: unknown, n = 60): string {
  const t = str(v).replace(/\s+/g, " ").trim().replace(/\+?\d[\d\s-]{6,}\d/g, (m) => maskPhone(m));
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ── time (Malaysia, UTC+8, no daylight saving) ──────────────────────────────

export type MytNow = { day: string; hhmm: string; minutes: number; weekday: number };

/** Malaysia wall-clock parts. weekday: 0 = Sunday … 6 = Saturday. */
export function mytNow(now: Date = new Date()): MytNow {
  const m = new Date(now.getTime() + 8 * 3600 * 1000);
  const hh = m.getUTCHours();
  const mm = m.getUTCMinutes();
  return { day: m.toISOString().slice(0, 10), hhmm: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`, minutes: hh * 60 + mm, weekday: m.getUTCDay() };
}

export function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// ── opt-in (D1 / D2) ────────────────────────────────────────────────────────

const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;

/** The settings form -> a subscription, or the reason it is refused. Unknown keys are ignored. */
export function parseSubscriptionInput(body: unknown, memberId: string): { ok: true; value: Subscription } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the settings as an object." };
  const b = body as Obj;
  const bool = (k: string, dflt: boolean): boolean | null => (b[k] === undefined ? dflt : typeof b[k] === "boolean" ? (b[k] as boolean) : null);
  const briefEnabled = bool("briefEnabled", DEFAULT_SUBSCRIPTION.briefEnabled);
  const alertsEnabled = bool("alertsEnabled", DEFAULT_SUBSCRIPTION.alertsEnabled);
  if (briefEnabled === null) return { ok: false, error: "briefEnabled must be true or false." };
  if (alertsEnabled === null) return { ok: false, error: "alertsEnabled must be true or false." };
  const briefTime = b.briefTime === undefined ? DEFAULT_SUBSCRIPTION.briefTime : str(b.briefTime);
  if (!TIME_RE.test(briefTime)) return { ok: false, error: "The brief time must be on the hour or half hour (Malaysia time), e.g. 08:00 or 07:30." };
  const briefDays = b.briefDays === undefined ? DEFAULT_SUBSCRIPTION.briefDays : str(b.briefDays);
  if (briefDays !== "weekdays" && briefDays !== "daily") return { ok: false, error: "Days must be weekdays or daily." };
  return { ok: true, value: { memberId, briefEnabled, briefTime, briefDays, alertsEnabled } };
}

/** A database row -> a subscription (dual-keyed reads). */
export function subscriptionFromRow(r: Obj): Subscription {
  const flag = (...k: string[]) => {
    for (const x of k) if (r[x] !== undefined && r[x] !== null) return r[x] === true || r[x] === "t" || Number(r[x]) === 1;
    return false;
  };
  const time = str(r.brief_time ?? r.briefTime);
  const days = str(r.brief_days ?? r.briefDays);
  return {
    memberId: str(r.member_id ?? r.memberId),
    briefEnabled: flag("brief_enabled", "briefEnabled"),
    briefTime: TIME_RE.test(time) ? time : PROACTIVE_CONFIG.briefDefaultTime,
    briefDays: days === "daily" ? "daily" : "weekdays",
    alertsEnabled: flag("alerts_enabled", "alertsEnabled"),
  };
}

/**
 * Is the brief due on this tick? Opted in, a day it is wanted, at or past its
 * time but not more than briefLateCutoffHours past it. "Already sent today" is
 * the store's job (one claimed key per person per day), not this function's.
 */
export function isBriefDue(sub: Subscription, now: MytNow, cutoffHours: number = PROACTIVE_CONFIG.briefLateCutoffHours): boolean {
  if (!sub.briefEnabled) return false;
  if (sub.briefDays === "weekdays" && (now.weekday === 0 || now.weekday === 6)) return false;
  const m = TIME_RE.exec(sub.briefTime);
  if (!m) return false;
  const at = Number(m[1]) * 60 + Number(m[2]);
  return now.minutes >= at && now.minutes < at + cutoffHours * 60;
}

/** Alerts are checked only 08:00-22:00 Malaysia time. */
export function inAlertHours(now: MytNow, hours: { from: number; to: number } = PROACTIVE_CONFIG.alerts.hoursMyt): boolean {
  const h = Math.floor(now.minutes / 60);
  return h >= hours.from && h < hours.to;
}

/** Monday's brief carries the data-gaps list (D4). */
export const isMonday = (now: MytNow): boolean => now.weekday === 1;

/**
 * Who one tick serves: briefs due and not yet sent today (capped), and the alert
 * checks in alert hours — least recently checked first, none checked within
 * checkEveryMinutes (capped). Bounded per tick.
 */
export function pickTickWork<T extends Subscription & { lastAlertCheckAt: string }>(
  subs: T[],
  now: MytNow,
  briefedToday: Set<string>,
  nowMs: number = Date.now()
): { briefs: T[]; alerts: T[] } {
  const a = PROACTIVE_CONFIG.alerts;
  const briefs = subs.filter((s) => isBriefDue(s, now) && !briefedToday.has(s.memberId)).slice(0, PROACTIVE_CONFIG.maxBriefsPerTick);
  const alerts = inAlertHours(now)
    ? subs
        .filter((s) => s.alertsEnabled)
        .filter((s) => !s.lastAlertCheckAt || nowMs - Date.parse(s.lastAlertCheckAt) >= (a.checkEveryMinutes - 2) * 60_000)
        .sort((x, y) => (x.lastAlertCheckAt || "").localeCompare(y.lastAlertCheckAt || ""))
        .slice(0, a.maxPeoplePerTick)
    : [];
  return { briefs, alerts };
}

// ── alerts (D2) ─────────────────────────────────────────────────────────────

export type AlertKind = "wait" | "mywait" | "mood" | "complainer";
export type Alert = { key: string; kind: AlertKind; title: string; detail: string; link: string };

const conversationLink = (origin: string, id: unknown) => `${origin}/inbox/open/${encodeURIComponent(str(id))}`;

/** Minutes since an ISO time (null when unreadable). */
const minutesSince = (v: unknown, nowMs: number): number | null => {
  const t = Date.parse(str(v));
  return Number.isFinite(t) ? Math.max(0, (nowMs - t) / 60_000) : null;
};

const minutesWords = (m: number): string => (m >= 120 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);

export type AlertInputs = {
  origin: string;
  nowMs: number;
  /** The person's role (Connect's own roles). Supervisors = round3.moodScanAllowed. */
  role: string;
  /** Supervisors: /inbox/waiting as the person (null = no access / not read). */
  waiting: unknown;
  /** Agents: /inbox/waiting?assigned=me as the person (null = no access / not read). */
  myWaiting: unknown;
  /** Supervisors: /inbox/chat-review?period=today as the person. */
  reviewToday: unknown;
  /** Supervisors: /inbox/chat-review for the last complainerWindowDays as the person. */
  reviewWeek: unknown;
  cfg?: Partial<AlertCfg>;
};

/**
 * Alert candidates from the person's own reads. Nothing here widens what they
 * see: a read they may not make arrives as null and yields nothing, and the
 * supervisor-only alerts are computed only for supervisors (Connect's rule for
 * chat content, round3.moodScanAllowed) even if a read was handed in.
 */
export function computeAlerts(x: AlertInputs): Alert[] {
  const cfg = { ...PROACTIVE_CONFIG.alerts, ...(x.cfg ?? {}) };
  const supervisor = moodScanAllowed(x.role);
  const out: Alert[] = [];

  const waitRows = (body: unknown, min: number, kind: "wait" | "mywait") => {
    for (const r of arr(obj(body).longestFirst)) {
      const m = minutesSince(r.waitingSince, x.nowMs);
      if (m === null || m < min) continue;
      const id = str(r.conversationId);
      if (!id) continue;
      const who = kind === "wait" ? ` · ${str(r.assignedTo) || "(unassigned)"}` : "";
      const snippet = clipSnippet(r.lastMessage);
      out.push({
        key: `${kind}:${id}`,
        kind,
        title: `${safeCustomer(r.customer)} has waited ${minutesWords(m)}`,
        detail: `${num(r.unansweredMessages) || 1} unanswered${who}${snippet ? ` · “${snippet}”` : ""}`,
        link: conversationLink(x.origin, id),
      });
    }
  };

  if (supervisor && x.waiting != null) waitRows(x.waiting, cfg.waitingMinutes, "wait");
  if (!supervisor && x.myWaiting != null) waitRows(x.myWaiting, cfg.myWaitingMinutes, "mywait");

  if (supervisor && x.reviewToday != null) {
    const q = obj(obj(x.reviewToday).quality);
    const n = num(q.negativeMood);
    if (n >= cfg.moodSpikeMin) {
      out.push({
        key: "mood",
        kind: "mood",
        title: `${n} conversations with complaint words today`,
        detail: `At or above the alert level of ${cfg.moodSpikeMin}. Keyword hints only — open Chat review to judge.`,
        link: `${x.origin}/inbox`,
      });
    }
  }

  if (supervisor && x.reviewWeek != null) {
    for (const c of arr(obj(x.reviewWeek).repeatComplainers)) {
      const id = str(c.conversationId);
      if (!id) continue;
      const hints = arr(c.keywordHints as unknown).map(str).filter(Boolean).slice(0, 3);
      out.push({
        key: `complainer:${id}`,
        kind: "complainer",
        title: `${safeCustomer(c.customer)} keeps complaining`,
        detail: [`${num(c.complaintMessages)} complaint message(s) on ${num(c.onDays)} day(s)`, hints.length ? `words: ${hints.join(", ")}` : "", str(c.assignedTo) || "(unassigned)", c.stillWaiting === true ? "still waiting for us" : ""]
          .filter(Boolean)
          .join(" · "),
        link: conversationLink(x.origin, id),
      });
    }
  }
  return out;
}

/** How far back a key counts as "already sent": once a day per wait / mood; complainers once a week. */
export function debounceDays(kind: AlertKind, cfg: Partial<AlertCfg> = {}): number {
  const c = { ...PROACTIVE_CONFIG.alerts, ...cfg };
  return kind === "complainer" ? c.complainerRepeatDays : 1;
}

/**
 * The debounce. `sent` = key -> the latest Malaysia day it was sent to this
 * person. A key sent today is always dropped (at most one email per alert per
 * person per day); a key sent within its debounce window is dropped too.
 */
export function alertsToSend(alerts: Alert[], sent: Map<string, string>, today: string, cfg: Partial<AlertCfg> = {}): Alert[] {
  const seen = new Set<string>();
  return alerts.filter((a) => {
    if (seen.has(a.key)) return false;
    seen.add(a.key);
    const last = sent.get(a.key);
    if (!last) return true;
    return dayDiff(last, today) >= debounceDays(a.kind, cfg);
  });
}

/** The earliest day the debounce must look back to. */
export function debounceSince(today: string, cfg: Partial<AlertCfg> = {}): string {
  const c = { ...PROACTIVE_CONFIG.alerts, ...cfg };
  return plusDays(today, -Math.max(1, c.complainerRepeatDays));
}

// ── email HTML ──────────────────────────────────────────────────────────────

export function escapeHtml(s: unknown): string {
  return str(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Only http(s) links are rendered as links — anything else becomes plain text. */
export const safeLink = (v: unknown): string => {
  const s = str(v);
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
};

type Line = { text: string; link: string };
type Section = { title: string; count: number | string; note?: string; lines: Line[]; more: number };

const FONT = "font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function sectionHtml(s: Section): string {
  const items = s.lines
    .map((l) => {
      const href = safeLink(l.link);
      const t = escapeHtml(l.text);
      return `<li style="margin:0 0 6px 0">${href ? `<a href="${escapeHtml(href)}" style="color:#1F5FAD;text-decoration:underline">${t}</a>` : t}</li>`;
    })
    .join("");
  const busy = typeof s.count === "string" ? s.count !== "0" : s.count > 0;
  const more = s.more > 0 ? `<p style="margin:4px 0 0 0;color:#6B6B66;font-size:13px">…and ${s.more} more.</p>` : "";
  const note = s.note ? `<p style="margin:2px 0 6px 0;color:#6B6B66;font-size:12px">${escapeHtml(s.note)}</p>` : "";
  return `<tr><td style="padding:14px 20px;border-top:1px solid #ECEEF2">
<h3 style="margin:0 0 4px 0;font-size:15px;color:#1B1E24">${escapeHtml(s.title)} <span style="display:inline-block;min-width:22px;padding:1px 8px;border-radius:10px;background:${busy ? "#FDF1DE" : "#E8F5EC"};color:${busy ? "#8A5A12" : "#1E6B3F"};font-size:13px;text-align:center">${escapeHtml(s.count)}</span></h3>
${note}${s.lines.length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:14px;color:#1B1E24">${items}</ul>` : ""}${more}
</td></tr>`;
}

function shell(title: string, introHtml: string, body: string, footer: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;padding:0;background:#F4F5F7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;${FONT}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border:1px solid #E2E5EA;border-radius:12px;${FONT}">
<tr><td style="padding:20px 20px 8px 20px"><h2 style="margin:0;font-size:19px;color:#1B1E24">${escapeHtml(title)}</h2><p style="margin:6px 0 0 0;font-size:14px;color:#4E5560">${introHtml}</p></td></tr>
${body}
<tr><td style="padding:16px 20px;border-top:1px solid #ECEEF2;font-size:12px;color:#6B6B66">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

function footerHtml(settingsUrl: string, unsubscribeUrl: string, why: string): string {
  const s = safeLink(settingsUrl);
  const u = safeLink(unsubscribeUrl);
  return `${escapeHtml(why)} It shows only what your Houzs Connect access lets you see.<br>${s ? `<a href="${escapeHtml(s)}" style="color:#1F5FAD">Change the time or what you get</a>` : ""}${s && u ? " · " : ""}${u ? `<a href="${escapeHtml(u)}" style="color:#1F5FAD">Unsubscribe</a>` : ""}`;
}

function sectionsText(sections: Section[]): string {
  return sections
    .map((s) => [`${s.title}: ${s.count}`, ...s.lines.map((l) => `  - ${l.text}${safeLink(l.link) ? ` <${safeLink(l.link)}>` : ""}`), ...(s.more > 0 ? [`  …and ${s.more} more.`] : [])].join("\n"))
    .join("\n\n");
}

const unavailable = (v: unknown): string | null => {
  const u = obj(v).unavailable;
  return typeof u === "string" ? u : null;
};

/** daily_brief's answer (as the person) -> email sections. Phone numbers are masked; failed-message rows are counted, never listed. */
export function briefSections(brief: Obj): { sections: Section[]; noAccess: string[]; items: number } {
  const sections: Section[] = [];
  const noAccess: string[] = [];
  let items = 0;

  const mine = brief.myConversations;
  if (unavailable(mine)) noAccess.push(unavailable(mine) as string);
  else if (mine) {
    const m = obj(mine);
    const top = arr(m.top);
    items += num(m.waitingForMyReply);
    sections.push({
      title: "Your chats waiting for your reply",
      count: num(m.waitingForMyReply),
      note: `Assigned to you and not closed: ${str(m.assignedToMeNotClosed) || "0"}. Unread: ${num(m.unread)}.`,
      lines: top.slice(0, 5).map((r) => ({ text: `${safeCustomer(r.customer)} · ${str(r.status)}${r.orderRef ? ` · ${str(r.orderRef)}` : ""}${r.waitingOnUs === true ? " · waiting for you" : ""}`, link: str(r.url) })),
      more: 0,
    });
  }

  const inbox = brief.inbox;
  if (unavailable(inbox)) noAccess.push(unavailable(inbox) as string);
  else if (inbox) {
    const i = obj(inbox);
    const top = arr(i.longestWaiting);
    const waiting = num(i.waitingForUs);
    sections.push({
      title: "Customers waiting for a reply",
      count: waiting,
      note: [i.longestWait ? `Longest wait: ${str(i.longestWait)}.` : "", `Unassigned and waiting: ${num(i.unassignedWaiting)}.`].filter(Boolean).join(" "),
      lines: top.slice(0, 5).map((w) => ({ text: `${safeCustomer(w.customer)} · ${str(w.waiting) || "waiting"} · ${str(w.assignedTo) || "(unassigned)"}`, link: str(w.url) })),
      more: Math.max(0, waiting - Math.min(top.length, 5)),
    });
  }

  const pay = brief.paymentsToCheck;
  if (unavailable(pay)) noAccess.push(unavailable(pay) as string);
  else if (pay) {
    const p = obj(pay);
    const top = arr(p.top);
    items += num(p.pending);
    sections.push({
      title: "Payments to check",
      count: num(p.pending),
      lines: top.slice(0, 5).map((r) => ({ text: `${safeCustomer(r.customer)}${r.amountRM != null ? ` · RM ${str(r.amountRM)}` : ""}${r.orderRef ? ` · ${str(r.orderRef)}` : ""}`, link: "" })),
      more: Math.max(0, num(p.pending) - Math.min(top.length, 5)),
    });
  }

  const failed = brief.failedMessages;
  if (unavailable(failed)) noAccess.push(unavailable(failed) as string);
  else if (failed) {
    const f = obj(failed);
    items += num(f.failedLast24h);
    sections.push({ title: "Messages that failed to send (24 h)", count: num(f.failedLast24h), note: "See System Logs for the details.", lines: [], more: 0 });
  }
  return { sections, noAccess, items };
}

/** data_gaps' answer -> email sections (D4). Counts, and unassigned chats with masked labels. */
export function gapSections(gaps: Obj): Section[] {
  const out: Section[] = [];
  const contacts = gaps.contacts;
  if (contacts && !unavailable(contacts)) {
    const c = obj(contacts);
    out.push({ title: "Contacts with no name", count: num(obj(c.noName).count), lines: [], more: 0 });
    out.push({ title: "Contacts with no phone", count: num(c.noPhone), lines: [], more: 0 });
    out.push({ title: "Contacts with a phone too short to be real", count: num(obj(c.phoneTooShort).count), lines: [], more: 0 });
  }
  const conv = gaps.conversations;
  if (conv && !unavailable(conv)) {
    const v = obj(conv);
    const ex = arr(v.examples);
    out.push({
      title: "Open chats with no one assigned",
      count: num(v.noAgentAssigned),
      note: `Of these, waiting for us: ${num(v.noAgentAssignedAndWaiting)}.`,
      lines: ex.slice(0, 5).map((e) => ({ text: `${safeCustomer(e.customer)} · ${str(e.department) || "(no department)"}${e.waitingOnUs === true ? " · waiting for us" : ""}`, link: str(e.url) })),
      more: Math.max(0, num(v.noAgentAssigned) - Math.min(ex.length, 5)),
    });
  }
  return out;
}

export type BriefEmailInputs = {
  /** daily_brief's answer (structuredContent / parsed text), as the person. */
  brief: Obj;
  /** data_gaps' answer — Monday (and test briefs) only. */
  gaps?: Obj | null;
  name: string;
  company: string;
  date: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  test?: boolean;
};

/** D1: the morning brief email. Clean English HTML + a plain-text part. */
export function buildBriefEmail(x: BriefEmailInputs): { subject: string; html: string; text: string; items: number } {
  const { sections, noAccess, items } = briefSections(x.brief);
  const gaps = x.gaps ? gapSections(x.gaps) : [];
  const first = (x.name || "").trim().split(/\s+/)[0] || "there";
  const dayWords = new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const subject = `${x.test ? "[Test] " : ""}Your Houzs Connect morning brief — ${items} item${items === 1 ? "" : "s"} · ${x.date}`;
  const intro = `Good morning, ${escapeHtml(first)}. ${escapeHtml(dayWords)}${x.company ? ` · ${escapeHtml(x.company)}` : ""}: ${items ? `<b>${items}</b> item${items === 1 ? "" : "s"} need${items === 1 ? "s" : ""} a look.` : "nothing needs a look right now."}`;
  let body = sections.length
    ? sections.map(sectionHtml).join("\n")
    : `<tr><td style="padding:14px 20px;border-top:1px solid #ECEEF2;font-size:14px;color:#4E5560">There is nothing in your brief: your Houzs Connect access does not cover any of its lists.</td></tr>`;
  if (noAccess.length) body += `\n<tr><td style="padding:10px 20px;border-top:1px solid #ECEEF2;font-size:12px;color:#6B6B66">${noAccess.map(escapeHtml).join(" ")}</td></tr>`;
  if (gaps.length) {
    body += `\n<tr><td style="padding:18px 20px 4px 20px;border-top:2px solid #E2E5EA"><h2 style="margin:0;font-size:17px;color:#1B1E24">Monday: data to clean up</h2><p style="margin:4px 0 0 0;font-size:13px;color:#4E5560">Gaps in what you can see, so the inbox and reports stay right.</p></td></tr>\n${gaps.map(sectionHtml).join("\n")}`;
  }
  const footer = footerHtml(x.settingsUrl, x.unsubscribeUrl, x.test ? "A test brief you asked for on Settings › AI Connector." : "You get this because you turned on the morning brief on Settings › AI Connector.");
  const html = shell(`${x.test ? "[Test] " : ""}Morning brief`, intro, body, footer);
  const text = [
    `Good morning, ${first}. ${dayWords}${x.company ? ` · ${x.company}` : ""}: ${items} item(s) need a look.`,
    "",
    sectionsText(sections),
    noAccess.length ? `\n${noAccess.join(" ")}` : "",
    gaps.length ? `\nMONDAY: DATA TO CLEAN UP\n\n${sectionsText(gaps)}` : "",
    "",
    safeLink(x.settingsUrl) ? `Change the time or what you get: ${safeLink(x.settingsUrl)}` : "",
    safeLink(x.unsubscribeUrl) ? `Unsubscribe: ${safeLink(x.unsubscribeUrl)}` : "",
  ].join("\n");
  return { subject, html, text, items };
}

const ALERT_TITLES: Record<AlertKind, string> = {
  wait: "Customers waiting too long for a reply",
  mywait: "Your chats waiting too long for your reply",
  mood: "Negative mood today",
  complainer: "Repeat complainers",
};

/** D2: one email with every new alert of this tick, grouped by kind. */
export function buildAlertEmail(x: { alerts: Alert[]; date: string; settingsUrl: string; unsubscribeUrl: string; maxLines?: number }): { subject: string; html: string; text: string } {
  const max = x.maxLines ?? PROACTIVE_CONFIG.alerts.maxLinesPerEmail;
  const kinds: AlertKind[] = ["mywait", "wait", "mood", "complainer"];
  let budget = max;
  const sections: Section[] = [];
  for (const k of kinds) {
    const list = x.alerts.filter((a) => a.kind === k);
    if (!list.length) continue;
    const shown = list.slice(0, Math.max(0, budget));
    budget -= shown.length;
    sections.push({ title: ALERT_TITLES[k], count: list.length, lines: shown.map((a) => ({ text: `${a.title} — ${a.detail}`, link: a.link })), more: list.length - shown.length });
  }
  const n = x.alerts.length;
  const subject = `Houzs Connect alert: ${n} new item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
  const intro = `These became urgent since the last check (${escapeHtml(x.date)}). Each one is sent to you at most once a day.`;
  const footer = footerHtml(x.settingsUrl, x.unsubscribeUrl, "You get this because you turned on urgent alerts on Settings › AI Connector.");
  return {
    subject,
    html: shell("Urgent alerts", intro, sections.map(sectionHtml).join("\n"), footer),
    text: [`These became urgent since the last check (${x.date}).`, "", sectionsText(sections), "", safeLink(x.settingsUrl) ? `Settings: ${safeLink(x.settingsUrl)}` : "", safeLink(x.unsubscribeUrl) ? `Unsubscribe: ${safeLink(x.unsubscribeUrl)}` : ""].join("\n"),
  };
}

/** The threshold table the settings page shows (read-only). */
export function thresholdsForDisplay(): { label: string; value: string }[] {
  const a = PROACTIVE_CONFIG.alerts;
  return [
    { label: "Customer waiting (supervisors and admins)", value: `any customer in your inbox waiting for a reply longer than ${a.waitingMinutes} minutes` },
    { label: "Your chats waiting (everyone else)", value: `a chat assigned to you waiting for your reply longer than ${a.myWaitingMinutes} minutes` },
    { label: "Negative mood spike (supervisors and admins)", value: `${a.moodSpikeMin} or more conversations with complaint words today (keyword hints)` },
    { label: "Repeat complainer (supervisors and admins)", value: `complaint words on 2+ days or in 3+ messages in the last ${a.complainerWindowDays} days; alerted again after ${a.complainerRepeatDays} days at most` },
    { label: "When alerts are checked", value: `every ${a.checkEveryMinutes} minutes, ${a.hoursMyt.from}:00–${a.hoursMyt.to}:00 Malaysia time` },
    { label: "Each alert", value: "emailed to you at most once a day" },
    { label: "Morning brief", value: `on the first check at or after your time (checks run every 2 minutes); skipped if not sent within ${PROACTIVE_CONFIG.briefLateCutoffHours} hours. Monday's brief adds the data to clean up.` },
  ];
}
