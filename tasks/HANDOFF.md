# Houzs Connect — Handoff / current state

_Last updated: 2026-07-29_

## Drizzle + Cloudflare cutover — DONE (code), owner creds needed to deploy

Per the owner: run Connect "the Houzs way" — same Cloudflare account + same Supabase
as the ERP. The whole data layer was moved off Prisma/SQLite onto **Drizzle + postgres.js
over Hyperdrive**, and the app now deploys as a **Cloudflare Worker via OpenNext**.

**Done + verified (no creds needed):**
- `src/db/schema.ts` — full domain (23 tables) in a dedicated **`connect` pgSchema** so it
  never collides with the ERP's `public` tables. `src/db/pg.ts` is ported verbatim from the
  ERP's hard-won Hyperdrive config (prepare:false, max:1, no ssl/connect_timeout on the
  Hyperdrive branch). `src/db/client.ts` = request-scoped `getDb()` (React `cache()`),
  reads HYPERDRIVE binding (prod) or DATABASE_URL (dev) via `getCloudflareContext()`.
- All 24 Prisma call sites converted to Drizzle (relational `db.query` + core inserts/
  updates). Prisma fully removed (`@prisma/client`/`prisma` uninstalled, `src/lib/db.ts`
  + `prisma/schema.prisma` + old seed deleted; `prisma/seed-data.ts` kept).
- Cloudflare: `wrangler.toml` (account `816e457307d7fa0491c2a08a72ad5dcd`, nodejs_compat,
  assets binding, Hyperdrive binding commented until created), `open-next.config.ts`,
  `next.config.ts` (`initOpenNextCloudflareForDev`), `cloudflare-env.d.ts`.
- Migration `src/db/migrations/0000_init_connect.sql` (creates `connect` schema + enums +
  tables). Seed ported to `scripts/seed.ts` (+ `scripts/db-migrate.ts`, `scripts/_env.ts`).
- **Verified:** `tsc --noEmit` clean; `next build` clean (all routes dynamic ƒ); the
  OpenNext Worker build compiles + bundles middleware/assets/cache + traces the server
  function. It stops only at the final **Windows symlink** step (`EPERM: symlink`) — an OS
  permission limit, not a code issue. Fix: enable Windows **Developer Mode** (non-admin
  symlinks) or run the OpenNext build/deploy on **Linux CI** (recommended — matches the
  ERP's PR→CI→deploy methodology).

**Deploy runbook (needs the owner):**
1. Owner puts the COMPANY Supabase **session-pooler** URL (port 5432) into `.dev.vars` as
   `DATABASE_URL` (directly — never via chat). `.dev.vars.example` documents it.
2. `pnpm db:migrate` then `pnpm db:seed` (creates the `connect` schema + tables + demo
   data; runs locally via tsx, no symlink issue).
3. Owner authorizes Cloudflare (`wrangler login`, or a CF API token for CI).
4. `wrangler hyperdrive create houzs-connect-pg --connection-string="<same Supabase URL>"`
   → paste the printed id into `wrangler.toml` and uncomment the `[[hyperdrive]]` block.
5. Deploy: `pnpm run deploy` (on Linux CI or Windows Developer Mode). Register the Meta
   webhook later at `https://<host>/api/webhooks/whatsapp` when going LIVE.

**Design refresh (parallel track):** the current amber theme is being replaced with Houzs's
real "Ink & Petrol" brand (petrol `#16695f` + brass `#a16a2e`, IBM Plex + Noto Sans SC).
Prompt + real reference files for claudedesign are in `../houzs-design-reference/`. When
claudedesign returns `.html`, translate it into the React/Tailwind components (data layer
is now stable, so only JSX/styles change).

## Feature build-out (Phase 2b–4) — DONE ✅ (all DEMO transport)

Everything the owner listed is now built and verified end-to-end in DEMO:
- **Automation engine + visual builder** — trigger → node graph; react-flow canvas
  (add/move/connect nodes, node inspector, save); nodes incl. AI agent reply.
  - **`call_rest_api` is LIVE outbound HTTP** (`src/lib/automation/rest.ts`), no longer a
    demo no-op: vars interpolate into URL/headers/body, http(s) only, 10s timeout, and any
    failure (bad URL, refused, timeout, non-2xx) is logged on the run while the flow
    continues. Optional "save response to attribute". Covered by
    `scripts/smoke-rest-api.mjs` (loopback only — CI never calls a real endpoint).
    NOTE: enabling a migrated Seampify flow therefore makes REAL POSTs to the owner's
    Google Apps Script `/exec` endpoints (that is the intent — it is how the Sheet is
    written — but it is a real side effect the moment a flow is switched on).
- **Payments — receipt OCR → auto-record** (`src/lib/ocr.ts` + `handleReceipt`):
  customer sends a slip → OCR parses amount/ref/method → Payment (auto-VERIFIED when it
  matches the order total, else PENDING) → `/payments` review. LIVE: swap OCR for a
  vision provider.
- **Campaigns** — broadcast to all / by-tag with merge vars; list + sent stats.
- **WhatsApp Forms** — Form + FormResponse tables; builder + publish + response capture
  onto contact attributes. LIVE: Meta WhatsApp Flows.
- **AI agent** — `src/lib/ai.ts` pluggable reply generator (DEMO rule-based) + engine
  `ai_agent_reply` node. LIVE: swap in an LLM call.

### NOT done — needs external prerequisites
- **LIVE WhatsApp** — requires a Meta WABA number + Cloud API token. Transport interface
  is ready (`src/lib/whatsapp/transport.ts`); flip `WHATSAPP_MODE=LIVE` + implement the
  Cloud API send/receive + Meta webhook. Everything else is transport-agnostic.
- **Postgres / ERP cutover** — switch Prisma provider sqlite→postgresql, point at the
  ERP's Supabase, wire the ERP webhooks to `/api/webhooks/erp` (replaces the GAS bridge).
- **Org-chart RBAC from the real ERP org chart** (currently a demo org chart + "view as").

Run: `node node_modules/next/dist/bin/next dev -p 3009` (pnpm exec trips the build gate).

## Earlier: Phase 2a (Automation engine + ERP trigger) — DONE ✅

The owner's #1 ask: ERP triggers a flow that sends the first WhatsApp message, and the
customer's tap drives the next content. Working end-to-end in DEMO.

- Engine `src/lib/automation/engine.ts` — node-graph runtime (trigger, send_text,
  ask_buttons, collect_input, criteria_router, set_attribute, add/remove_tag, assign,
  set_status, call_rest_api, delay). AutomationRun persists a cursor → pause on
  interactive/collect nodes, resume on reply. Merge vars ({full_name}{ref_1}…).
- `src/lib/whatsapp/transport.ts` (DEMO send/record + buttons + 24h window).
- `src/lib/automation/dispatch.ts` — `handleErpWebhook` (upsert contact + fire WEBHOOK
  automation) + `handleCustomerReply` (resume waiting runs).
- Routes: `POST /api/webhooks/erp` (ERP entry), `POST /api/demo/reply` (simulator).
- Inbox: interactive buttons render + tappable; "reply as customer" demo bar.
- Verified: webhook → interpolated first msg + buttons → Confirm → attr+tag+ERP-sync+reply
  (completed); Change → collect reason (saved) → tag + reply. Typecheck clean.

### Next in Phase 2: visual builder + inbox write-actions
- react-flow builder canvas (view + edit graph), trigger catalog, node palette/inspector.
- Wire inbox actions to server: assign agent/department, add/remove tag, set status, close.
- Trigger types beyond WEBHOOK: NEW_INCOMING_MESSAGE, TAG_ADDED (start automations on
  inbound, not just resume).

## Earlier: Phase 1 (Shell + Inbox + RBAC) — DONE ✅

- Design system (Tailwind v4 + self-hosted Geist): warm-charcoal rail, light workspace,
  Houzs amber accent. `src/app/globals.css`.
- App shell (`src/app/(app)/layout.tsx`) + Sidebar + Topbar with dev "view as" switcher.
- **Org-chart RBAC** (`src/lib/access.ts`) — verified end-to-end via curl:
  OWNER/Manager/Agent see the Support queue (4), Sales & Driver see 0.
- **Shared inbox**: conversation list (filter tabs, tags, SLA), thread (bot/agent
  bubbles, receipts), composer (reply / private note, demo-send server action),
  contact panel with live order attributes (8/63 populated).
- Dashboard (spend + KPIs), Contacts table, Automations list, Settings (org chart);
  Campaigns/Forms placeholders. All routes compile 200, no errors.
- Run: `pnpm dev` → currently up on `http://localhost:3009` (preview_start's corepack
  path hangs on this machine; run next directly:
  `node node_modules/next/dist/bin/next dev -p 3009`).

## Earlier: Phase 0 (Foundation) — DONE ✅

- Next.js 16 + TS + Tailwind v4 scaffolded (pnpm). Git repo on `main`.
- Prisma schema = full domain model (21 tables) — see `prisma/schema.prisma`.
- SQLite dev DB pushed; Prisma client generated.
- Houzs demo seed applied (`pnpm db:reset`): 1 company, 8 members with org chart,
  5 departments, 1 channel, **63 contact fields**, 5 tags, 3 quick replies,
  4 sample contacts+conversations+messages, 1 sample automation.

## Next: Phase 2 — Automation engine + visual builder

1. Node runtime: interpret Automation.graph, persist AutomationRun with a cursor so runs
   pause on delay / awaiting-reply and resume on the next event.
2. Node executors: ask-buttons, collect-input, criteria-router, set-attribute, add/remove
   tag, assign, delay, call-rest-api, send-template.
3. Trigger dispatch: on inbound message / tag / webhook / payment / driver event → find
   matching enabled automations → start/resume runs.
4. Visual builder canvas (react-flow) + trigger catalog + node palette.
5. Demo transport (`src/lib/whatsapp/demo.ts`) so interactive buttons round-trip in DEMO.
6. Port the real delivery/amend/reminder flows onto the engine.

Also queued: inbox actions wired to server (assign/tag/status/close), Contacts custom-field
editor, receipt-OCR → payment (Phase 4), driver-triggered messages (Phase 4).

## Gotchas

- **Prisma via pnpm**: `pnpm exec prisma …` fails on this machine (pnpm build-approval gate
  + a linter that re-adds an `allowBuilds:` block to `pnpm-workspace.yaml`). Run Prisma as
  `node node_modules/prisma/build/index.js <cmd>`; the `db:*` npm scripts already do this.
- SQLite can't default a Json column to `{}` — Json columns are nullable, treated as
  empty in code. Fine for the Postgres cutover too.

## Longer roadmap

Phase 2 automation engine → 3 campaigns/dashboards → 4 payments-OCR/driver-events/Flows →
5 LIVE Cloud API + Postgres/ERP cutover + AI agent. See `docs/ARCHITECTURE.md`.
