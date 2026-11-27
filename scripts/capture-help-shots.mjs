#!/usr/bin/env node
/**
 * capture-help-shots.mjs — screenshots for the AI Connector's show_me tool (round 5b).
 *
 * Connect renders on the server, so its data comes from Postgres, not from browser
 * requests. This script therefore runs everything locally and throws it away:
 *   1. a throwaway Postgres cluster (initdb, trust auth, localhost only) in .verify/
 *   2. the app's migrations, then scripts/help-shots-demo.ts — invented demo data
 *      only (names "(demo)", phones 60100000xxx, example.com emails)
 *   3. a temporary .dev.vars (that local DB, a random SESSION_SECRET, WHATSAPP_MODE=DEMO)
 *      — refused if you already have a .dev.vars, removed afterwards
 *   4. `next dev` on a spare port, signed in as the demo Super Admin with a locally
 *      minted session cookie (no ERP, no password)
 *   5. Playwright: every request to a host other than localhost is aborted.
 * For each page of the screen map and each how-to step it finds every label with
 * the SAME matcher the ?highlight= helper uses (src/lib/highlight-match.ts), saves a
 * WebP (public/help-shots/<slug>.webp, 1200 px wide) and writes the boxes to
 * src/lib/mcp/howto-shots-data.ts.
 *
 * Usage:  node scripts/capture-help-shots.mjs            (all pages)
 *         node scripts/capture-help-shots.mjs /inbox      (only these)
 * Needs:  PostgreSQL binaries (PG_BIN, default C:/Program Files/PostgreSQL/17/bin on Windows,
 *         else from PATH) and the capture tools, which are not app dependencies:
 *           npm install --prefix .verify/tools --no-save playwright sharp esbuild
 *         CHROME=<chrome / chrome-headless-shell path> if Playwright's own browser is not installed.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verify = path.join(repo, ".verify");
const toolsDir = process.env.HELP_SHOTS_TOOLS ?? path.join(verify, "tools");
const req = createRequire(path.join(toolsDir, "package.json"));
let chromium, sharp, esbuild;
try {
  ({ chromium } = req("playwright"));
  sharp = req("sharp");
  esbuild = req("esbuild");
} catch (e) {
  console.error(`Missing a capture tool. Run: npm install --prefix .verify/tools --no-save playwright sharp esbuild\n${e.message}`);
  process.exit(1);
}

const PG_PORT = Number(process.env.HELP_SHOTS_PG_PORT ?? 55434);
const WEB_PORT = Number(process.env.HELP_SHOTS_PORT ?? 5299);
const BASE = `http://localhost:${WEB_PORT}`;
const DB_URL = `postgres://postgres@localhost:${PG_PORT}/postgres?sslmode=disable`;
const VIEW = { width: 1440, height: 900 };
// The shell is one screen tall (h-dvh) with inner scrolling, so a long page is photographed in a
// taller window instead of a full-page screenshot.
const TALL = { "/settings/ai-connector": 2700, "/settings/team": 1500, "/settings/access": 1500, "/dashboard?tab=support": 1500, "/dashboard": 1300 };
const OUT_W = 1200;
const QUALITY = 55;
const SHOT_DIR = path.join(repo, "public", "help-shots");
const DATA_TS = path.join(repo, "src", "lib", "mcp", "howto-shots-data.ts");
const DEV_VARS = path.join(repo, ".dev.vars");
const MARK = "# help-shots temporary file — removed by scripts/capture-help-shots.mjs";
const pgBin = process.env.PG_BIN ?? (process.platform === "win32" ? "C:/Program Files/PostgreSQL/17/bin" : "");
const bin = (n) => (pgBin ? path.join(pgBin, process.platform === "win32" ? `${n}.exe` : n) : n);

fs.mkdirSync(verify, { recursive: true });
const tmp = fs.mkdtempSync(path.join(verify, "help-shots-"));
const pgData = path.join(tmp, "pgdata");
const only = process.argv.slice(2).filter((a) => a.startsWith("/"));
const slug = (p) => (p.replace(/^\//, "").replace(/:id/g, "conversation").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "home").slice(0, 80);

if (fs.existsSync(DEV_VARS) && !fs.readFileSync(DEV_VARS, "utf8").startsWith(MARK)) {
  console.error("A .dev.vars already exists (your own settings). Move it aside for the capture; this script never overwrites it.");
  process.exit(1);
}

let dev = null;
let pgStarted = false;
function cleanup() {
  if (dev?.pid) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
    else dev.kill("SIGTERM");
  }
  if (pgStarted) spawnSync(bin("pg_ctl"), ["-D", pgData, "-m", "fast", "stop"], { stdio: "ignore" });
  if (fs.existsSync(DEV_VARS) && fs.readFileSync(DEV_VARS, "utf8").startsWith(MARK)) fs.rmSync(DEV_VARS);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: repo, env: { ...process.env, ...env }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.join(" ")} failed:\n${(r.stderr || r.stdout || "").slice(-2000)}`);
  return r.stdout;
};
const tsx = (script) => run(process.execPath, [path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"), script], { DATABASE_URL: DB_URL, WHATSAPP_MODE: "DEMO" });

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} did not come up`);
}

async function main() {
  // 1-2. Throwaway database with demo data only.
  run(bin("initdb"), ["-D", pgData, "-U", "postgres", "-A", "trust", "-E", "UTF8"]);
  // stdio ignored: the server pg_ctl starts inherits its handles, and a captured pipe would never close.
  const started = spawnSync(bin("pg_ctl"), ["-D", pgData, "-o", `-p ${PG_PORT} -c listen_addresses=localhost`, "-l", path.join(tmp, "pg.log"), "-w", "start"], { stdio: "ignore" });
  if (started.status !== 0) throw new Error(`pg_ctl start failed (see ${path.join(tmp, "pg.log")})`);
  pgStarted = true;
  tsx("scripts/db-migrate.ts");
  const seeded = JSON.parse(tsx("scripts/help-shots-demo.ts").trim().split("\n").pop());

  // 3-4. Dev server against it, signed in as the demo Super Admin.
  const secret = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(DEV_VARS, `${MARK}\nDATABASE_URL="${DB_URL}"\nSESSION_SECRET="${secret}"\nWHATSAPP_MODE="DEMO"\n`);
  dev = spawn(process.execPath, [path.join(repo, "node_modules", "next", "dist", "bin", "next"), "dev", "-p", String(WEB_PORT)], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  const devLog = fs.createWriteStream(path.join(tmp, "dev.log"));
  dev.stdout.pipe(devLog);
  dev.stderr.pipe(devLog);
  await waitFor(`${BASE}/login`, 180_000);
  const payload = `${seeded.adminId}.${Date.now() + 3 * 3600_000}`;
  const session = `${payload}.${crypto.createHmac("sha256", secret).update(payload).digest("base64url")}`;

  // The matcher, bundled for the page; the targets, from the help data itself.
  const matcher = await esbuild.build({ entryPoints: [path.join(repo, "src", "lib", "highlight-match.ts")], bundle: true, format: "iife", globalName: "HM", write: false, logLevel: "silent" });
  const targetsTs = path.join(repo, "scripts", `.help-shot-targets-${process.pid}.ts`);
  fs.writeFileSync(targetsTs, ['import { helpShotTargets } from "../src/lib/mcp/howto-shots";', "console.log(JSON.stringify(helpShotTargets()));", ""].join("\n"));
  let allTargets;
  try {
    allTargets = JSON.parse(tsx(targetsTs).trim().split("\n").pop());
  } finally {
    fs.rmSync(targetsTs, { force: true });
  }
  const targets = allTargets.filter((t) => !only.length || only.includes(t.page));

  // 5. Browser: localhost only.
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, locale: "en-GB", timezoneId: "Asia/Kuala_Lumpur" });
  await ctx.addCookies([{ name: "hc_session", value: session, domain: "localhost", path: "/" }]);
  let blocked = 0;
  await ctx.route("**/*", (r) => {
    if (new URL(r.request().url()).hostname === "localhost") return r.continue();
    blocked++;
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const oldSrc = fs.existsSync(DATA_TS) ? fs.readFileSync(DATA_TS, "utf8") : "";
  let old = {};
  try {
    old = JSON.parse(oldSrc.slice(oldSrc.indexOf("= {") + 2).replace(/;\s*$/, "")).shots ?? {};
  } catch {
    old = {}; // the empty stub, or a hand-edited file: start fresh
  }
  const shots = only.length ? { ...old } : {};
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const scale = OUT_W / VIEW.width;
  for (const t of targets) {
    await page.setViewportSize({ width: VIEW.width, height: TALL[t.page] ?? VIEW.height });
    if (t.page === "/inbox/:id") {
      await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle", timeout: 180_000 });
      await page.getByText("Aisha (demo)", { exact: true }).first().click();
      await page.waitForURL(/\/inbox\/[^/?]+/, { timeout: 60_000 });
    } else {
      await page.goto(`${BASE}${t.page}`, { waitUntil: "networkidle", timeout: 180_000 });
    }
    await page.waitForTimeout(1500);
    await page.addScriptTag({ content: matcher.outputFiles[0].text });
    const boxes = await page.evaluate((labels) => {
      const out = {};
      for (const l of labels) {
        const el = window.HM.findHighlightTarget(document, l);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) continue;
        out[l] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
      }
      return out;
    }, t.labels);
    // The Next.js dev-tools badge is not part of Connect.
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    const png = await page.screenshot({ type: "png" });
    const file = `${slug(t.page)}.webp`;
    const img = await sharp(png).resize({ width: OUT_W }).webp({ quality: QUALITY }).toBuffer();
    fs.writeFileSync(path.join(SHOT_DIR, file), img);
    const meta = await sharp(img).metadata();
    const scaled = Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.map((v) => Math.round(v * scale))]));
    shots[t.page] = { file, w: meta.width, h: meta.height, boxes: scaled };
    const missing = t.labels.filter((l) => !boxes[l]);
    console.log(`${t.page}: ${Object.keys(boxes).length}/${t.labels.length} boxed, ${Math.round(img.length / 1024)} KB${missing.length ? ` — not on screen: ${missing.join(", ")}` : ""}`);
  }
  await browser.close();

  const sorted = Object.fromEntries(Object.keys(shots).sort().map((k) => [k, shots[k]]));
  fs.writeFileSync(
    DATA_TS,
    `// GENERATED by scripts/capture-help-shots.mjs — do not edit by hand.\n// Boxes are [x, y, width, height] in the WebP's pixels (public/help-shots/<file>).\nimport type { Shot } from "./howto-shots";\n\nexport const HELP_SHOTS_DATA: { capturedAt: string | null; shots: Record<string, Shot> } = ${JSON.stringify({ capturedAt: new Date().toISOString().slice(0, 10), shots: sorted }, null, 2)};\n`,
  );
  console.log(`Done: ${Object.keys(sorted).length} pages, ${blocked} outside requests blocked${errors.length ? `, ${errors.length} page errors (first: ${errors[0].slice(0, 120)})` : ""}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(cleanup);
