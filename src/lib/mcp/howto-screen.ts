// ---------------------------------------------------------------------------
// AI Connector round 5b: explain_screen and where_is (owner 2026-11-27).
//   explain_screen {path | labels}  what a Connect screen is, its tabs and the
//                                   buttons on it (with ?highlight= links)
//   where_is {thing}                which screen and button does X
// Pure, no Connect data. Every path is a page in src/app and every label exists
// in src/ (scripts/smoke-mcp-howto.mjs); canOpen follows the page gate.
// ---------------------------------------------------------------------------
import { rank, redactQuestion, NO_GUIDE_NOTE, type HowtoCtx, type HowtoOutcome } from "./howto";
import { blockedNote, canOpenPage, connectLink } from "./howto-types";

/** One screen: `path` is the page (":id" = any conversation), labels are exact UI labels. */
export type Screen = {
  path: string;
  title: string;
  sidebar: string;
  keywords: string[];
  purpose: string;
  tabs: string[];
  actions: { label: string; what: string; keywords: string[] }[];
};

export const SCREENS: Screen[] = [
  {
    path: "/inbox",
    title: "Service — conversation list",
    sidebar: "Service",
    keywords: ["inbox", "service", "chats", "conversation list", "客服"],
    purpose: "Every WhatsApp conversation you can see. The left menu holds views, status and tags; the list has search, tabs and filters; open a chat to reply.",
    tabs: ["All", "Unread", "Dept", "Overdue"],
    actions: [
      { label: "Search name, number or order no.", what: "Search chats you can see by name, phone or order number.", keywords: ["search", "find chat", "order number", "搜索"] },
      { label: "Filters", what: "Tags, assigned to, department, last message type, sort; save as a view.", keywords: ["filter", "sort", "saved view", "筛选"] },
      { label: "New conversation", what: "Message a customer who has not written, with an approved template.", keywords: ["new chat", "start conversation", "新对话"] },
      { label: "Assigned to me", what: "Only chats assigned to you.", keywords: ["my chats", "mine", "我的"] },
      { label: "Unassigned", what: "Chats nobody owns.", keywords: ["unassigned", "no owner", "未分配"] },
      { label: "Watching", what: "Chats you follow as a colleague.", keywords: ["watching", "following"] },
      { label: "Overdue", what: "Customers waiting 30 minutes or more for a reply.", keywords: ["overdue", "sla", "late", "waiting", "逾期"] },
      { label: "Quick replies", what: "Manage saved answers (Settings).", keywords: ["quick reply", "canned", "快捷回复"] },
      { label: "Auto replies", what: "Welcome and away messages (Settings).", keywords: ["auto reply", "away message", "welcome", "自动回复"] },
    ],
  },
  {
    path: "/inbox/:id",
    title: "Service — an open conversation",
    sidebar: "Service",
    keywords: ["conversation", "chat", "thread", "reply box", "composer"],
    purpose: "One customer's thread: the header (window time, Assign, Resolve, actions), the messages, the reply box and the customer info panel.",
    tabs: ["Reply", "Private note", "Overview", "Order"],
    actions: [
      { label: "Assign", what: "Give the chat to an agent and/or department.", keywords: ["assign", "transfer", "reassign", "指派", "转给"] },
      { label: "Resolve", what: "Close the chat (Reopen on a closed one).", keywords: ["resolve", "close", "done", "解决", "关闭"] },
      { label: "Conversation actions", what: "Mark as unread, Mark as pending, Push to queue, Unassign.", keywords: ["pending", "queue", "unread", "unassign", "more actions"] },
      { label: "Reply", what: "Write to the customer (inside the 24-hour window).", keywords: ["reply", "answer", "回复"] },
      { label: "Private note", what: "A note for colleagues; never sent to the customer.", keywords: ["internal note", "private note", "内部备注"] },
      { label: "Template", what: "Send an approved template (works when the window is closed).", keywords: ["template", "hsm", "window closed", "模板"] },
      { label: "Quick reply", what: "Insert a saved answer.", keywords: ["quick reply", "saved answer", "快捷回复"] },
      { label: "Remarks", what: "The customer's standing note (Save remark).", keywords: ["remarks", "customer note", "客户备注"] },
      { label: "Show customer info", what: "Open the customer info panel when it is hidden.", keywords: ["customer info", "panel", "profile"] },
    ],
  },
  {
    path: "/contacts",
    title: "Contacts",
    sidebar: "Contacts",
    keywords: ["contacts", "customers", "address book", "联系人"],
    purpose: "The company's customers: search, segments, tags, add, import, block, merge duplicates.",
    tabs: [],
    actions: [
      { label: "Add contact", what: "Save a new customer (phone required).", keywords: ["add contact", "new customer", "添加联系人"] },
      { label: "Import CSV", what: "Import many contacts from a CSV file.", keywords: ["import", "csv", "upload contacts", "导入"] },
      { label: "Search name, phone or order no.", what: "Find a contact.", keywords: ["search contact", "find customer"] },
      { label: "Blocked", what: "Contacts Connect never messages.", keywords: ["blocked", "block", "拉黑"] },
    ],
  },
  {
    path: "/dashboard",
    title: "Dashboard — overview",
    sidebar: "Dashboard",
    keywords: ["dashboard", "reply rate", "first reply", "overview", "仪表盘"],
    purpose: "Reply rate, average first reply, conversations by status and volume for the chosen period.",
    tabs: ["Overview", "Support", "Live reporting"],
    actions: [
      { label: "Last 7 days", what: "Pick the period (7 / 30 / 90 days).", keywords: ["period", "date range", "last week"] },
      { label: "Export", what: "Download the dashboard figures.", keywords: ["export", "download report"] },
    ],
  },
  {
    path: "/dashboard?tab=support",
    title: "Dashboard — support (agents report)",
    sidebar: "Dashboard",
    keywords: ["agents report", "reply speed", "per agent", "performance", "绩效"],
    purpose: "Per-agent assigned, open, closed, replied, first reply and reply time; resolution time; first reply over time.",
    tabs: ["Overview", "Support", "Live reporting"],
    actions: [
      { label: "Agents report", what: "The per-agent table.", keywords: ["agents report", "who is slow", "agent performance"] },
      { label: "All departments", what: "Limit the report to one department.", keywords: ["department filter"] },
    ],
  },
  {
    path: "/dashboard?tab=live",
    title: "Dashboard — live reporting",
    sidebar: "Dashboard",
    keywords: ["live", "right now", "who is online", "waiting now", "实时"],
    purpose: "What is happening now: agents online, open, waiting for reply, bot handling, who is waiting right now.",
    tabs: ["Overview", "Support", "Live reporting"],
    actions: [
      { label: "Waiting right now", what: "Customers waiting for a reply, longest first.", keywords: ["waiting now", "queue now", "who is waiting"] },
      { label: "Who is online", what: "Staff active in the last 2 minutes.", keywords: ["online", "who is online", "在线"] },
    ],
  },
  {
    path: "/campaigns",
    title: "Campaigns",
    sidebar: "Campaigns",
    keywords: ["campaigns", "bulk", "marketing", "群发"],
    purpose: "Campaign list with status, approval and results. The AI Connector only explains campaigns; it never sends one.",
    tabs: [],
    actions: [{ label: "New campaign", what: "Start the Audience → Message → Review & send wizard.", keywords: ["new campaign", "create campaign"] }],
  },
  {
    path: "/settings/templates",
    title: "Templates",
    sidebar: "Templates",
    keywords: ["templates", "hsm", "meta status", "模板"],
    purpose: "WhatsApp templates with their Meta status, variable mapping and read rate.",
    tabs: ["All", "Approved", "In review", "Rejected", "Needs mapping"],
    actions: [
      { label: "New template", what: "Write a template and submit it to Meta.", keywords: ["new template", "create template", "新模板"] },
      { label: "Sync with Meta", what: "Refresh the templates' status from Meta.", keywords: ["sync", "refresh status"] },
    ],
  },
  {
    path: "/settings/team",
    title: "Team & access",
    sidebar: "Team & access",
    keywords: ["team", "users", "staff", "roles", "access requests", "用户"],
    purpose: "Who can use Connect, their role and companies; invite people and approve access requests. Admins only.",
    tabs: [],
    actions: [
      { label: "Invite person", what: "Copy the access-request link for a new person.", keywords: ["invite", "add user", "new staff"] },
      { label: "Access requests", what: "Approve or reject requests (manager, then Super Admin).", keywords: ["access request", "approve user"] },
    ],
  },
  {
    path: "/settings/roles",
    title: "Roles & permissions",
    sidebar: "Roles & permissions",
    keywords: ["roles", "permissions", "matrix", "权限"],
    purpose: "What each role can do in this company. Super Admins change it.",
    tabs: [],
    actions: [{ label: "See every chat", what: "Lets a role read every conversation.", keywords: ["see all chats", "see every chat"] }],
  },
  {
    path: "/settings/access",
    title: "Access (modules per person)",
    sidebar: "Access",
    keywords: ["module access", "who can open", "access", "模块"],
    purpose: "Which modules each person can open in this company. Super Admins change it.",
    tabs: [],
    actions: [{ label: "Use role", what: "Forget a person's ticks and go back to the role's modules.", keywords: ["reset access", "use role"] }],
  },
  {
    path: "/settings/ai-connector",
    title: "AI Connector",
    sidebar: "AI Connector",
    keywords: ["ai connector", "claude", "chatgpt", "morning brief", "AI连接"],
    purpose: "Your connector URL, connected apps and morning brief; for the connector admin also approvals, AI action switches, lookups, the gap log and the leak check.",
    tabs: [],
    actions: [
      { label: "Connector URL", what: "The address to paste into Claude / ChatGPT.", keywords: ["connector url", "connect claude", "connect chatgpt"] },
      { label: "Morning brief & alerts", what: "Turn on the morning email and urgent alerts.", keywords: ["morning brief", "alerts", "daily email", "早报"] },
      { label: "AI actions", what: "The switches for AI replies, assignments and notes (admin).", keywords: ["ai actions", "switch", "allow ai"] },
      { label: "Questions with no guide yet", what: "Help questions no guide answered (admin).", keywords: ["gap log", "unanswered questions"] },
    ],
  },
];

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const pathOnly = (p: string) => p.replace(/^https?:\/\/[^/]+/i, "").split("#")[0];

/** The screen of a path: exact (with query), then by path, then /inbox/<id> -> /inbox/:id. */
export function screenForPath(path: string): Screen | null {
  const p = pathOnly(path).replace(/[?&]highlight=[^&]*/, "");
  const bare = p.split("?")[0];
  return (
    SCREENS.find((s) => s.path === p) ??
    SCREENS.find((s) => s.path === bare) ??
    (/^\/inbox\/[^/]+$/.test(bare) ? (SCREENS.find((s) => s.path === "/inbox/:id") ?? null) : null)
  );
}

/** Screens whose labels include most of the given labels (read off a screenshot). */
export function screenForLabels(labels: string[]): Screen | null {
  const want = labels.map(norm).filter(Boolean);
  if (!want.length) return null;
  const scored = SCREENS.map((s) => {
    const own = new Set([...s.tabs, ...s.actions.map((a) => a.label), s.title, s.sidebar].map(norm));
    return { s, n: want.filter((w) => own.has(w)).length };
  }).sort((a, b) => b.n - a.n);
  return scored[0].n > 0 ? scored[0].s : null;
}

const screenView = (s: Screen, ctx: HowtoCtx) => {
  const canOpen = canOpenPage(s.path, ctx.viewer);
  const at = (label: string) => connectLink(ctx.origin, s.path, label) ?? `${s.path} (open the conversation first)`;
  return {
    path: s.path,
    title: s.title,
    menu: s.sidebar,
    purpose: s.purpose,
    canOpen,
    ...(canOpen ? {} : { note: blockedNote({ page: s.path }, ctx.viewer) }),
    link: connectLink(ctx.origin, s.path, null),
    tabs: s.tabs,
    buttons: s.actions.map((a) => ({ label: a.label, what: a.what, link: at(a.label), ...(ctx.hasShot?.(s.path, a.label) ? { showMe: { path: s.path, label: a.label } } : {}) })),
  };
};

/** Every (screen, button) pair as a rankable item for where_is. */
const ITEMS = SCREENS.flatMap((s) => s.actions.map((a) => ({ id: `${s.path}#${a.label}`, title: `${a.label} ${s.title}`, keywords: [a.label, ...a.keywords], screen: s, action: a })));

/** where_is ranking: the best (screen, button) pairs for a thing, open screens first. */
export function whereIs(thing: string) {
  return rank(ITEMS, thing).slice(0, 5).map((h) => h.item);
}

function explainScreen(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const path = typeof args.path === "string" ? args.path.trim().slice(0, 300) : "";
  const labels = Array.isArray(args.labels) ? args.labels.filter((l): l is string => typeof l === "string").slice(0, 30) : [];
  const s = (path && screenForPath(path)) || screenForLabels(labels);
  const asked = path || labels.join(", ");
  if (!s) {
    return {
      result: { content: [{ type: "text", text: JSON.stringify({ matched: false, message: "That screen is not in the screen guide yet. Screens:", screens: SCREENS.map((x) => ({ path: x.path, title: x.title })) }) }] },
      status: 200,
      note: asked ? NO_GUIDE_NOTE : "",
      target: asked ? redactQuestion(asked) : "explain_screen (empty)",
    };
  }
  return { result: { content: [{ type: "text", text: JSON.stringify({ screen: screenView(s, ctx), tip: "how_to explains a whole task; show_me {path, label} shows a screenshot." }) }] }, status: 200, note: "", target: `explain_screen ${s.path}` };
}

function whereIsTool(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const thing = typeof args.thing === "string" ? args.thing.trim().slice(0, 200) : "";
  if (!thing) return { result: { content: [{ type: "text", text: "Say what you are looking for, e.g. \"where do I assign a chat\"." }], isError: true }, status: 400, note: "", target: "where_is" };
  const hits = whereIs(thing);
  if (!hits.length) return { result: { content: [{ type: "text", text: JSON.stringify({ matched: false, message: "Not in the screen guide yet. Try how_to." }) }] }, status: 200, note: NO_GUIDE_NOTE, target: redactQuestion(thing) };
  const out = hits.map((h) => {
    const canOpen = canOpenPage(h.screen.path, ctx.viewer);
    return {
      screen: h.screen.title,
      path: h.screen.path,
      menu: h.screen.sidebar,
      press: h.action.label,
      what: h.action.what,
      canOpen,
      ...(canOpen ? {} : { note: blockedNote({ page: h.screen.path }, ctx.viewer) }),
      link: connectLink(ctx.origin, h.screen.path, h.action.label) ?? `${h.screen.path} (open the conversation first)`,
      ...(ctx.hasShot?.(h.screen.path, h.action.label) ? { showMe: { path: h.screen.path, label: h.action.label } } : {}),
    };
  });
  return { result: { content: [{ type: "text", text: JSON.stringify({ places: out }) }] }, status: 200, note: "", target: `where_is ${hits.map((h) => h.id).join(",").slice(0, 180)}` };
}

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const SCREEN_TOOLS = [
  {
    name: "explain_screen",
    title: "Explain a Houzs Connect screen",
    description: "What a Connect screen is for, its tabs and the buttons on it, with links that highlight each button. Pass path (a Connect URL or path, e.g. /inbox, /settings/templates) or labels (the words you can read on a screenshot).",
    inputSchema: { type: "object", properties: { path: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "where_is",
    title: "Where is … in Houzs Connect",
    description: "Which screen and which button does something (e.g. \"assign a chat\", \"overdue chats\", \"morning brief\"), with a link that highlights the button.",
    inputSchema: { type: "object", properties: { thing: { type: "string" } }, required: ["thing"], additionalProperties: false },
    annotations: RO,
  },
] as const;

/** Run explain_screen / where_is (pure). */
export function runScreenTool(ctx: HowtoCtx, name: string, args: Record<string, unknown>): HowtoOutcome | null {
  if (name === "explain_screen") return explainScreen(ctx, args);
  if (name === "where_is") return whereIsTool(ctx, args);
  return null;
}
