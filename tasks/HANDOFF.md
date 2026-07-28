# Houzs Connect — Handoff / current state

_Last updated: 2026-07-28_

## Where we are: Phase 1 (Shell + Inbox + RBAC) — DONE ✅

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
