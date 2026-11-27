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

## 6a. AI Connector (MCP) — where the code lives

Claude / ChatGPT access with each person's own login — read-only, plus (round 4b) three
write actions that are OFF until a connector admin switches them on and then run only
after the person confirms the exact proposal (details and FAQ: `tasks/HANDOFF.md` → "AI
Connector").

| File | What |
| --- | --- |
| `src/app/api/mcp/**`, `src/app/.well-known/oauth-*` | routes: JSON-RPC, OAuth, export download, discovery |
| `src/lib/mcp/server.ts` | tools list (`toolAllowed` = round 4c role-aware list), `callTool`, the supervisor gate, composite tools, structured output, the 60 s answer cache |
| `src/lib/mcp/reads.ts` | the catalogue of read endpoints — the ONLY place connector read SQL lives, each reusing the page's own predicate |
| `src/lib/mcp/quick.ts`, `round3.ts`, `round4.ts`, `round4c.ts` | pure logic per round (round 4: `period`, waiting_now, agent_workload, chat_review, customer_chat_summary, data_gaps; 4c: prompts per role, links, outputSchema, cache) |
| `src/lib/mcp/actions.ts`, `write-actions.ts`, `write-exec.ts` | round 4b: switches + single-use proposals (tables `mcp_settings`, `mcp_pending_actions`, migration 0028), propose → confirm with the write fence, and the real I/O |
| `src/lib/inbox-writes.ts` | the inbox's write cores (reply, internal note, assign, status, Remarks) shared by the server actions and the connector's confirmed actions — one write path |
| `src/lib/mcp/core.ts`, `store.ts`, `oauth.ts`, `admin.ts` | pure helpers, tables, OAuth, admin page (incl. the AI actions switches) + leak check |
| `src/lib/mcp/proactive.ts`, `proactive-store.ts`, `proactive-run.ts`, `src/lib/mail.ts` | round 4d: morning brief + urgent alerts — pure logic + the ONE threshold config (`PROACTIVE_CONFIG`), tables (`mcp_brief_subscriptions`, `mcp_proactive_keys`, `mcp_proactive_sends`, migration 0029), the tick (run from `/api/cron`, each person read AS themselves with a short-lived token), Resend sender (off without `RESEND_API_KEY`); unsubscribe page `src/app/api/mcp/unsubscribe` |
| `src/lib/mcp/howto.ts`, `howto-types.ts`, `howto-guides*.ts`, `howto-flows.ts`, `howto-ref.ts` | round 5: process help — `how_to`, `module_overview`, `glossary`, `explain_error`, `onboarding`; page gates mirroring Connect's RBAC (`PAGE_GATES`), the guides / flows / glossary / errors data, the gap log note `no-guide` |
| `src/components/shell/HighlightFromUrl.tsx`, `src/lib/highlight-match.ts` | round 5: `?highlight=<label>` outlines the button a how-to link points at (English or the same label in Chinese) |
| `scripts/smoke-mcp.mjs`, `scripts/smoke-mcp-actions.mjs`, `scripts/smoke-mcp-proactive.mjs`, `scripts/smoke-mcp-howto.mjs`, `scripts/smoke-mcp-db.mjs` | pure, pure (4b / 4c with fakes), pure (4d), pure (round 5 honesty: pages, labels, gates, errors) and real-Postgres tests (CI) |

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
