# Houzs Connect — Handoff / current state

_Last updated: 2026-08-01_

Houzs Connect (`chat.houzscentury.com`) is the in-house replacement for **Seampify**
(`waba.seampify.com`), the WhatsApp follow-up platform Houzs Century runs its delivery
scheduling on. Next.js 16 App Router, deployed to Cloudflare Workers via OpenNext, on
Drizzle + postgres.js over Hyperdrive against the **same Supabase project as the ERP**, in
a dedicated `connect` pgSchema.

**Scope of the current engagement: get WhatsApp connected. Everything after that is handed
to the next owner** — see §7.

---

## 1. Where things stand

### Live and verified
- **Automation builder** — full node palette (Trigger / Criteria Router / Jump To
  Automation / Delay / Auto Reply Template / Buttons-Options / Collect User Input /
  AI Agent Reply / Drip / Set Contact Attribute / Tagging / Opt In-Out / Call REST API),
  drag-connect-configure, Draft/Live toggle, **version history (10 snapshots, preview +
  restore)**, Test run. A human builds flows entirely in the UI.
- **Executable triggers** — `ACTION_CALLBACK` (Seampify's "Action Callback Id Matches"),
  `WEBHOOK`, `NEW_INCOMING_MESSAGE`, `TAG_ADDED`, `DRIVER_EVENT`, `PAYMENT_RECEIVED`.
  Proven end to end in CI by `scripts/smoke-trigger.mjs` against a real Postgres.
- **9 Seampify flows migrated** (§3) — all imported as **Draft / disabled**.
- **Dashboard** — Overview / Support / Marketing / Live Reporting / Message Analytics /
  Calling Analytics, dependency-free inline SVG charts. Real data where captured; the
  Support response-time tiles, the spend breakdown and the whole Calling Analytics tab are
  clearly-labelled placeholders.
- **Campaigns** — one-time broadcasts, audience by all/tag/attribute, `{{variable}}`
  insert, send-now vs scheduled, list with stats.
- **ERP → Connect org sync** (§4) — companies + members mirrored one-way from the ERP.
- **Perceived-performance pass** — loading skeletons on all 9 routes, dashboard streaming,
  several genuine query fixes. Measured on the deployed app: dashboard TTFB
  **745ms → 158ms**, full load **1095ms → 375ms**.

### Not done (deliberately, for the next owner)
ERP → Connect delivery-planning integration; Drip Campaign / Ecommerce / System Logs
modules; a real LLM behind the AI agent node; the migration approximations in §3.

---

## 2. THE REMAINING TASK — connect WhatsApp

Connect runs in **DEMO mode**: `sendOutbound` always records the message row (so flows are
testable and visible in the inbox) and only calls Meta when `WHATSAPP_MODE=LIVE`. **No code
work is required to go live** — this is configuration.

### Critical context
The production number is **already on the WhatsApp Business Platform, registered under
Seampify**. This is a migration between apps, not a fresh signup. A number can be on the
WhatsApp Business phone app **or** the Cloud API, never both — already the case today
(staff work through Seampify's web inbox, not the phone app). Connect's Inbox replaces it.

### Steps
1. **Meta app** — `developers.facebook.com`, Business-type app, add the **WhatsApp** product.
2. **Test on Meta's free test number first.** It sends to up to 5 whitelisted recipients.
   Prove the whole loop (Connect sends → customer replies → flow resumes) without touching
   the production number, so Seampify keeps running meanwhile.
3. **Submit message templates for approval early** — ~24h turnaround and the usual blocker.
   Business-initiated messages (every delivery / reminder / reschedule / balance flow here)
   **must** use an approved template; free-form text is only allowed inside the 24-hour
   customer-service window. Templates do **not** carry over from Seampify and must be
   recreated under the new WABA. The migrated flows' `auto_reply_template` nodes were
   approximated as `send_text` with the body copy — use that copy as the template source.
4. **Set the Worker secrets** on `houzs-connect`:
   - `WHATSAPP_MODE=LIVE`
   - `WHATSAPP_TOKEN` — a **System User** permanent token with
     `whatsapp_business_messaging` + `whatsapp_business_management` (a temporary token
     expires in 24h)
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_VERIFY_TOKEN` — any string you choose
5. **Configure the Meta webhook** — callback
   `https://chat.houzscentury.com/api/webhooks/whatsapp`, the verify token from step 4,
   subscribe to the **messages** field. The handshake and inbound handling already exist in
   `src/app/api/webhooks/whatsapp/route.ts`.
6. **Migrate the production number** off Seampify only after 2–3 pass. The moment the
   number moves, Seampify can no longer send.
7. **Point the Google Sheet's Apps Script at Connect.** The "HC Delivery Updated" sheet's
   bound script currently POSTs its follow-up payloads to Seampify; changing that URL to
   `https://chat.houzscentury.com/api/webhooks/erp` is a one-line change and is what
   actually cuts Seampify out of the loop. Payload contract is in
   `docs/seampify-research.md`; the `status` field is the Action Callback Id the flows
   match on.
8. **Enable the flows** — they are all Draft. Review each in the builder, then Publish live.

### Read receipts
Cloud API does **not** send read receipts unless the application explicitly marks a message
read. Connect never does — there is no such call anywhere in `src/lib/whatsapp/`. Customers
will not see blue ticks. Delivered (grey double tick) is platform-level and cannot be
disabled. If blue ticks are wanted later it is a small addition to `cloud-api.ts` plus a
call site when an agent opens a conversation.

---

## 3. The migrated Seampify flows

Nine canonical flows were extracted read-only from Seampify, translated to Connect's graph
format, and imported **disabled**. Older iterations and the two test flows were skipped.

| Flow | Trigger | Size |
| --- | --- | --- |
| New Delivery HC Callback Updated Single Order Flow | ACTION_CALLBACK | 48n / 68e |
| New Delivery HC Callback Updated Tag Message | TAG_ADDED | 170n / 279e |
| New Amend HC Callback Updated | ACTION_CALLBACK | 184n / 276e |
| New Reminder HC Latest | WEBHOOK | 16n / 15e |
| Confirmation Message Callback | ACTION_CALLBACK | 25n / 31e |
| Opt In/Opt Out | NEW_INCOMING_MESSAGE | 10n / 10e |
| Reassign | TAG_ADDED | 2n / 1e |
| General After-Hours Away Message | NEW_INCOMING_MESSAGE | 7n / 7e |
| Replied Check L3 | NEW_INCOMING_MESSAGE | 12n / 11e |

**Integrity audited against the DB:** zero dangling edges across all flows, every flow has a
trigger node, every `ACTION_CALLBACK` has its `callbackId` set. Node/edge key shapes are
byte-identical to a natively-built automation, so they open, edit, save and run like any
other. Rendering verified in the deployed builder.

Orphan (unreachable) nodes remain in four flows — 14 / 2 / 1 / 1. These are **pre-existing
in Seampify**: the source flows have 22 / 6 / 8 / 3 nodes with no incoming edge, so the
migration reduced them everywhere. They never execute. Left in place rather than pruned,
since they may be branches the owner intends to wire up.

**Approximations to be aware of:**
- **Google Sheets append** (`add_row_in_sheet`, 28 nodes across two flows) — the
  `google_sheets` node exists but is config-only; it logs and continues. Note the flows'
  *real* Sheet writes go through **`call_rest_api` → the Apps Script `/exec` endpoint**, and
  that path is fully implemented (§5).
- **WhatsApp Flow forms** (`type:"flow"`, ~25 nodes) — no native interactive-form node;
  approximated as `send_text` with the body copy.
- **Template messages** — approximated as `send_text` with text reconstructed from the
  template params. See step 3 above.
- **assign_to_user round-robin** — Seampify department ids do not map to Connect members;
  the assign node has an empty target and is a no-op until mapped.
- `jump_to_automation`, `eval`, drip nodes — real node types, config-only execution.

`docs/seampify-research.md` has the platform study and the Sheet → Seampify payload
contract.

---

## 4. ERP → Connect org sync

The ERP is the sole source of truth for team/user management. Connect mirrors **companies
and members only** — no org chart, no departments/positions, no RBAC of its own (roles map
from the ERP's `role_name`). Connect never hand-edits this data.

- Source: the ERP's existing HTTP API at `https://erp.houzscentury.com`
  (`/api/companies`, `/api/users`, `/api/users/:id/companies`), authenticated with
  `Authorization: Bearer <ERP_SERVICE_TOKEN>`.
- The ERP accepts that token via a dedicated `CONNECT_SERVICE_TOKEN` secret on the
  `autocount-sync-api` worker (Houzs-ERP PR #1454) so the legacy shared `DASHBOARD_API_KEY`
  never had to be rotated. **Both sides hold the same string.**
- Implementation: `src/lib/sync/erp-org.ts` (`fetchErpOrg`, pure `planOrgSync`, idempotent
  non-destructive `applyOrgSync`). One member per (granted company × user), keyed
  `(company_id, erp_user_id)`; pre-existing members reconcile by `(company_id, email)` and
  are backfilled, never duplicated. Removed users are **soft-deactivated**, never deleted.
- Trigger: `POST /api/admin/sync-org` guarded by header `x-sync-token` ==
  `SYNC_ADMIN_TOKEN`. `?dryRun=1` (default) returns the diff; `?dryRun=0` applies. No cron
  yet — run it manually after ERP staffing changes.

Current result: **2 companies** (Houzs Century / HOUZS, 2990's Home / 2990) and
**112 members** (103 ERP-linked). Note **2990 has 0 channels, 0 contacts, 0 automations** —
it exists but needs its own WhatsApp channel before it can be used.

---

## 5. Landmines — read before touching anything

- **Use pnpm, never npm.** `npm install` fails here with `ETARGET miniflare@…-alpha` pulled
  transitively via wrangler. CI uses `pnpm install --frozen-lockfile`.
- **The OpenNext build cannot run on Windows** (symlink EPERM). CI on Linux is the only
  build signal; `.github/workflows/ci.yml` runs typecheck, lint, the smoke tests against a
  Postgres service, and `cf:build` on every PR. `deploy.yml` deploys on push to `main`.
- **Never use a PARTIAL unique index as an `ON CONFLICT` target.** Postgres will not match a
  bare `ON CONFLICT (cols)` to a `WHERE …`-qualified index and throws 42P10. This broke
  production login once. `member_company_email_unique`, `member_company_erp_user_key` and
  `company_erp_company_id_key` are deliberately **non-partial**. `scripts/smoke-org-sync.mjs`
  has a DB-backed regression that replays the login upsert twice and will catch a
  reintroduction.
- **`member.email` is not globally unique** — the same person recurs once per company. The
  login upsert conflict target is `[member.companyId, member.email]`.
- **Journal every migration.** `0002` was initially unjournaled, so `pnpm db:migrate` would
  never have applied it and the deployed code would have queried columns that did not
  exist. Migrations that alter shared tables must be in `meta/_journal.json`.
- **Enabling a flow now makes real outbound HTTP.** `call_rest_api` is fully implemented
  (`src/lib/automation/rest.ts`): variable interpolation into URL/headers/body, a 10s
  `AbortSignal.timeout`, `http(s)` only, and it **never throws** — failures are logged and
  the run continues. The migrated flows' REST nodes point at the owner's Google Apps Script
  `/exec` endpoints, so switching a flow live starts writing to the live Sheet.
- **Do not enable a flow containing an `AI Agent Reply` node yet.** `src/lib/ai.ts` is a
  keyword rule-based DEMO responder, not an LLM, and its canned replies include a hardcoded
  bank account number. Swap in a real model before those nodes go live.
- **28 of 92 ERP users cannot log in** — 8 are `invited` and ~20 active users have no
  `password_hash` (all drivers, plus the 2990 sales team). This is an ERP data condition,
  not a Connect bug; the same accounts fail against the ERP itself. Fix by sending them an
  invite / setting a password in the ERP. All admin and management accounts can log in.

---

## 6. Operating it

```bash
# deploy: merge to main (deploy.yml). CI must be green first.
# migrations are NOT run by deploy:
pnpm db:migrate

# org sync — dry run first, always
curl -X POST -H "x-sync-token: <SYNC_ADMIN_TOKEN>" \
  "https://chat.houzscentury.com/api/admin/sync-org?dryRun=1"

# smokes
DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable' \
  node scripts/smoke-trigger.mjs
node scripts/smoke-org-sync.mjs
node scripts/smoke-rest-api.mjs
```

Secrets live on the `houzs-connect` Worker: `SESSION_SECRET`, `ERP_SERVICE_TOKEN`,
`SYNC_ADMIN_TOKEN`, and (once live) the four `WHATSAPP_*` values. `DATABASE_URL` in
`.dev.vars` is for scripts only.

**Outstanding security item:** the Hyperdrive/Supabase password for Connect is still the
temporary one set during cutover and should be rotated.

---

## 7. For the next owner

In rough priority order:

1. **ERP delivery-planning → Connect.** The original goal, and the one piece with **no code
   at all** on the ERP side — `backend/src/services/connect.ts` does not exist and nothing
   in the ERP references `chat.houzscentury.com`. Connect's receiving end
   (`/api/webhooks/erp`, `/api/webhooks/driver`) is built and working; the ERP simply never
   calls it. Doing this replaces the Google Sheet entirely. It needs: a sender service in
   the ERP (mirror `email.ts`, settings-gated), calls wired into `delivery-planning.ts`'s
   schedule/amend handlers and `trips.ts`'s status transitions, and — importantly — a
   **WhatsApp follow-up sub-status** on the ERP side, because the ERP's coarse
   `delivery_state` (PENDING_DELIVERY / PENDING_SCHEDULE / OVERDUE / DELIVERED) cannot drive
   the Sheet's finer state machine (To Send Delivery Date / To Remind Customer Reply /
   Pending Reschedule / Done Balance Collection / …). `docs/seampify-research.md` has the
   full payload contract.
2. **Authenticate the inbound webhooks.** `/api/webhooks/erp` and `/api/webhooks/driver`
   have **no auth at all** today — they only require a `phone` field. Add a shared secret
   before anything external points at them.
3. **A real LLM behind `AI Agent Reply`** — `src/lib/ai.ts` is designed to be swapped
   without touching the node. Consider reusing the ERP's existing trainable-agent rules
   rather than maintaining a second set.
4. **Missing Seampify modules** — Drip Campaign, Ecommerce, System Logs.
5. **Close the §3 approximations** — a native WhatsApp Flow form node, template
   registration, and mapping assign_to_user to Connect members.
6. **2990's channel** — it has no WhatsApp number of its own yet.
7. Nice-to-have: an auto-layout button in the builder (the migrated canvases inherit
   Seampify's original, fairly scattered node coordinates).
