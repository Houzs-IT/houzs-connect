// Honesty helpers for the AI Connector's help data (src/lib/mcp/howto*.ts):
// every page path a guide names must be a page in src/app (route groups
// dropped, [id] = :id), every UI label it quotes must exist in src/ outside
// the help data itself, and every page gate must match the requireModule /
// requireAdmin guard in src/app. Plain Node, used by scripts/smoke-mcp-howto.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../..");
const SRC = path.join(REPO, "src");
const APP = path.join(SRC, "app");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** The help data itself never counts as evidence for a label. */
const isHelpData = (f) => /[\\/]lib[\\/]mcp[\\/]howto/.test(f);

let corpusCache = null;
const labelCache = new Map();

/** All src/ source except the help data: raw, whitespace-collapsed and JSX-tightened. */
export function corpus() {
  if (corpusCache) return corpusCache;
  const raw = walk(SRC, []).filter((f) => !isHelpData(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const collapsed = raw.replace(/\s+/g, " ");
  const jsxText = collapsed.replace(/>\s+/g, ">").replace(/\s+</g, "<");
  corpusCache = { raw, collapsed, jsxText };
  return corpusCache;
}

/** Does this UI label appear somewhere in src/ (outside the help data)? */
export function labelInSource(label) {
  const l = String(label).replace(/\s+/g, " ").trim();
  if (!l) return false;
  if (labelCache.has(l)) return labelCache.get(l);
  const c = corpus();
  const hit = c.raw.includes(l) || c.collapsed.includes(l) || c.jsxText.includes(l);
  labelCache.set(l, hit);
  return hit;
}

/** "src/app/(app)/settings/(center)/team/page.tsx" -> "/settings/team"; [id] -> :id. */
function routeOfFile(file) {
  const rel = path.relative(APP, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + rel.map((s) => (s.startsWith("[") ? `:${s.replace(/^\[+\.{0,3}|\]+$/g, "")}` : s)).join("/");
}

let routesCache = null;

/** Every page route in src/app (page.tsx files). */
export function appRoutes() {
  if (routesCache) return routesCache;
  routesCache = walk(APP, []).filter((f) => /[\\/]page\.tsx$/.test(f)).map(routeOfFile);
  return routesCache;
}

/** Does the page (path, optional ?query) resolve to a page route? A `:param` segment matches anything. */
export function routeExists(page) {
  const p = String(page).split("?")[0].split("#")[0];
  const segs = p.split("/");
  return appRoutes().some((r) => {
    const rs = r.split("/");
    return rs.length === segs.length && rs.every((s, i) => s.startsWith(":") || segs[i].startsWith(":") || s === segs[i]);
  });
}

/** The double-quoted UI labels in a sentence. */
export function quotedLabels(text) {
  return [...String(text).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * The guard on each guarded page: requireModule("x") / requireAdmin() in its own page.tsx or in a
 * layout.tsx above it (route groups included). Returns route -> { module?, admin? }.
 */
export function appGuards() {
  const guardOf = (file) => {
    const src = fs.readFileSync(file, "utf8");
    const g = {};
    const m = /requireModule\("([a-z]+)"\)/.exec(src);
    if (m) g.module = m[1];
    if (/\brequireAdmin\(\)/.test(src) && !/function requireAdmin/.test(src)) g.admin = true;
    return g;
  };
  const out = {};
  for (const page of walk(APP, []).filter((f) => /[\\/]page\.tsx$/.test(f))) {
    const g = {};
    for (let dir = path.dirname(page); dir.startsWith(APP); dir = path.dirname(dir)) {
      for (const name of ["layout.tsx", "page.tsx"]) {
        const f = path.join(dir, name);
        if (name === "page.tsx" && f !== page) continue;
        if (fs.existsSync(f)) Object.assign(g, { ...guardOf(f), ...g });
      }
      if (dir === APP) break;
    }
    out[routeOfFile(page)] = g;
  }
  return out;
}

/** Read a repo file (relative to the repo root), or null. */
export function readRepoFile(rel) {
  const p = path.join(REPO, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") : null;
}

/** Does a repo file exist? */
export const repoFileExists = (rel) => fs.existsSync(path.join(REPO, rel));

/** Size in bytes of a repo file (0 when missing). */
export const repoFileSize = (rel) => (fs.existsSync(path.join(REPO, rel)) ? fs.statSync(path.join(REPO, rel)).size : 0);
