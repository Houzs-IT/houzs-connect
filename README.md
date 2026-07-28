# Houzs Connect

Houzs Century's internal **WhatsApp communication + automation platform** — a from-scratch
rebuild of what the company currently rents from Seampify (`waba.seampify.com`), owned and
wired directly into the Houzs ERP.

It is the company-wide comms hub: a shared team inbox where every staff member (support,
sales, drivers, marketing) works, governed by the company org chart, driven by a no-code
automation engine that runs the order **follow-up (跟单)** flows.

## What it does (target)

- **Shared team inbox** — WhatsApp conversations, assignment (agent / department /
  round-robin), tagging, private notes, quick replies, SLA timers, bot↔human handover.
- **Org-chart RBAC** — who sees what is derived from the company org chart (you see your
  department, your assignments, and anyone who reports up to you).
- **Automation engine** — trigger → node-graph runtime: send interactive button messages,
  branch on the reply, collect inputs into contact attributes, delay, call the ERP,
  add tags, assign, capture receipts, etc.
- **Receipt OCR → payment** — auto-capture a customer's payment slip, OCR it, record the
  payment against the order.
- **Driver-triggered messages** — when a driver marks en-route/arrived/delivered, the
  system messages the customer automatically.
- **Broadcast campaigns**, **contacts CRM** with dynamic custom fields, **dashboards**
  (spend, delivery categories, agent performance).

## Status

Foundation phase. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the plan and
[`tasks/HANDOFF.md`](tasks/HANDOFF.md) for current state.

## Dev

```bash
pnpm install
pnpm db:reset   # push schema + seed Houzs demo data (SQLite, zero infra)
pnpm dev        # http://localhost:3000
```

- **Dev DB:** SQLite (`dev.db`), zero infra. **Prod:** switch Prisma `provider` to
  `postgresql` and point `DATABASE_URL` at the ERP's Supabase Postgres.
- **WhatsApp:** `WHATSAPP_MODE=DEMO` stubs the transport (no Meta needed). `LIVE` uses the
  WhatsApp Cloud API once a WABA number + token are available.
- Prisma note: `pnpm exec` currently trips pnpm's build-approval gate on this machine, so
  the `db:*` scripts invoke Prisma via `node node_modules/prisma/build/index.js`.
