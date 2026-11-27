// ---------------------------------------------------------------------------
// AI Connector round 5b: show_me — a picture of the real Connect screen showing
// where to click. The tool returns the plain WebP screenshot (an image content
// block, never SVG) with the button's box, a 15-minute link to the same picture
// with a red box and an arrow drawn over it (HTML + CSS, /api/mcp/shot), and the
// live page link that outlines the button (?highlight=).
//
// Screenshots: public/help-shots/*.webp, boxes in howto-shots-data.ts — both
// written by scripts/capture-help-shots.mjs from the LOCAL dev server, on a
// throwaway local Postgres holding only invented demo data. No real customer,
// staff member, phone number or message is ever in a picture.
// ---------------------------------------------------------------------------
import { HELP_SHOTS_DATA } from "./howto-shots-data";
import { HOWTO_GUIDES } from "./howto-guides";
import { guidesFor } from "./howto";
import { canOpenPage, connectLink, stepShotPage, type Viewer } from "./howto-types";
export { stepShotPage };
import { SCREENS, screenForPath, whereIs } from "./howto-screen";

export type Box = [number, number, number, number];
export type Shot = { file: string; w: number; h: number; boxes: Record<string, Box> };

/** The captured screenshots, keyed by page path ("/inbox/:id" = an open conversation). */
export const SHOTS: Record<string, Shot> = HELP_SHOTS_DATA.shots;
export const SHOT_NOTE = "This screenshot uses test data, so names and numbers differ from yours; the layout and the buttons are the same.";
export const SHOT_LINK_MINUTES = 15;

export type ShotHit = { page: string; label: string; shot: Shot; box: Box };

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const shotOf = (page: string): Shot | null => (Object.prototype.hasOwnProperty.call(SHOTS, page) ? SHOTS[page] : null);

/** The box of a label on a page's screenshot, or null. */
export function boxOn(page: string, label: string): ShotHit | null {
  const shot = shotOf(page);
  if (!shot) return null;
  const key = Object.keys(shot.boxes).find((k) => norm(k) === norm(label));
  return key ? { page, label: key, shot, box: shot.boxes[key] } : null;
}

/**
 * The box of a label on a page, or — for a Service list page whose button only exists inside an open
 * conversation (Reply, Resolve …) — on the open-conversation picture.
 */
export function boxFor(page: string, label: string): ShotHit | null {
  return boxOn(page, label) ?? (page.startsWith("/inbox") && page !== "/inbox/:id" ? boxOn("/inbox/:id", label) : null);
}

/** Is there a picture of this label on this page? (how_to / where_is offer show_me only then.) */
export const hasShot = (page: string, label: string | null): boolean => Boolean(label && boxFor(page, label));


/** Find the picture for show_me's arguments: a guide step, a page (+ label), or a label alone. Only pages this person can open. */
export function resolveShot(args: { path?: unknown; guide_id?: unknown; step?: unknown; label?: unknown }, v: Viewer): ShotHit | null {
  const pick = (hit: ShotHit | null) => (hit && canOpenPage(hit.page, v) ? hit : null);
  const label = typeof args.label === "string" ? args.label.trim().slice(0, 120) : "";
  if (typeof args.guide_id === "string" && args.guide_id) {
    const g = guidesFor(v).find((x) => x.id === args.guide_id);
    if (!g) return null;
    const n = Number(args.step);
    const steps = Number.isInteger(n) && n > 0 ? [g.steps[n - 1]].filter(Boolean) : g.steps.filter((s) => s.highlight);
    for (const s of steps) {
      const page = stepShotPage(g.page, s);
      if (page && s.highlight) {
        const hit = pick(boxFor(page, s.highlight));
        if (hit) return hit;
      }
    }
    return null;
  }
  if (typeof args.path === "string" && args.path) {
    const screen = screenForPath(args.path);
    const raw = args.path.replace(/^https?:\/\/[^/]+/i, "").replace(/[?&]highlight=[^&]*/, "");
    for (const p of [raw, screen?.path ?? "", raw.split("?")[0]].filter(Boolean)) {
      const shot = shotOf(p);
      if (!shot) continue;
      const hit = pick(label ? boxOn(p, label) : Object.keys(shot.boxes)[0] ? boxOn(p, Object.keys(shot.boxes)[0]) : null);
      if (hit) return hit;
    }
    return null;
  }
  if (!label) return null;
  for (const w of whereIs(label)) {
    const hit = pick(boxOn(w.screen.path, w.action.label));
    if (hit) return hit;
  }
  for (const p of Object.keys(SHOTS)) {
    const hit = pick(boxOn(p, label));
    if (hit) return hit;
  }
  return null;
}

/** What show_me hands back beside the picture itself. */
export function showMeText(hit: ShotHit, origin: string, annotatedLink: string | null) {
  return {
    caption: `Press "${hit.label}"`,
    page: hit.page,
    box: { x: hit.box[0], y: hit.box[1], width: hit.box[2], height: hit.box[3], imageWidth: hit.shot.w, imageHeight: hit.shot.h },
    ...(annotatedLink ? { annotatedImage: annotatedLink, expires: `${SHOT_LINK_MINUTES} minutes`, annotatedImageShows: "the same screenshot with a red box and an arrow on the button" } : {}),
    openThePage: connectLink(origin, hit.page, hit.label) ?? "Open the conversation in Service first; the button is in its header / reply box.",
    note: SHOT_NOTE,
  };
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The annotated picture behind the 15-minute link: the WebP in an <img>, a red box and an arrow drawn
 * with CSS (percentages of the picture, so it scales on a phone), and a caption. No SVG, no script.
 */
export function annotatedHtml(hit: ShotHit, imageUrl: string): string {
  const { w, h } = hit.shot;
  const [x, y, bw, bh] = hit.box;
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
  const pad = 6;
  const above = y > 120;
  const arrowX = x + bw / 2;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(`Press "${hit.label}"`)}</title>
<style>body{margin:0;background:#111;color:#fff;font:16px/1.4 Arial,sans-serif}.wrap{max-width:${w}px;margin:0 auto}.pic{position:relative}.pic img{display:block;width:100%;height:auto}
.box{position:absolute;border:4px solid #e11d48;border-radius:8px;box-shadow:0 0 0 3px rgba(225,29,72,.25)}
.arrow{position:absolute;width:5px;background:#e11d48;transform:translateX(-50%)}.arrow:after{content:"";position:absolute;left:50%;transform:translateX(-50%);border:11px solid transparent}
.up:after{bottom:-14px;border-top:14px solid #e11d48}.down:after{top:-14px;border-bottom:14px solid #e11d48}
.cap{padding:12px 14px;background:#1f2937}.cap small{display:block;color:#9ca3af;margin-top:4px}</style></head>
<body><div class="wrap"><div class="pic"><img src="${esc(imageUrl)}" alt="${esc(`Houzs Connect screen: ${hit.page}`)}" width="${w}" height="${h}">
<div class="box" style="left:${pct(x - pad, w)};top:${pct(y - pad, h)};width:${pct(bw + pad * 2, w)};height:${pct(bh + pad * 2, h)}"></div>
<div class="arrow ${above ? "up" : "down"}" style="left:${pct(arrowX, w)};${above ? `top:${pct(Math.max(0, y - pad - 90), h)}` : `top:${pct(y + bh + pad + 14, h)}`};height:${pct(Math.min(76, above ? y - pad - 14 : h - y - bh - pad - 14), h)}"></div></div>
<div class="cap">${esc(`Press "${hit.label}"`)}<small>${esc(SHOT_NOTE)}</small></div></div></body></html>`;
}

/** The 15-minute link's signed query: page, label and expiry under HMAC-SHA256 (key: the server's SESSION_SECRET). */
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signShotLink(origin: string, hit: ShotHit, secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SHOT_LINK_MINUTES * 60_000);
  const q = new URLSearchParams({ p: hit.page, l: hit.label, e: exp });
  q.set("s", await hmacHex(secret, `${hit.page}\n${hit.label}\n${exp}`));
  return `${origin}/api/mcp/shot?${q.toString()}`;
}

/** Verify a shot link; returns the hit, or a reason it is refused. */
export async function verifyShotLink(q: URLSearchParams, secret: string, now = Date.now()): Promise<ShotHit | "expired" | "invalid"> {
  const p = q.get("p") ?? "";
  const l = q.get("l") ?? "";
  const e = q.get("e") ?? "";
  const s = q.get("s") ?? "";
  if (!p || !l || !/^\d{10,16}$/.test(e) || !/^[0-9a-f]{64}$/.test(s)) return "invalid";
  const want = await hmacHex(secret, `${p}\n${l}\n${e}`);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= want.charCodeAt(i) ^ s.charCodeAt(i);
  if (diff !== 0) return "invalid";
  if (Number(e) < now) return "expired";
  return boxOn(p, l) ?? "invalid";
}

/** One page to photograph and the labels to box on it (guide highlights and screen buttons). */
export type HelpShotTarget = { page: string; labels: string[] };

export function helpShotTargets(): HelpShotTarget[] {
  const byPage = new Map<string, Set<string>>();
  const add = (page: string | null, label: string | null) => {
    if (!page) return;
    const set = byPage.get(page) ?? new Set<string>();
    if (label) set.add(label);
    byPage.set(page, set);
  };
  const convo = SCREENS.find((x) => x.path === "/inbox/:id");
  const inConvo = new Set([...(convo?.tabs ?? []), ...(convo?.actions.map((a) => a.label) ?? [])]);
  for (const g of HOWTO_GUIDES)
    for (const s of g.steps) {
      const page = stepShotPage(g.page, s);
      // A conversation button named on a Service list step is photographed in the open conversation.
      add(page?.startsWith("/inbox") && s.highlight && inConvo.has(s.highlight) ? "/inbox/:id" : page, s.highlight);
    }
  for (const s of SCREENS) {
    add(s.path, null);
    for (const t of s.tabs) add(s.path, t);
    for (const a of s.actions) add(s.path, a.label);
  }
  return [...byPage.entries()].map(([page, labels]) => ({ page, labels: [...labels] })).filter((t) => t.labels.length);
}

export const SHOW_ME_TOOL = {
  name: "show_me",
  title: "Show me where to click (screenshot)",
  description:
    "A screenshot of the real Houzs Connect screen (WebP image) with the position of the button to press, a 15-minute link to the same picture with a red box and arrow on it, and the live-page link that highlights the button. Pass guide_id (+ step) from how_to, or path (+ label) from where_is / explain_screen, or just label. The screenshot uses test data; the layout is the same.",
  inputSchema: {
    type: "object",
    properties: {
      guide_id: { type: "string", description: "A how_to guide id" },
      step: { type: "number", description: "Step number in that guide (default: the first step with a picture)" },
      path: { type: "string", description: "Page path, e.g. /inbox or /settings/templates" },
      label: { type: "string", description: "The button / tab label, e.g. Assign" },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
} as const;
