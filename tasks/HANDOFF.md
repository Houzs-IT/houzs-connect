# Houzs Connect — Handoff / current state

_Last updated: 2026-07-28_

## Where we are: Phase 0 (Foundation) — DONE ✅

- Next.js 16 + TS + Tailwind v4 scaffolded (pnpm). Git repo on `main`.
- Prisma schema = full domain model (21 tables) — see `prisma/schema.prisma`.
- SQLite dev DB pushed; Prisma client generated.
- Houzs demo seed applied (`pnpm db:reset`): 1 company, 8 members with org chart,
  5 departments, 1 channel, **63 contact fields**, 5 tags, 3 quick replies,
  4 sample contacts+conversations+messages, 1 sample automation.

## Next: Phase 1 — Shell + Inbox + Contacts + org-chart RBAC

1. App shell: left nav (Dashboard, Inbox, Contacts, Automations, Campaigns, Forms,
   Settings), top bar, dev "act as member" switcher. → build with the frontend-design skill.
2. `src/lib/access.ts` — org-chart visibility helper (+ unit tests).
3. Inbox: conversation list (filter by All/Unread/Open/Closed/Queue + tag + assignee),
   thread view, composer (reply / private note, `/` quick replies), right panel
   (contact attributes, tags, assign agent/department, status).
4. Contacts: table + custom-field editor.
5. Demo transport (`src/lib/whatsapp/demo.ts`) — fake inbound/outbound so the inbox lives.

## Gotchas

- **Prisma via pnpm**: `pnpm exec prisma …` fails on this machine (pnpm build-approval gate
  + a linter that re-adds an `allowBuilds:` block to `pnpm-workspace.yaml`). Run Prisma as
  `node node_modules/prisma/build/index.js <cmd>`; the `db:*` npm scripts already do this.
- SQLite can't default a Json column to `{}` — Json columns are nullable, treated as
  empty in code. Fine for the Postgres cutover too.

## Longer roadmap

Phase 2 automation engine → 3 campaigns/dashboards → 4 payments-OCR/driver-events/Flows →
5 LIVE Cloud API + Postgres/ERP cutover + AI agent. See `docs/ARCHITECTURE.md`.
