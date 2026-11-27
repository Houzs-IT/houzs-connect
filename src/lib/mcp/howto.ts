// ---------------------------------------------------------------------------
// AI Connector round 5: process help (owner 2026-11-27). Claude only — there is
// no "?" button inside Connect.
//
//   how_to           step-by-step SOPs (tasks and click-by-click flows) with
//                    ?highlight= links; canDo per person (howto-types.ts)
//   module_overview  what an area of Connect is for
//   glossary         24-hour window, template, HSM, assignment, department ...
//   explain_error    meaning + fix of a real Connect error message
//   onboarding       a first-week path per role
//
// Pure: no reads, no writes. server.ts logs every call; a question no guide
// answers is logged with note NO_GUIDE_NOTE and listed on Settings → AI
// Connector ("Questions with no guide yet"). Chat-content guides are shown to
// supervisors and admins only (round3.moodScanAllowed), like the chat tools.
// ---------------------------------------------------------------------------
import { HOWTO_GUIDES } from "./howto-guides";
import { ERRORS, GLOSSARY, MODULES, ONBOARDING } from "./howto-ref";
import { blockedNote, canDoGuide, canOpenPage, connectLink, guideVisible, stepShotPage, type HowtoGuide, type Viewer } from "./howto-types";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
/** What a help tool hands back to server.ts: the result and the mcp_calls fields. */
export type HowtoOutcome = { result: ToolResult; status: number; note: string; target: string };
/** The person and the web origin links are built on. */
export type HowtoCtx = { viewer: Viewer; origin: string; hasShot?: (page: string, highlight: string | null) => boolean };

/** The mcp_calls note on a question no guide answers; the admin page lists these. */
export const NO_GUIDE_NOTE = "no-guide";

const STOP = new Set([
  "how", "to", "do", "does", "i", "a", "an", "the", "in", "on", "for", "of", "my", "me", "is", "are", "what", "where", "can", "we", "you", "and", "or",
  "with", "connect", "houzs", "app", "please", "help", "want", "need", "it", "this", "that", "be", "get", "should", "who", "when", "which", "macam", "mana",
  "cara", "saya", "nak", "untuk", "dan", "yang", "boleh", "open", "find", "page", "screen", "button", "go", "locate", "located",
]);

const norm = (s: string): string => s.normalize("NFKC").toLowerCase();

/** The latin words (stop words dropped) and the CJK runs of a question. */
export function queryTerms(q: string): { words: string[]; cjk: string[]; text: string } {
  const text = norm(q);
  const words = (text.match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2 && !STOP.has(w));
  const cjk = text.match(/[㐀-鿿]+/g) ?? [];
  return { words, cjk, text };
}

type Rankable = { id: string; title: string; keywords: readonly string[] };
const wordsOf = (s: string): string[] => norm(s).match(/[a-z0-9]+/g) ?? [];

/** Keyword / title score: whole keyword phrases count most (the best one fully, the rest a quarter), then shared title words. */
export function scoreItem(item: Rankable, q: ReturnType<typeof queryTerms>): number {
  if (!q.words.length && !q.cjk.length) return 0;
  const qWords = new Set(q.words);
  const padded = ` ${(q.text.match(/[a-z0-9㐀-鿿]+/g) ?? []).join(" ")} `;
  const hits: number[] = [];
  for (const raw of item.keywords) {
    const k = norm(raw);
    if (/[㐀-鿿]/.test(k)) {
      if (q.text.includes(k)) hits.push(4 + k.length);
      continue;
    }
    const kw = wordsOf(k);
    if (kw.length && padded.includes(` ${kw.join(" ")} `)) hits.push(3 + kw.length * 2);
    else hits.push(kw.filter((w) => qWords.has(w)).length * 0.75);
  }
  const best = hits.length ? Math.max(...hits) : 0;
  let score = best + 0.25 * (hits.reduce((a, b) => a + b, 0) - best);
  const titleWords = new Set(wordsOf(item.title));
  for (const w of qWords) if (titleWords.has(w)) score += 2;
  if (qWords.has(norm(item.id))) score += 50;
  return score;
}

/** Items ranked best first, zero scores dropped. */
export function rank<T extends Rankable>(items: readonly T[], question: string): { item: T; score: number }[] {
  const q = queryTerms(question);
  return items
    .map((item) => ({ item, score: scoreItem(item, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** A question with emails, phone-like and other long digit runs removed, cut to 80 characters, for the no-guide log. */
export function redactQuestion(q: string): string {
  return q
    .replace(/[^\s@]+@[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{5,}\d/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const answer = (v: unknown, target: string, note = ""): HowtoOutcome => ({ result: text(JSON.stringify(v)), status: 200, note, target });
const str = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 300) : "");

/** The guides this person may be shown (chat-content guides only to supervisors and admins). */
export function guidesFor(v: Viewer): HowtoGuide[] {
  return HOWTO_GUIDES.filter((g) => guideVisible(g, v));
}

/** One guide as the tool returns it: links built (with ?highlight=), canDo for this person. */
export function guideView(g: HowtoGuide, ctx: HowtoCtx) {
  const canDo = canDoGuide(g, ctx.viewer);
  const { steps, explainOnly, ...rest } = g;
  delete rest.needs; // internal: the gate behind canDo
  delete rest.supervisorOnly; // internal: who is shown the guide
  return {
    ...rest,
    ...(explainOnly ? { explainOnly: true, aiWillNot: "The AI Connector only explains this; it never creates, approves or sends it." } : {}),
    link: connectLink(ctx.origin, g.page, null),
    yourCompany: ctx.viewer.company || null,
    canDo,
    ...(canDo ? {} : { note: blockedNote(g, ctx.viewer) }),
    steps: steps.map((s, i) => ({
      n: i + 1,
      ...(s.role ? { role: s.role } : {}),
      text: s.text,
      ...(s.page ? { link: connectLink(ctx.origin, s.page, s.highlight) ?? s.page } : {}),
      ...(s.highlight ? { press: s.highlight } : {}),
      ...(s.highlight && ctx.hasShot?.(stepShotPage(g.page, s) ?? "", s.highlight) ? { showMe: { guide_id: g.id, step: i + 1 } } : {}),
    })),
  };
}

const moduleOpen = (m: (typeof MODULES)[number], v: Viewer): boolean => m.keyPages.some((p) => canOpenPage(p.path, v));

function howTo(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const guides = guidesFor(ctx.viewer);
  const byId = new Map(guides.map((g) => [g.id, g]));
  const topic = str(args.topic);
  const question = str(args.question);
  const exact = topic ? byId.get(topic) : undefined;
  if (exact) return answer({ guides: [guideView(exact, ctx)] }, `how_to ${exact.id}`);
  const asked = [question, topic].filter(Boolean).join(" ");
  const hits = rank(guides, asked);
  if (!hits.length) {
    const list = guides.map((g) => ({ id: g.id, title: g.title, kind: g.kind, audience: g.audience }));
    return answer({ matched: false, message: "No guide matches that question yet. These are the guides there are:", guides: list }, asked ? redactQuestion(asked) : "how_to (empty)", asked ? NO_GUIDE_NOTE : "");
  }
  const top = hits[0].score;
  const full = hits.filter((h, i) => i === 0 || h.score >= top * 0.8).slice(0, 3);
  const more = hits.filter((h) => !full.includes(h)).slice(0, 4).map((h) => ({ id: h.item.id, title: h.item.title }));
  return answer(
    { guides: full.map((h) => guideView(h.item, ctx)), ...(more.length ? { alsoSee: more } : {}), tip: "Call how_to with topic = an id for another guide." },
    `how_to ${full.map((h) => h.item.id).join(",")}`,
  );
}

function moduleOverview(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const asked = str(args.module);
  if (!asked) return answer({ modules: MODULES.map((m) => ({ id: m.id, name: m.name, sidebar: m.sidebar, purpose: m.purpose.split(/(?<=\.)\s/)[0], canOpen: moduleOpen(m, ctx.viewer) })) }, "module_overview (list)");
  const exact = MODULES.find((m) => m.id === norm(asked) || norm(m.name) === norm(asked) || norm(m.sidebar) === norm(asked));
  const hits = exact ? [exact] : rank(MODULES.map((m) => ({ ...m, title: `${m.name} ${m.sidebar}` })), asked).slice(0, 2).map((h) => MODULES.find((m) => m.id === h.item.id) ?? h.item);
  if (!hits.length) return answer({ matched: false, message: "No module by that name. These are the modules:", modules: MODULES.map((m) => ({ id: m.id, name: m.name })) }, redactQuestion(asked), NO_GUIDE_NOTE);
  return answer(
    {
      modules: hits.map((m) => {
        const canOpen = moduleOpen(m, ctx.viewer);
        const { keyPages, ...rest } = m;
        return { ...rest, canOpen, ...(canOpen ? {} : { note: blockedNote({ page: keyPages[0]?.path ?? "/" }, ctx.viewer) }), keyPages: keyPages.map((p) => ({ ...p, link: connectLink(ctx.origin, p.path, null) ?? p.path })) };
      }),
    },
    `module_overview ${hits.map((m) => m.id).join(",")}`,
  );
}

function glossary(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const asked = str(args.term);
  if (!asked) return answer({ terms: GLOSSARY.map((t) => t.term) }, "glossary (list)");
  const exact = GLOSSARY.filter((t) => norm(t.term) === norm(asked) || t.aliases.some((a) => norm(a) === norm(asked)));
  const hits = exact.length ? exact : rank(GLOSSARY.map((t) => ({ ...t, id: t.term, title: [t.term, ...t.aliases].join(" "), keywords: [t.term, ...t.aliases, ...t.keywords] })), asked).slice(0, 3).map((h) => h.item);
  if (!hits.length) return answer({ matched: false, message: "That term is not in the glossary yet. Known terms:", terms: GLOSSARY.map((t) => t.term) }, redactQuestion(asked), NO_GUIDE_NOTE);
  return answer(
    { terms: hits.map((t) => ({ term: t.term, aliases: t.aliases, definition: t.definition, seeAlso: t.seeAlso, ...(t.page && canOpenPage(t.page, ctx.viewer) ? { link: connectLink(ctx.origin, t.page, null) } : {}) })) },
    `glossary ${hits.map((t) => t.term).join(",")}`,
  );
}

/** The error entries whose app text appears in what the person pasted, longest match first; then a word-overlap fallback. */
export function matchErrors(pasted: string, pool: readonly (typeof ERRORS)[number][] = ERRORS) {
  const t = norm(pasted);
  const direct = pool
    .map((e) => ({ e, len: Math.max(0, ...e.match.map((m) => (t.includes(norm(m)) ? m.length : 0))) }))
    .filter((x) => x.len > 0)
    .sort((a, b) => b.len - a.len)
    .map((x) => x.e);
  if (direct.length) return direct.slice(0, 2);
  const words = new Set(queryTerms(pasted).words);
  return pool
    .map((e) => {
      const best = Math.max(
        ...e.match.map((m) => {
          const mw = wordsOf(m).filter((w) => !STOP.has(w));
          return mw.length ? mw.filter((w) => words.has(w)).length / mw.length : 0;
        }),
      );
      return { e, best };
    })
    .filter((x) => x.best >= 0.6)
    .sort((a, b) => b.best - a.best)
    .slice(0, 2)
    .map((x) => x.e);
}

function explainError(_ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const pasted = str(args.text);
  if (!pasted) return { result: text("Paste the error message text (exactly as Houzs Connect shows it).", true), status: 400, note: "", target: "explain_error" };
  const hits = matchErrors(pasted);
  if (!hits.length) return answer({ matched: false, message: "This message is not in the error guide yet. Read it to the person in plain words; if it blocks them, ask them to send a screenshot to IT Support." }, redactQuestion(pasted), NO_GUIDE_NOTE);
  return answer({ errors: hits.map(({ id, module, meaning, cause, fix }) => ({ id, module, meaning, cause, fix })) }, `explain_error ${hits.map((e) => e.id).join(",")}`);
}

function onboarding(ctx: HowtoCtx, args: Record<string, unknown>): HowtoOutcome {
  const guides = new Map(guidesFor(ctx.viewer).map((g) => [g.id, g]));
  const asked = str(args.role);
  if (!asked) return answer({ roles: ONBOARDING.map((o) => ({ role: o.role, title: o.title })) }, "onboarding (list)");
  const exact = ONBOARDING.find((o) => o.role === norm(asked));
  const ranked = rank(ONBOARDING.map((o) => ({ ...o, id: o.role, keywords: [o.role, ...o.keywords] })), asked);
  const hit = exact ?? (ranked.length ? ranked[0].item : undefined);
  if (!hit) return answer({ matched: false, message: "No first-week path for that role. Roles:", roles: ONBOARDING.map((o) => o.role) }, redactQuestion(asked), NO_GUIDE_NOTE);
  return answer(
    {
      role: hit.role,
      title: hit.title,
      contact: hit.contact,
      days: hit.days.map((d) => ({
        day: d.day,
        goals: d.goals,
        guides: d.guides
          .filter((id) => guides.has(id))
          .map((id) => {
            const g = guides.get(id) as HowtoGuide;
            return { id, title: g.title, canDo: canDoGuide(g, ctx.viewer) };
          }),
        pages: d.pages.map((p) => connectLink(ctx.origin, p, null) ?? p),
      })),
      tip: "Call how_to with topic = a guide id for its full steps.",
    },
    `onboarding ${hit.role}`,
  );
}

const RO = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

/** The help tools (no Connect data read; canDo comes from the person's own Connect access). */
export const HOWTO_TOOLS = [
  {
    name: "how_to",
    title: "How do I ... (step-by-step Houzs Connect guide)",
    description:
      "Step-by-step SOP for doing something in Houzs Connect (reply to a customer and the 24-hour window, send a template, start a new conversation, assign / transfer, resolve / pending / queue, private notes, contact Remarks, find a conversation, contacts, quick replies, queue and overdue chats, the reply-speed dashboard, chat review, campaigns and broadcasts (explained only), templates, departments, users and roles, module access, the AI Connector page, the morning brief) and whole chains written click by click. Returns the top 1-3 guides: purpose, prerequisites, fields, click-by-click steps with links that highlight the button to press, checks, warnings, undo, common mistakes and canDo for this person. Guides are English; translate for the person.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The person's question in their own words (any language)" },
        topic: { type: "string", description: "A guide id from an earlier answer" },
      },
      additionalProperties: false,
    },
    annotations: RO,
  },
  {
    name: "module_overview",
    title: "What a Houzs Connect area is for",
    description: "What an area of Houzs Connect is for (Service, Contacts, Dashboard, Campaigns, Templates, Settings, AI Connector), its key pages with links, who uses it and how it connects to the others. Leave out module for the list.",
    inputSchema: { type: "object", properties: { module: { type: "string", description: "Area or menu label, e.g. Service, Contacts, Templates" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "glossary",
    title: "What does this Connect term mean",
    description: "Plain-English meaning of a term used in Houzs Connect (24-hour window, template, HSM, assignment, unassigned, department, resolved, pending, queue, reply SLA, first reply, private note, Remarks, quick reply, opt-in, blocked, module, role, AI actions, morning brief ...). Leave out term for the list.",
    inputSchema: { type: "object", properties: { term: { type: "string" } }, additionalProperties: false },
    annotations: RO,
  },
  {
    name: "explain_error",
    title: "Explain a Houzs Connect error message",
    description: "The meaning, cause and fix of an error Houzs Connect showed (e.g. \"The 24-hour reply window is closed\", \"Could not start the conversation: blocked\", \"Not available to your role\"). Pass the message text exactly as shown (read it off a screenshot if needed).",
    inputSchema: { type: "object", properties: { text: { type: "string", description: "The error text" } }, required: ["text"], additionalProperties: false },
    annotations: RO,
  },
  {
    name: "onboarding",
    title: "First-week path for a new person",
    description: "A day-by-day first-week learning path for a role (agent, supervisor, admin) with the guides and pages to practise. Leave out role for the list.",
    inputSchema: { type: "object", properties: { role: { type: "string" } }, additionalProperties: false },
    annotations: RO,
  },
] as const;

const NAMES = new Set<string>(HOWTO_TOOLS.map((t) => t.name));
/** Is this one of the help tools? */
export const isHowtoTool = (name: string): boolean => NAMES.has(name);

/** Run a help tool. Pure: no reads, no writes; server.ts logs the outcome. */
export function runHowtoTool(ctx: HowtoCtx, name: string, args: Record<string, unknown>): HowtoOutcome {
  switch (name) {
    case "how_to":
      return howTo(ctx, args);
    case "module_overview":
      return moduleOverview(ctx, args);
    case "glossary":
      return glossary(ctx, args);
    case "explain_error":
      return explainError(ctx, args);
    case "onboarding":
      return onboarding(ctx, args);
    default:
      return { result: text(`Unknown tool: ${name}`, true), status: 400, note: "", target: name };
  }
}

/** The help part of the server instructions. */
export const HOWTO_INSTRUCTIONS = `HELP (no Connect data, always available): "how do I / where do I / steps to ..." -> how_to {question}; give the steps in the person's language, keep the quoted button names in English as the screen shows them, and give each step's link (it highlights the button). If canDo is false, say what the note says. A step with showMe has a screenshot: call show_me {guide_id, step} when the person wants to see where to click. A guide with explainOnly is explained only — never offer to do it. Never invent a rule. "What is X for" -> module_overview; "what does X mean" -> glossary; an error message -> explain_error {text}; someone new -> onboarding {role}; "what is this screen" -> explain_screen {path | labels}; "where do I find X" -> where_is {thing}.`;

/** Ready-made prompts for the help tools. */
export const HOWTO_PROMPTS = [
  { name: "how_do_i", title: "How do I ...", description: "Step-by-step guide for a Houzs Connect task. Uses how_to.", arguments: [{ name: "task", description: "What you want to do, e.g. send a template", required: true }] },
  { name: "what_does_it_mean", title: "What does this term mean", description: "Plain meaning of a Connect term. Uses glossary.", arguments: [{ name: "term", description: "The term, e.g. 24-hour window", required: true }] },
  { name: "explain_this_error", title: "Explain this error", description: "What a Houzs Connect error means and how to fix it. Uses explain_error.", arguments: [{ name: "error", description: "The error text", required: true }] },
  { name: "my_first_week", title: "My first week", description: "A first-week learning path for a role. Uses onboarding.", arguments: [{ name: "role", description: "agent, supervisor or admin", required: false }] },
] as const;

/** The tool each help prompt relies on. */
export const HOWTO_PROMPT_TOOL: Record<string, string> = { how_do_i: "how_to", what_does_it_mean: "glossary", explain_this_error: "explain_error", my_first_week: "onboarding" };

/** The message for a help prompt, or null for a name that is not one. */
export function howtoPromptText(name: string, a: Record<string, unknown>): string | null {
  const v = (k: string) => (typeof a[k] === "string" ? (a[k] as string).trim().slice(0, 200) : "");
  const close = " Answer in my language, keep button names as the screen shows them, and give the links.";
  switch (name) {
    case "how_do_i":
      return `How do I ${v("task") || "do this"}? Call how_to {question: "${v("task")}"} and walk me through it step by step, with what to fill, what to check before and what happens after.${close}`;
    case "what_does_it_mean":
      return `What does "${v("term")}" mean? Call glossary {term: "${v("term")}"}.${close}`;
    case "explain_this_error":
      return `I got this error: "${v("error")}". Call explain_error {text} and tell me what it means, why it happened and how to fix it.${close}`;
    case "my_first_week":
      return `I am new. Call onboarding${v("role") ? ` {role: "${v("role")}"}` : ""} and give me my first-week plan, day by day.${close}`;
    default:
      return null;
  }
}
