# Houzs Connect — Handoff / current state

_Last updated: 2026-09-14 (§0). Sections 1–7 are the 2026-08-01 state and are kept as
history; where they disagree with §0, §0 is current._

Houzs Connect (`chat.houzscentury.com`) is the in-house replacement for **Seampify**
(`waba.seampify.com`), the WhatsApp follow-up platform Houzs Century runs its delivery
scheduling on. Next.js 16 App Router, deployed to Cloudflare Workers via OpenNext, on
Drizzle + postgres.js over Hyperdrive against the **same Supabase project as the ERP**, in
a dedicated `connect` pgSchema.

**Scope of the current engagement: get WhatsApp connected. Everything after that is handed
to the next owner** — see §7.

---

## AI Connector (MCP) — 2026-11-25, branch `feat/mcp-connector`

Owner 2026-11-25 「connects 也是要」: the same AI Connector Hookka ERP and Houzs ERP
have. Staff connect Claude / ChatGPT with their OWN Connect login; READ-ONLY; it sees
only what that login sees; the connector admin (role SUPER_ADMIN or OWNER) approves
each person, sees every lookup and can disconnect anyone (Settings → AI Connector,
works on a phone).

- **Connector URL:** `https://<company address>/api/mcp` (e.g.
  `https://chat.houzscentury.com/api/mcp`). A token belongs to the member row of the
  company the person signed in to, so connect from the company's own address.
- **Code:** `src/lib/mcp/` (core = pure, store = tables, reads = what can be read,
  server = JSON-RPC + identity, oauth = register/authorize/token, admin = page data +
  leak check; quick / round3 / round4 = the pure summarise logic of each round); routes `src/app/api/mcp/**`, discovery `src/app/.well-known/oauth-*`;
  page `src/app/(app)/settings/(center)/ai-connector/`; one Settings menu entry; the
  sign-in action returns to a pending Allow page (cookie `hc_mcp_return`, 10 min).
- **Read-only + own permissions, by construction:** the `hcmcp_` token is accepted only
  by `POST /api/mcp`; the app's own auth (session cookie, `hc_` API keys) never reads it,
  so it cannot open a page, call `/api/v1` or run a server action. Tool calls do not
  re-enter the app: they run a fixed catalogue of SELECT-only functions
  (`lib/mcp/reads.ts`) that reuse the pages' own predicates — Settings → Access modules
  (`resolveModules` + `moduleChoices`), the inbox rail's company + org-chart visibility
  (`inboxScopes` + `unifiedConversationWhere`; a thread is readable only if it passes
  it), `contactsWhere`, the dashboard / log queries. No "use server" module is
  reachable (pinned by `scripts/smoke-mcp.mjs`). Internal chat and Settings are never
  exposed. Credential-shaped keys are stripped; replies capped at 30k chars (was 60k).
- **Tables:** migration `0027_mcp_connector.sql`, self-applied at runtime by
  `src/db/ensure-mcp.ts` (prod does not run db:migrate). Tokens: SHA-256 only, access
  24 h, refresh 90 d (rotating). Every call → `connect.mcp_calls`.
- **Tests:** `scripts/smoke-mcp.mjs` (pure) and `scripts/smoke-mcp-db.mjs` (real
  Postgres, end to end through the real handlers; refuses any non-localhost DB), both in CI.
- **Speed + quick answers (2026-11-25, branch `feat/mcp-quick-answers`; owner: searching
  felt slow).** Tools now lead with `inbox_overview` (open / waiting-for-us by status,
  channel and person, 5 longest waits, messages / new conversations / contacts added today
  and last 7 days — inbox visibility, contacts only with the contacts module) and
  `service_performance {days}` (dashboard module: reply rate, first-reply / reply times
  overall and per person, status, volume vs previous period). Both are catalogue endpoints
  too (`/inbox/overview`, `/dashboard/service`), so the module gate, redaction, call log and
  leak check cover them. `search {query}` → `{"results":[{id,title,url}]}` (ids
  `conversation:<id>` / `contact:<id>`, same predicates as `/conversations?q=` /
  `/contacts?q=`) and `fetch {id}` → `{id,title,text,url,metadata}` — the shape ChatGPT
  requires. `prompts/list` + `prompts/get` (3 prompts). Module-bound tools are hidden from a
  person without the module. Pure parts: `src/lib/mcp/quick.ts`.
  Door check = ONE query (`store.checkAccessToken`: token + active + access_removed +
  approval + Settings → Access ticks) + the member read — was 4–5 sequential queries. The
  conversation scope is memoised per request (`Identity.memo`). Call log = one insert per
  request, after the answer (`waitUntil`, `route.ts`). Replies: cap 60k → 30k; `fitReply`
  drops empty fields and trims a long list to whole rows (valid JSON + "first N of M" note);
  smaller list defaults (20 rows, 30 messages, 1k-char message text).
  Bench: `scripts/bench-mcp-db.mjs` (local DB only; counts queries on the wire through a
  proxy). "How is the inbox?" was list_modules → list_endpoints → /conversations?limit=100
  → /dashboard/summary ≈ 52k chars / 33 queries / 4 calls; now `inbox_overview` ≈ 1.8k chars
  / 9 queries / 1 call. Not measured: production latency (Hyperdrive), a real ChatGPT
  connection using search/fetch.
- **Round 3 (2026-11-26, branch `feat/mcp-round3`, owner-approved).** All new reads are
  catalogue endpoints run through `readEndpoint` (module gate, inbox visibility, redaction,
  call log, leak check), listed before the `:id` patterns. Pure parts: `src/lib/mcp/round3.ts`.
  - `reply_speed` (dashboard module, `/dashboard/reply-speed`): the Dashboard's own `replyStats`
    for today / yesterday / last 7 days (avg first HUMAN reply, avg reply, reply rate), per
    member, and every conversation waiting on us longer than `SLA_MINUTES` (company-wide, like
    the Dashboard's live panel: customer, how long, assignee, department, channel).
  - `message_delivery` (logs, `/logs/delivery`): System Logs' `todayStats` + `logRows` FAILED
    for N days + `failureReasons` (Meta's reason) for the newest 20.
  - `contacts_summary` (contacts, `/contacts/summary`): total + the Contacts page's segments
    (`contactsWhere`), added today / 7 d, top tags. `campaign_summary` (campaigns,
    `/campaigns/summary`).
  - `customer_mood_scan` (inbox, `/inbox/mood-scan`): **supervisors and admins only** —
    `SUPER_ADMIN`, `OWNER`, `ADMIN`, `MANAGER` (`round3.moodScanAllowed`); everyone else gets
    "Supervisors and admins only…" (logged as 403) and does not see the tool in `tools/list`.
    Inbound messages of a day (or ≤ 7 days) inside the inbox rail's visibility, grouped by
    conversation (most active first), 300 chars each, ≤ 200 messages, flags (unanswered in a
    row, waiting past `SLA_MINUTES`, keyword hints EN / Malay / Chinese). Phones never shown
    (a name, else a masked number). The tool description tells the AI to summarise, not paste.
  - `daily_brief` + prompt `daily-brief`: 4 reads in parallel (`/inbox/overview`,
    `/conversations?assigned=me&open=true`, `/payments?status=PENDING`, `/logs/delivery?days=1`);
    a part the person may not read says "You do not have access to …".
  - `export_excel {list, filters?, fields?}`: conversations / contacts / payments / logs /
    campaigns, paged through the same catalogue reads (new `offset` on `/payments`,
    `/campaigns`, `/logs/messages` — `logRows` got an optional `offset`), cap 5,000 rows, a
    dependency-free .xlsx (`src/lib/mcp/xlsx.ts`), money in RM (payments.amount is RM). **No
    column carries customer message text.** Stored in R2 `FILES` under `mcp-exports/<sha256
    of token>.xlsx`, link `GET /api/mcp/export/<token>` valid 15 minutes (capability link —
    whoever holds it can download inside that window); objects older than a day are swept
    on the next export.
  - **Rate limit:** 30 tool calls / minute, 600 / day per person (email), counted from
    `mcp_calls` on the existing `mcp_calls_email_idx (email, created_at)` — **no migration**.
    Over the limit → normal `isError` result ("Too many requests — wait a minute" / "Daily
    limit reached"), logged as 429 and not counted. `initialize` / `tools/list` / prompts are
    free; the leak check uses `readEndpoint`, never `callTool`, so it is never limited. The
    AI Connector page shows the limits.
  - **Not built:** templates — they live under Settings (`requireModule("settings")`, a
    connector-blocked prefix) and are read live from Meta. `/conversations` gained `assigned=me`
    and `open=true` filters for the brief.
  - **FAQ (owner's acceptance list, 2026-11-26)** — one tool call each:

    | # | Question | Tool |
    | --- | --- | --- |
    | W1 | How fast are we replying today? Who is slow? | `reply_speed` |
    | W2 | Who is waiting for a reply right now? | `reply_speed` (waiting past SLA, company-wide) / `inbox_overview` (longest waits in my visibility) |
    | W3 | Which customers are unhappy or complaining? | `customer_mood_scan` — supervisors and admins only |
    | E1 | What do I need to look at today? | `daily_brief` (prompt `daily-brief`) |
    | E2 | Export X to Excel | `export_excel {list: conversations \| contacts \| payments \| logs \| campaigns}` |
  - Tests: `scripts/smoke-mcp.mjs` (gate, grouping, flags, reply speed, brief, export columns,
    xlsx with CRC check, limits) and `scripts/smoke-mcp-db.mjs` (every new tool through the real
    handler on Postgres; agent refused / Super Admin allowed for the mood scan; export link
    served, unknown and expired links refused; rate limit refusal + 429 not counted).
- **Round 4 — Connect items (2026-11-27, branch `feat/mcp-round4`, owner ask 2026-11-26).**
  Read-only. Owner focus: 「看聊天记录 — who hasn't been replied to, who has been, what we
  replied, which customers keep scolding us, how is quality」. Every read is a catalogue
  endpoint run through `readEndpoint` (module gate, inbox visibility, redaction, call log,
  leak check); the tool layer has no SQL. Pure parts + tests: `src/lib/mcp/round4.ts`.
  - **`period` convention** (`round4.periodRange`, Malaysia calendar): `today` | `week`
    (Monday → now) | `month` | `last_month` | `quarter` | `year` | `custom` (`from` / `to`,
    ≤ 366 days). Previous period = the same stretch before it: yesterday up to the same time,
    last Monday up to the same weekday and time, last month up to the same day (never past
    its end), the whole month before `last_month`, the same number of days before `custom`.
  - `waiting_now {limit?}` (inbox, `/inbox/waiting`): not-closed conversations whose newest
    message is the customer's, inside the inbox rail's visibility, longest wait first — wait
    measured from the customer's first message after our last outbound one; unanswered count,
    assignee, department, channel, a 100-char preview (what the inbox rail shows), a link.
  - `agent_workload {period}` (dashboard, `/dashboard/agents`): the Dashboard's own
    `agentsReport` for the period (replies sent, conversations handled, avg first reply / reply,
    on time vs `SLA_MINUTES`) + the team's `replyStats` vs the previous period + each person's
    open / waiting chats right now (company-wide, like the Dashboard's live panel). People with
    open chats and no replies are listed too. `agentsReport` gained an optional `to` (exclusive
    end, for a past period) and now also returns its `replies`; the Dashboard's calls are
    unchanged.
  - `chat_review {period}` (inbox, **supervisors and admins only** — the mood scan's gate,
    `round3.moodScanAllowed`), `/inbox/chat-review` + `/dashboard/agents`: the period's messages
    inside the person's inbox visibility walked per conversation (≤ 20,000 messages; over that
    the answer says so). **Replied** = a person (not a bot) wrote after the customer's latest
    message in the period; **not replied** = otherwise (longest wait first, unanswered count,
    "only a bot answered", the customer's last message clipped to 120); replied rows carry
    who replied, first reply after (clock time) and a 160-char snippet of our latest reply.
    **Repeat complainers** = complaint keywords (round 3's EN / Malay / Chinese list — hints)
    on 2+ days or in 3+ messages, per contact across their conversations, ≤ 3 clipped samples.
    **Quality**: customers who wrote, replied / not replied, reply rate, avg first reply,
    first reply over SLA, still waiting now, unresolved (not closed), only-a-bot, negative mood,
    against the previous period; reply times per person in the Dashboard's (business-hours)
    measurement come from `/dashboard/agents` — a supervisor without the Dashboard module gets
    that part as "no access". Lists ≤ 20 / 20 / 10. Phones never shown (name, else masked).
  - `customer_chat_summary {query | conversationId, messages?}` (inbox, **supervisors and admins
    only**): `/conversations?q=` (name / phone / order number, the person's visibility) →
    `/conversations/:id` for the newest match; clipped messages (300), flags, order ref /
    delivery date only (no other contact fields), last 5 internal notes, other matches. No phone.
  - `data_gaps` (no module of its own; each part keeps its module): `/contacts/gaps` (new,
    contacts — `contactsWhere` company scope: no name or only digits, no phone, phone under 9
    digits; counts + 10 examples each), `/inbox/overview` (unassigned open / waiting) and
    `/conversations?assigned=none&open=true` (new `assigned=none` filter) for examples with links.
  - **Gate for chat content:** `server.callTool` refuses every `supervisorOnly` tool for any
    role outside SUPER_ADMIN / OWNER / ADMIN / MANAGER **before any read** ("Supervisors and
    admins only: <tool> …", logged 403), and `tools/list` hides them. `/inbox/chat-review` holds
    the same check itself, so `connect_get` cannot go round it; the leak check reads it as the
    staff account and must show "refused". `customer_chat_summary` composes reads every inbox
    user already has (`/conversations`, `/conversations/:id`) — the gate is on the summary, as
    the owner asked; it does not change what an agent's own `fetch` / `connect_get` returns.
  - `customer_mood_scan` rows now carry the inbox link too (`url`).
  - **Not built:** the Monday email brief / weekly data-gaps mail (D1/D4 cron, a separate
    round); write actions (round 4b).
  - **FAQ (round 4)** — one tool call each:

    | # | Question | Tool |
    | --- | --- | --- |
    | W2 | Who is waiting for a reply right now? | `waiting_now` (longest first, with assignee) |
    | W4 | How is each agent doing today / this week? | `agent_workload {period}` |
    | W5 | Who did we not reply to this week, who did we, and what did we say? | `chat_review {period: "week"}` — supervisors and admins only |
    | W6 | Which customers keep complaining? How is our service quality vs last week? | `chat_review {period}` — supervisors and admins only |
    | W7 | What is going on with customer X (name / phone / order)? | `customer_chat_summary {query}` — supervisors and admins only |
    | D4 | What data do we need to clean up? | `data_gaps` |
  - Tests: `scripts/smoke-mcp.mjs` (period maths incl. Sunday / month-end / year-end, every
    summariser, tool list per role) and `scripts/smoke-mcp-db.mjs` (an AGENT gets "Supervisors
    and admins only" for `chat_review` and `customer_chat_summary`, logged 403, and through
    `connect_get /inbox/chat-review`; `waiting_now` / `data_gaps` stay inside the agent's own
    department; a Super Admin gets the review partition, our reply snippet, the repeat
    complainer and the customer summary with no phone; the leak check shows chat review
    refused for the staff account).
- **Round 4b — write actions (2026-11-27, branch `feat/mcp-4bc`, owner approved
  2026-11-26).** Same design as Hookka (hookka-erp-testing PR #1633): `propose_*` stores ONE
  pending action and writes nothing; the person sees the exact summary; `confirm_action`
  claims it (single use, 10 minutes, same token + same person) and runs it ONCE as the
  person; `cancel_action` drops it. **Everything is OFF by default**: the main "Allow AI
  actions" switch plus one switch per action, set only by a connector admin (SUPER_ADMIN /
  OWNER) in Settings → AI Connector → "AI actions" (`setMcpActionSwitch`). Daily cap: 30
  confirmed actions per person (MYT day). No campaigns / broadcasts, deletes or contact
  imports — `scripts/smoke-mcp.mjs` pins that no campaign / broadcast / import module is
  reachable from the connector.

  | Tool (args) | What runs on confirm (Connect's own code) | Connect's permission |
  | --- | --- | --- |
  | `propose_chat_reply {conversationId \| query, text}` — switch **"Reply to customers — SENDS TO THE CUSTOMER"** | `inbox-writes.sendReplyCore` = the composer's send (`sendOutbound`, `isBot: false`, `sentByMemberId` = the person; blocked contacts refused; LIVE → Meta) | inbox module + the conversation passes the inbox rail's visibility for the person (`/conversations/:id`) + the inbox company rule (`authorizeConversationFor`). Only inside the 24-hour window (the composer's own rule — outside it the answer says to send a template from the inbox; templates are not sent by the AI). Refused at confirm if a colleague (a person, not the bot) replied after the proposal or the window closed meanwhile. |
  | `propose_conversation_assign {conversationId \| query, assign_to?, department?, status?}` | `assignConversationCore` / `setConversationStatusCore` = the inbox's Assign / Resolve (activity log with `via: AI Connector`) | same as above; `assign_to` = an active member of the company (name / email / "me" / "nobody"), `department` = a company department or "none", `status` open / pending / resolved (= CLOSED) |
  | `propose_contact_note {conversationId \| query \| contact, note, as?}` | `as: "remarks"` (default) → `saveContactRemarksCore` (the Remarks box; one dated line appended to the Remarks stored AT CONFIRM, ≤ 2,000 chars); `as: "internal_note"` → `addConversationNoteCore` (the composer's Note mode, never sent) | from a chat: as above (the inbox side panel's Remarks box / Note); from `contact`: the contacts module + company scope (`/contacts?q=`, `/contacts/:id`) |
  | `confirm_action {confirmationId}`, `cancel_action {confirmationId}` | — | listed only while the main switch and at least one usable action are on |

  - **One write path:** the server actions `sendMessage`, `assignConversation`,
    `setConversationStatus` and `setContactRemarks` now call the same cores in
    `src/lib/inbox-writes.ts` (not a "use server" module, so the connector can import it
    without reaching a server action). Behaviour of the inbox is unchanged.
  - **Write fence** (`write-actions.payloadAllowed`): a pending payload may carry only its
    kind's keys (reply: conversationId / text / proposedAt; assign: conversationId / agentId /
    departmentId / status; note: target / contactId / conversationId / text), safe ids, status
    in open / pending / closed; checked at propose and again at confirm.
  - **Re-checked at confirm, as the person:** module, visibility (`/conversations/:id`),
    company rule, contact blocked, 24 h window, colleague replied, assignee still active.
  - **Logging:** every propose / confirm / cancel is a row in `mcp_calls` (target = kind +
    record id, never the message or note text); the pending row keeps the outcome and drops
    the payload once it ran. Connect's activity log gets `replied`, `note_added`,
    `remarks_updated` (new actions, labelled in `i18n/dict.ts`) and the usual
    `assigned` / `unassigned` / `status` with `detail.via = "AI Connector"`.
  - **Migration `0028_mcp_actions.sql`** (`mcp_settings`, `mcp_pending_actions`), additive and
    idempotent. **How it reaches prod:** self-applied at runtime by `src/db/ensure-mcp.ts`
    (the same `ensureMcpTables` every connector request already awaits) — nothing to run by
    hand; `db:migrate` is not run on prod. Until an admin flips a switch, both tables stay
    empty and the connector behaves exactly as before.
  - **FAQ (round 4b):** "Reply to Wong that the sofa comes Monday" → `propose_chat_reply`
    then `confirm_action`; "Give this chat to Agent B and mark it resolved" →
    `propose_conversation_assign`; "Note on this customer: prefers mornings" →
    `propose_contact_note`.
- **Round 4c — platform quality (same branch).** Pure parts: `src/lib/mcp/round4c.ts`.
  - **P1 role-aware tools/list:** `server.toolAllowed` — module (`module` / new `anyModule` on
    `daily_brief`, `data_gaps`, `export_excel`, `search`, `fetch`), the supervisor gate, and for
    write tools the switches + module. `tools/list` and `callTool` ask the same question: a
    hidden composite tool called directly answers "Not available to your role…" (403); module
    tools keep `readEndpoint`'s refusal; write tools answer "switched off" / "not available".
  - **P2 prompts per role:** `supervisor_morning` (waiting_now + yesterday's chat_review),
    `my_queue` (daily_brief + waiting_now; may offer `propose_chat_reply`, never sends without
    a yes), `weekly_quality_review` (chat_review + agent_workload, `period: week`). A prompt is
    listed / openable only when its tool is (`PROMPT_TOOL`), so agents do not get the
    supervisor prompts.
  - **P3 structured output:** the 13 quick answers carry an open `outputSchema` in
    `tools/list` and `structuredContent` in the result; the text keeps the same JSON. An
    answer too long to parse goes out as `{text, truncated: true}`.
  - **P4 speed:** heavy summaries (`inbox_overview`, `service_performance`, `reply_speed`,
    `agent_workload`, `message_delivery`, `contacts_summary`, `campaign_summary`,
    `customer_mood_scan`, `chat_review`, `data_gaps`) are reused for 60 s per person + role +
    modules + arguments, in the Worker isolate only (no shared store), AFTER the rate limit and
    every gate; logged with note `cached`; cleared for the person after any confirmed action.
    `waiting_now`, `daily_brief`, search / fetch stay live.
  - **P5 links:** every quick answer gets a top-level `link` to its Connect page; any row with a
    `conversationId`, `contactId` (or a bare `id` in `inbox_overview.longestWaiting` /
    `campaign_summary.latest`) gets a `url`. `campaign_summary` rows now carry their `id`.
  - Tests: `scripts/smoke-mcp-actions.mjs` (new, pure, in CI — 98 assertions: proposal writes
    nothing, confirm writes once, single use, switched off at propose and at confirm (not used
    up), invisible chat → Connect's own refusal, other company, module off, window / blocked /
    colleague replied, expiry / not yours / cancel / daily cap, assign + notes, the fence and a
    tampered payload, tools/list per role + switches, prompts, links, cache) and
    `scripts/smoke-mcp-db.mjs` (end to end on Postgres as an AGENT: off by default, only
    switched-on tools listed, window closed refused, another department's chat refused, one
    message row as the agent after confirm, single use, another person cannot confirm, switch
    off between propose and confirm, assign + resolve, remarks appended, activity + call log,
    cache hit with `structuredContent.link`, supervisor prompts).
- **Round 4d — morning brief email + urgent alerts (branch `feat/mcp-4d`, owner 2026-11-26
  「加 全部一起做」).** Mirrors Hookka PR #1635.
  - **Opt-in, per person, OFF by default:** Settings → AI Connector → "Morning brief & alerts"
    (`BriefSettings.tsx`, shown only to people who may use the connector). Brief on/off, time
    (Malaysia, on the hour / half hour, default 08:00), weekdays or every day; alerts on/off.
    One row per member (= per company) in `mcp_brief_subscriptions`. Buttons: Preview (built
    as you, not sent), Send me a test brief (own email only, one per 10 minutes). The alert
    levels are shown read-only; they live in ONE place: `src/lib/mcp/proactive.ts`
    `PROACTIVE_CONFIG`.
  - **Built AS the person:** `proactive-run.ts withPersonToken` issues a connector token for
    the member (client `mcpc_morning_brief`, internal: refused by OAuth, hidden from
    connected apps) and revokes it in `finally` — the leak check's pattern. The brief is
    `daily_brief` (+ `data_gaps` on Mondays = D4) through `handleRpc`, so it is gated,
    rate-limited and logged in `mcp_calls` like any Claude question. Alerts read through
    `readEndpoint`. No service account.
  - **Alerts (D2), 08:00–22:00 MYT, each person at most every 30 min:** supervisors / admins
    (`round3.moodScanAllowed`: SUPER_ADMIN, OWNER, ADMIN, MANAGER) — any customer in their
    inbox waiting > 30 min (`/inbox/waiting`), ≥ 5 conversations with complaint words today
    (`/inbox/chat-review?period=today`), a repeat complainer in the last 7 days (chat_review's
    rule). Everyone else — their OWN assigned chats waiting > 30 min (`/inbox/waiting?assigned=me`,
    a new param that only narrows the person's own scope). Debounce: `mcp_proactive_keys`, one
    claim per person + key + Malaysia day (complainers: once per 7 days).
  - **No phone numbers in email:** every customer label goes through `safeCustomer` (name, else
    masked number); snippets ≤ 60 chars with digit runs masked; failed-message rows and contact
    gaps are counted, never listed.
  - **Schedule:** the existing cron (`cron-worker/`, every 2 min → `POST /api/cron`) now also
    calls `runProactiveTick`. Bounded: ≤ 5 briefs + ≤ 5 alert checks per tick, 10 s budget,
    one person at a time; one brief per person per day (key `brief`), at most 3 attempts.
  - **Email:** Connect had no sender; new `src/lib/mail.ts` (Resend, as HRIS PR #115). Needs
    the `RESEND_API_KEY` secret on the Worker (`wrangler secret put RESEND_API_KEY`);
    `BRIEF_MAIL_FROM` is in `wrangler.toml`. Without the key: nothing is sent, the tick skips
    before any query, the settings card says so. Staging (`CONNECT_PREVIEW=1`) never sends.
    Every email is logged in `mcp_proactive_sends` (kind, items, provider id, status) — never
    the body. Unsubscribe: `/api/mcp/unsubscribe?t=…` shows one button; only the POST turns it
    off (mail scanners pre-open links).
  - Tables: migration `0029_mcp_proactive` + `ensure-mcp.ts` (runtime self-apply).
  - Tests: `scripts/smoke-mcp-proactive.mjs` (pure, in CI — 82 assertions: opt-in, due times,
    bounded ticks, alerts per role, debounce, HTML escaping / no phones / unsubscribe, mail
    switch with a fake fetch) and a 4d section in `scripts/smoke-mcp-db.mjs` (a real tick as an
    AGENT with a fake sender: one brief + one alert, tokens revoked, idempotent second tick,
    preview, rate-limited test brief, access removed → no mail, unsubscribe).
  - **Not yet proven on production:** no real email has been sent (no key set; never sent from
    a test). To try it after deploy + key: Settings → AI Connector → turn on → "Send me a test
    brief".
- **Round 5 — process help, "how do I …" (branch `feat/mcp-howto`, owner 2026-11-27; Claude
  only, no "?" button in Connect).** Pure, no Connect data read; every person gets them.
  - Tools: `how_to {question|topic}` (26 SOPs: agents — reply + 24-hour window, send a
    template, new conversation, assign / transfer, resolve / pending / queue, private note,
    contact Remarks, find a conversation, quick replies, contacts; supervisors — queue /
    overdue, reply-speed dashboard, chat review; admins — campaigns and broadcasts (EXPLAINED
    ONLY, `explainOnly`), templates, departments, team & roles, roles matrix, module access,
    AI Connector page, connect an AI app, morning brief; 3 click-by-click flows),
    `module_overview`, `glossary` (24-hour window, template, HSM, assignment, department,
    resolved …), `explain_error` (16 real messages), `onboarding {agent|supervisor|admin}`.
    Four prompts (`how_do_i`, `what_does_it_mean`, `explain_this_error`, `my_first_week`).
  - Each guide: purpose, prerequisites, who / permission, fields, click-by-click steps with
    `?highlight=` links, checkBefore, result, warnings, undo, approvals, deadlines, common
    mistakes, worked example (demo names only), related / next, contact, perCompany.
  - RBAC = Connect's current rules (`src/lib/mcp/howto-types.ts` `PAGE_GATES` + `needs`):
    modules (`resolveModules`), `requireAdmin`, Super-Admin-only actions, the company's role
    matrix (`connect.role_permission` over `DEFAULTS`, read in `server.ts howtoViewer`), the
    connector-admin rule. `canDo` false comes with a note naming the missing check. The chat
    review guide is shown to supervisors and admins only (`moodScanAllowed`), like the chat tools.
  - Business rules only where the code enforces them, each cited in a code comment (30-minute
    reply SLA `lib/sla.ts`, window = 24 h from the last inbound message `transport.ts`, Remarks
    max 2000, campaign approvers, Super-Admin-only role / access changes …).
  - `?highlight=<label>`: `src/components/shell/HighlightFromUrl.tsx` (mounted in the (app)
    layout) + `src/lib/highlight-match.ts` — outlines the element for ~6 s, also matches the
    same label in Chinese (dictionary lookup), never clicks.
  - Gap log: a question no guide answers is logged in `mcp_calls` with note `no-guide`
    (target = the question with numbers / emails removed) and listed on Settings → AI
    Connector → "Questions with no guide yet" (admin, last 30 days).
  - Tests: `scripts/smoke-mcp-howto.mjs` (pure, in CI): every page exists in `src/app`, every
    quoted label / highlight / field label exists in `src/` outside the help data, page gates
    equal the app's `requireModule` / `requireAdmin`, errors are the app's own text, flows
    name a role on every step, supervisor-only + explain-only hold, ranking (EN + 中文).
    `smoke-mcp-db.mjs` runs `how_to` through the real handler and checks the gap log.
  - **Round 5b (branch `feat/mcp-howto-screens`): `explain_screen {path|labels}`, `where_is
    {thing}`, `show_me {guide_id+step | path+label | label}`.** Screen map:
    `src/lib/mcp/howto-screen.ts` (12 screens, tabs + buttons, gates from `PAGE_GATES`).
    show_me returns the plain WebP (`public/help-shots/*.webp`, an MCP image block — never
    SVG) + the button's box + a 15-minute annotated link (`/api/mcp/shot`, page / label /
    expiry signed with HMAC-SHA256 under `SESSION_SECRET`; the page is an `<img>` with a CSS
    red box and arrow, no script) + the live `?highlight=` link. Only pages the person can
    open; the chat-review guide only for supervisors. how_to / where_is / explain_screen mark
    steps that have a picture (`showMe`).
  - Screenshots: `pnpm capture:help-shots` (`scripts/capture-help-shots.mjs`). Connect renders
    on the server, so data cannot be intercepted in the browser; instead the script starts a
    THROWAWAY local Postgres (initdb, trust, localhost) under `.verify/`, migrates it, seeds
    `scripts/help-shots-demo.ts` (invented "(demo)" people, 60100000xxx phones, example.com;
    refuses a non-localhost DB), writes a temporary `.dev.vars` (refuses if you have one),
    runs `next dev`, signs in with a locally minted session cookie as the demo Super Admin,
    aborts every non-localhost request in Playwright, boxes labels with the same
    `highlight-match.ts` the live helper uses, writes WebPs (1200 px) and
    `src/lib/mcp/howto-shots-data.ts`, then deletes the DB and `.dev.vars`. Tools are not app
    dependencies: `npm install --prefix .verify/tools --no-save playwright sharp esbuild`;
    needs PostgreSQL binaries (`PG_BIN`). Re-run after a UI change — the smoke fails on a
    stale box (a label that is no longer a target or no longer in `src/`).
  - Round 5 findings (app, not fixed here — owner to decide): (1) `/inbox`, `/contacts`,
    `/internal` and `/settings/auto-assign` have no `requireModule` guard: unticking a module
    hides the rail entry but the page still opens by URL (a DRIVER can open `/contacts`).
    (2) The inbox server actions (`app/actions.ts` sendMessage / assignConversation /
    setConversationStatus, `inbox/actions.ts`) check only the company, not the org-chart
    visibility, nor the Roles page's "Reply to customers" / "Assign chats" capabilities —
    those two matrix cells are not enforced anywhere. (3) `templates/actions.ts`
    submitTemplate / removeTemplate only require a signed-in member (the Templates page needs
    the settings module). (4) Any member can delete a contact (`contacts/actions.ts
    deleteContact`, company check only).
- **Not yet proven on production:** a real Claude / ChatGPT connection, and the
  sign-in → back-to-Allow hop (needs a real ERP login). First production use creates
  the tables through ensure-mcp.

## 0. 2026-09-14 — several WhatsApp numbers, each in its own company

**State before this change (read on production, read-only, 2026-09-14):** WhatsApp is
LIVE. The WABA carries two numbers: **+60 11-1110 8822** (Houzs Century, id
`1327476460438603`, CONNECTED, the `WHATSAPP_PHONE_NUMBER_ID` secret) and
**+60 18-310 7133** (Hookka, id `1219492597923127`, verified, not yet registered). Connect
had 2 companies (Houzs Century, 2990's Home), ONE channel (Houzs, no phone number id,
placeholder phone), 6 conversations, 33 webhook deliveries in 30 days — all to the Houzs
number. `connect.__drizzle_migrations` holds only `0000`: **nobody runs `pnpm db:migrate`
on production**; every later schema change reached it through the runtime `ensure*`
functions. Do not start running `db:migrate` against production without checking each
of 0001–0006 is idempotent first.

**The defect.** The webhook filed every message under the first company's default channel
and every send used the single secret number, whichever number the customer wrote to. The
inbox rail and the unread badge were also not company-scoped (owner/admin visibility is
`scope: "all"`), so a second company's threads would have shown in the first company's
rail. Registering the Hookka number would have put Hookka's customers in Houzs Century's
inbox and answered them from Houzs's number.

**What changed (branch `feat/multi-number-routing`):**
- `channel.phone_number_id` (migration `0006`, self-applied by `src/db/ensure-channel.ts`),
  unique, non-partial.
- `src/lib/whatsapp/channel-routing.ts` (pure, pinned by `scripts/smoke-channel-routing.mjs`
  in CI): a delivery goes to the channel holding the receiving number; every reply, media
  upload, voice note and contact card goes out from the conversation's own number. An
  unassigned number is REFUSED (`dropped:number-not-assigned:<id>` on System Logs — the
  raw delivery is kept), never guessed into a company. **Legacy case:** a channel with no
  id makes the default sender map to the first company's default channel; the fallback
  switches itself off the moment the number is assigned anywhere. _Since 2026-09-14 ~17:40
  MYT no channel relies on it: the Houzs channel holds its id — see "Houzs number assigned
  explicitly" below._
- Settings → Phone numbers: each number shows its company, and an owner/admin assigns it
  to an existing company or a **new Connect-only company** (no ERP id — the org sync never
  touches it). A number whose channel already has conversations is never moved.
- Register / verify / request-code / release / assign are written to `webhook_event`
  (`source = 'numbers'`, never the PIN or the code) with Meta's answer and the number's
  status read back from Meta right after the step — "I pressed Register and nothing
  happened" is now answerable from System Logs.
- Company switcher in the top bar (`src/lib/companies.ts`, `src/app/company-actions.ts`):
  members switch into companies where the ERP sync gave them a member row; an owner/admin
  can also enter a Connect-only company (a member row is created on first entry).
- Inbox rail and unread badge scoped to the session company (`conversationCompanyWhere`).

**To bring the Hookka number live (owner, on chat.houzscentury.com):**
1. Settings → Phone numbers → Hookka → Register for Cloud API with a six-digit PIN (write
   it down). The page now reports Meta's status after the call; expect CONNECTED.
2. Same card → Company → "New company…" → `Hookka` → Assign.
3. Top bar → Company → Hookka. Send a WhatsApp to +60 18-310 7133 from a phone; it must
   appear in Hookka's inbox (and System Logs must say "Saved to the inbox"). Reply; the
   phone must receive it from +60 18-310 7133.
4. ~~Optional: assign the Houzs number explicitly to Houzs Century~~ — done 2026-09-14, see
   "Houzs number assigned explicitly" below.

**Deployed 2026-09-14 (PR #14, deploy run 34813786110, head `c472d863d`):** DDL 0006
pre-applied on production and re-read on a fresh connection (text, nullable, unique
index). Probe: a synthetic delivery to an unassigned id `0000000000000000` was logged
`dropped:number-not-assigned:0000000000000000` with no contact created.

**Business profile (branch `feat/business-profile`):** every CONNECTED number's card has
"Edit business profile" — about (139), description (512), address (256), email, two
websites, category (Meta's vertical enum), a JPEG/PNG photo up to 5 MB (Resumable Upload
API; the app id is read from the token via `GET /app`, `WHATSAPP_APP_ID` overrides), and
display-name changes submitted for Meta review (after approval the number must be
re-registered with its PIN within 14 days; 10 changes per 30 days). Every save is logged
with Meta's answer (`source='numbers'`). The Graph calls are UNTESTED against Meta until
an owner saves a profile on production — the log will show the result.

Business profile shipped as PR #15 (deploy run 34814794974, head `e38aae02f`).

**Auto replies (branch `feat/auto-replies`):** Settings → Auto Replies, per company
(`connect.auto_reply`, migration `0007`, self-applied by `src/db/ensure-auto-reply.ts`).
A welcome during opening hours for a customer writing in fresh (first message, or first
after N hours of silence), and an away message outside hours, not repeated within N hours;
outside hours the away message wins and no welcome follows. Sent only when no automation
resumed or started on that message, and at most one per customer message; tagged on the
row as `interactivePayload.kind = 'auto_reply'` so the next decision can see it. Hours are
Malaysia time; a slot past midnight belongs to the day it started. Drafts (English +
Chinese) are pre-filled and start switched OFF — the wording and hours are the owner's.
Pinned by `scripts/smoke-auto-reply.mjs` (mutation-checked: letting a welcome follow the
away message fails it). All 11 Houzs automations were disabled on production on
2026-09-14, so nothing else replies alongside.

**Still open (updated 2026-09-14 evening):** Hookka is registered and assigned, and both
numbers are proven end to end (below). What remains is the owner's: fill both business
profiles (the editor was fixed in PR #20), review the auto-reply wording and hours and
switch them on per company, and set `WHATSAPP_APP_SECRET` (below). Then one phone test of
the auto replies.

**Webhook signature (branch `feat/webhook-signature`):** the webhook checks Meta's
`X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret) when
`WHATSAPP_APP_SECRET` is set on the Worker. Enforcement arms itself on the first delivery
that verifies (`|sig:valid` on the webhook_event row, looked up over 30 days, remembered
per isolate): before that an unverified delivery is accepted and marked, so a secret
pasted wrong cannot silently reject every real customer message. Once armed, an invalid
or missing signature gets 401 and a `rejected:signature-*` row without the forged body.
System Logs shows the state. **Owner action:** Meta App Dashboard → the WhatsApp app →
Settings → Basic → App secret, set as the Worker secret `WHATSAPP_APP_SECRET` on
`houzs-connect` (Cloudflare dashboard, never in chat or GitHub), then send one WhatsApp
message to a company number to arm it.

---

**End-to-end, PROVEN on production 2026-09-14 16:10 MYT:** Hookka registered (Meta
CONNECTED, TIER_250, logged `numbers:register:ok`), assigned to the new Connect-only
company Hookka (`numbers:assign:ok`). A phone sent "hi" to each number: Hookka's landed in
Hookka's inbox (new Hookka contact), Houzs's in Houzs Century's (legacy routing). Replies
from Connect went out from the right number (the sent/delivered/read status webhooks
arrived on each sending number) and reached READ.

**LANDMINE — Hyperdrive caches reads.** After the owner's first Assign succeeded,
Settings → Phone numbers kept showing NO COMPANY for ~2 minutes and three more Assign
presses were refused (the unique index stopped one of them putting Hookka's number on Houzs
Century). Hyperdrive caches read results (60 s default + stale-while-revalidate) and never
caches a query that calls a volatile/stable function. `src/db/fresh.ts` `bypassReadCache()`
(an always-true `now() is not null`) is added to the reads where stale is WRONG: routing,
company choices, number assignment, auto-reply decisions, the numbers page company list,
the status-snapshot dedupe, and the inbox rail / thread / unread badge (refreshed every
few seconds). Anything else still reads through the cache — add it where a stale answer
would be a bug.

**Business profile "cannot edit, cannot upload" (reported 2026-09-14, branch
`fix/profile-editing`).** No save or upload attempt was on record, and two causes were
found. (1) The photo control was the browser's file input plus an "Upload photo" button
disabled until a file was chosen — and Tailwind v4's preflight strips the file input's
button (measured: 0 border, transparent background, 0 padding), so "Choose File" rendered
as plain text beside the only real-looking button, which did nothing. It is now one
"Choose photo…" button (hidden input, the inbox composer's pattern) that uploads what is
picked. (2) Every save sent all six text fields, so a box left empty went to Meta as `""`
— and Meta's reference says the about line "cannot be empty" (the Houzs number's about was
empty). A save now sends only the fields that differ from what Meta holds at that moment
(`profileChanges`, pinned in `scripts/smoke-business-profile.mjs`, mutation-checked).
Every attempt is now logged, including ones stopped before Meta: `payload.stage` is
`read` / `connect` / `meta`, and System Logs says "Not sent to Meta — Connect stopped it"
rather than blaming Meta. An action that cannot be reached shows a message instead of
crashing the page. The editor was exercised in a local harness (real component, stubbed
actions); the Graph calls themselves are still UNTESTED until an owner saves on
production — the log row will show Meta's answer. Shipped as PR #20 (deploy run
34829208217, Worker version `e6c2e289`); the live `settings/numbers` chunk carries
"Choose photo…" and no "Upload photo".

**Houzs number assigned explicitly (2026-09-14 ~17:40 MYT, guarded write on production).**
The Houzs Century channel `qcml91i8d47vzpo15ik734jm` had `phone_number_id` NULL, so its
number reached it only through the legacy default (`WHATSAPP_PHONE_NUMBER_ID` + "oldest
company's default channel"); it also carried a placeholder `phone` `601161556133` (shown
as the sender number in the campaign composer) and `mode` `DEMO` (not read anywhere). A
plan/apply script — transaction, row lock, refusing unless the channel was still
unassigned, still the oldest company's default channel, and no channel already held the id
— set `phone_number_id = 1327476460438603`, `phone = 601111108822`, `mode = LIVE`: the
fields "Assign explicitly" writes for this case, except `display_name`, left as
"Houzs Century Sdn Bhd". No `webhook_event` row was written for it (System Logs would have
called it "Meta accepted it", and Meta was not involved). Re-read on a fresh connection;
then the real `pickInboundChannel` / `senderIdForChannel` run on the production channel
table routed Houzs → Houzs Century from `1327476460438603` and Hookka → Hookka from
`1219492597923127`, both `legacy=false`, with the env default set to either id or unset,
and refused an unknown id. Routing no longer depends on `WHATSAPP_PHONE_NUMBER_ID` at all.
To undo: set the three columns back on that one row.

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
7. **Turn on the ERP → Connect sender** (this, not the Google Sheet, is the cut-over).
   The ERP's Delivery Planning board "Send Now" already posts to
   `/api/webhooks/erp` (ERP `backend/src/services/connect.ts`, sending `x-connect-key`).
   It answers 503 until the ERP Worker has `CONNECT_WEBHOOK_URL` and
   `CONNECT_WEBHOOK_KEY`; the key must equal Connect's `ERP_WEBHOOK_SECRET` (§6).
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
`SYNC_ADMIN_TOKEN`, `ERP_WEBHOOK_SECRET`, `DRIVER_WEBHOOK_SECRET`, `ERP_CALLBACK_KEY`, and
(once live) the four `WHATSAPP_*` values. `DATABASE_URL` in `.dev.vars` is for scripts only.

`ERP_CALLBACK_KEY` is the OUTBOUND one: the delivery flows' `call_rest_api` nodes send it as
`X-Chat-Key` to `{callback_url}` (the ERP's `/api/chat-callback`), referenced from the node's
headers as `{secret:ERP_CALLBACK_KEY}` (`src/lib/automation/rest.ts` resolves only the names
in `REST_HEADER_SECRETS`, never from a contact attribute). It must equal the ERP Worker's
`CHAT_CALLBACK_KEY`; unset, every callback 401s and the run log shows `missingSecrets`.

Same-zone gotcha: `erp.houzscentury.com/api/*` is a Workers **Route** on a Pages origin, and
a Worker's `fetch()` to its own zone bypasses Routes (Cloudflare docs). Connect therefore
runs with the `global_fetch_strictly_public` compatibility flag (wrangler.toml) — and, because
that still left the callback POST dying as an empty 400 before the ERP worker, the engine now
calls `erp.houzscentury.com` over a **Service Binding** (`[[services]] ERP -> autocount-sync-api`,
`src/lib/automation/rest.ts` RestBindings). Keep both.

The two webhook secrets guard `POST /api/webhooks/erp` and `/api/webhooks/driver`
(`src/lib/webhook-auth.ts`). Callers send `x-connect-key: <secret>` or
`Authorization: Bearer <secret>`; a wrong or missing key is 401. If a secret is not
set, that endpoint refuses every call with 503 (and logs why) unless
`WHATSAPP_MODE=DEMO`.

```bash
wrangler secret put ERP_WEBHOOK_SECRET
wrangler secret put DRIVER_WEBHOOK_SECRET
wrangler secret put ERP_CALLBACK_KEY   # = the ERP Worker's CHAT_CALLBACK_KEY
curl -X POST https://chat.houzscentury.com/api/webhooks/erp \
  -H 'content-type: application/json' -H 'x-connect-key: <ERP_WEBHOOK_SECRET>' \
  -d '{"phone":"60123456789","automation":"New Delivery Follow-up"}'
```

**Outstanding security item:** the Hyperdrive/Supabase password for Connect is still the
temporary one set during cutover and should be rotated.

---

## 7. For the next owner

In rough priority order:

1. **ERP delivery-planning → Connect.** The sender now exists in the ERP
   (`backend/src/services/connect.ts` + `scm/routes/delivery-messages.ts`, ERP PRs
   #4336 / #4340 / #4402): the board's "Send Now" posts one bundled event per customer
   phone to `/api/webhooks/erp` with `x-connect-key`, firing "New Delivery Follow-up";
   the customer's tap returns to the ERP's `/api/chat-callback` (`X-Chat-Key` /
   `CHAT_CALLBACK_KEY`). It is a manual send from the board. Still missing: automatic
   sends from `trips.ts`'s status transitions, and a
   **WhatsApp follow-up sub-status** on the ERP side, because the ERP's coarse
   `delivery_state` (PENDING_DELIVERY / PENDING_SCHEDULE / OVERDUE / DELIVERED) cannot drive
   the Sheet's finer state machine (To Send Delivery Date / To Remind Customer Reply /
   Pending Reschedule / Done Balance Collection / …). `docs/seampify-research.md` has the
   full payload contract.
2. ~~**Authenticate the inbound webhooks.**~~ Done: `/api/webhooks/erp` and
   `/api/webhooks/driver` require `ERP_WEBHOOK_SECRET` / `DRIVER_WEBHOOK_SECRET` (§6).
   The ERP sender in item 1 already sends `x-connect-key` (ERP secret `CONNECT_WEBHOOK_KEY`).
3. **A real LLM behind `AI Agent Reply`** — `src/lib/ai.ts` is designed to be swapped
   without touching the node. Consider reusing the ERP's existing trainable-agent rules
   rather than maintaining a second set.
4. **Missing Seampify modules** — Drip Campaign, Ecommerce, System Logs.
5. **Close the §3 approximations** — a native WhatsApp Flow form node, template
   registration, and mapping assign_to_user to Connect members.
6. **2990's channel** — it has no WhatsApp number of its own yet.
7. Nice-to-have: an auto-layout button in the builder (the migrated canvases inherit
   Seampify's original, fairly scattered node coordinates).
