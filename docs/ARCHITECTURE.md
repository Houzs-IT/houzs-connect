# Houzs Connect — Architecture & Build Plan

> Living doc. Source research: the full Seampify walkthrough (`seampify-research.md`,
> captured 2026-07-28). This is the plan for the from-scratch rebuild.

## 1. Goal & principles

Rebuild Seampify as Houzs's **owned** internal comms + automation platform. Not a generic
1:1 clone of every Seampify module — the **Houzs-used slice**, wired straight into the ERP.

- **Automation is the core.** Everything else supports it.
- **Org-chart RBAC** — visibility derives from the company org chart, not ad-hoc roles.
- **Direct ERP integration** replaces the legacy `webhook → Google Apps Script` bridge.
- **Demo-first** — runs and looks real with `WHATSAPP_MODE=DEMO` before a WABA exists.
- **Solid foundation before surface.** Typed schema + engine first, polished UI on top.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js 16 (App Router, TS)** | server components for data, easy Meta webhook routes, one deploy |
| UI | **Tailwind v4** + design system (frontend-design skill) | fast, consistent, themeable |
| Data | **Prisma** — SQLite (dev) → **Postgres/Supabase (prod)** | zero-infra dev; prod shares ERP DB |
| Validation | **zod** | typed API boundaries |
| Realtime | polling now → SSE/WebSocket later | inbox live updates |
| WhatsApp | transport interface: `DemoTransport` \| `CloudApiTransport` | swap without touching app code |

## 3. Reference projects (patterns, not code)

- **Chatwoot** (team inbox / assignment / CSAT) — inbox UX + agent model reference. Note:
  Desktop already has `chatwoot-whatsapp-poc` evaluating Chatwoot as a Seampify replacement;
  reconcile learnings from it.
- **Typebot / n8n / react-flow** — visual flow-builder + node-graph execution patterns for
  the automation engine and its canvas.
- **Meta WhatsApp Cloud API & WhatsApp Flows** docs — the real transport + native forms.

## 4. Domain model (implemented — `prisma/schema.prisma`)

Company → Members (org-chart self-relation) / Departments / Teams. Channels (WABA numbers).
Contacts + dynamic `attributes` JSON governed by ContactField registry (the 63 Seampify
fields; `_1/_2/_3` = up to 3 orders per contact). Conversations → Messages / Notes / Tags.
Automations (trigger + node `graph` JSON) → AutomationRuns. Payments (receipt OCR).
Campaigns. QuickReplies. DriverEvents. WebhookEvents (ERP/driver-app inbound).

## 5. Automation engine (the core)

- **Triggers**: new incoming/outgoing message, tag added/removed, contact-field updated,
  webhook (ERP), payment received, driver event, conversation closed, voice call.
- **Nodes** (from Seampify's palette, Houzs-used subset first): trigger, criteria-router
  (branch), delay, ask-buttons (interactive), collect-input (→ attribute, with timeout /
  validation branches), send-template, set-attribute, add/remove-tag, assign-to-member,
  set-status, call-rest-api (ERP), capture-payment (OCR), google-sheet-row, jump-to,
  ai-agent-reply.
- **Runtime**: interprets the `graph` JSON; a run has a cursor node + context so it can
  pause on delays / awaiting-reply and resume on the next event. Persisted in AutomationRun.

## 6. RBAC (org chart)

`src/lib/access.ts` — a member can see a conversation if: assigned to them, in their
department, assigned to a team they're on, or owned by someone who reports up to them
(transitive via `managerId`). OWNER/ADMIN see all. DRIVER sees only their delivery jobs.

## 7. Build phases

- **Phase 0 — Foundation (DONE):** repo, schema, DB, Houzs seed (8 members/org chart,
  63 fields, sample inbox + automation).
- **Phase 1 — Shell + Inbox + Contacts + org-chart RBAC:** app shell (nav = the modules),
  shared inbox (list/thread/compose/assign/tag/notes), contacts + custom-field panel,
  access layer. Demo transport (fake send/receive).
- **Phase 2 — Automation engine + builder:** node runtime + React-flow canvas + trigger
  catalog; port the delivery/amend/reminder flows.
- **Phase 3 — Campaigns + Dashboards:** broadcast wizard; spend/delivery/agent dashboards.
- **Phase 4 — Payments OCR + Driver events + WhatsApp Flows.**
- **Phase 5 — LIVE WhatsApp (Cloud API) + Postgres/ERP cutover + AI agent.**

## 8. Open decisions

- Prod hosting (same infra as ERP? separate?).
- ERP integration surface (shared Supabase Postgres vs. internal ERP API) — pick when
  Phase 5 starts.
- Auth (ERP SSO vs. own) — Phase 1 uses a dev member switcher.
