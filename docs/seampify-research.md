# Seampify — Full Feature Inventory (reverse-engineering notes)

Source: live walkthrough of `waba.seampify.com` logged in as **Houzs Century Sdn Bhd**.
Date: 2026-07-28. Goal: build a 1:1 replica.

Seampify = **WhatsApp Business API (WABA) platform**: team inbox + CRM + marketing
automation + broadcast campaigns + drip sequences + no-code flow builder + WhatsApp
commerce + forms. Competitor class: Wati / AiSensy / Interakt / Respond.io / DoubleTick.

## Top-level navigation (left sidebar)
| # | Module | Route | Purpose (first pass) |
|---|--------|-------|----------------------|
| 1 | Dashboard | `/dashboard` | analytics overview |
| 2 | Chat | `/chat` | team inbox / live agent chat |
| 3 | Contacts | `/contacts` | CRM contact list + attributes/tags |
| 4 | WhatsApp Forms | `/whatsappform/forms` | native WhatsApp lead/data forms |
| 5 | Campaigns | `/campaign` | one-off broadcast blasts |
| 6 | Drip Campaign | `/drip-campaigns` | scheduled multi-step sequences |
| 7 | Automations | `/automations` | trigger→action flow builder |
| 8 | Ecommerce | `/ecommerce` | WhatsApp catalog / cart / orders |
| 9 | Settings | `/settings/channels` | channels, templates, team, billing |
| 10 | System Logs | `/system-logs/message` | message/delivery/webhook logs |

Top bar: Language switch (ENGLISH), Notifications (badge 5), Settings gear, Profile, analytics icon.
Account: multi-company (shows "Houzs Century Sdn Bhd" per automation — supports multiple WABA numbers/companies).

---
## Module details

### 1. Dashboard (`/dashboard`) — 4 report tabs
- **Overview** — date range picker (Last 7 Days…). Two sub-tabs:
  - *Message Analytics*: WhatsApp conversation billing broken out by Meta category —
    All deliveries, Marketing, Marketing-Lite, Utility, Authentication,
    Authentication-international, Service; Free vs Paid deliveries (free customer
    service / free entry point); **Approx. Charges in MYR** per category. Plus
    **Engagement** time-series + **New Contacts** time-series. Export SVG/PNG/CSV.
  - *Calling Analytics* (WhatsApp calling metrics).
- **Support** — helpdesk KPIs: Total/Open/Closed Conversations, Bot-Assigned, Agent
  Open, In Queue, Closed-by-Bot, Closed-by-Agent, Chats Dropped, Queue Abandonment,
  Agent Assigned (time-series). **Agents Report** table (per agent: Assigned/Open/
  Closed / Avg Closing Time / Avg First Response / Avg Response / **Avg CSAT**),
  filter by Department + Agent. **Agent Timesheet** (login/logout/online/offline
  durations per day, Export).
- **Marketing** — Recent Campaigns table (Name, Channel, Total Contacts, Template
  Name, Schedule/End time, Sent/Read/Failed, Status) + Recent Drip Campaigns.
- **Live Reporting** — realtime: Total/Online/Offline Agents, Avg First Response /
  Response / Closing Time, **Live Agent Queue**, **Live Agent Report** (per agent
  concurrency limit, currently-assigned count, ONLINE/OFFLINE status).
- Observed team = 8 agents across departments; per-agent **concurrency** limit config.

### 2. Chat (`/chat`) — collaborative team inbox (the core UX)
- **Left rail**: start new convo by number (+60 country picker) / add contact; **WhatsApp
  number (channel) switcher** for multi-number accounts; filter button; refresh.
  Status tabs: **All / Unread / Open / Closed / Queue** (+ more via arrow). Convo cards
  show avatar + unread count badge, name, last-msg preview, read-receipt double-tick,
  **assignment tag** (agent) and **SLA/response timer** (e.g. "0h 21m 8s"), company tag.
- **Center (conversation)**: WhatsApp-style bubbles; bot messages tagged `@Bot`
  (bot↔human handover); read receipts; header shows contact + company, **24h customer
  service window countdown** (e.g. "23h 49m"), favorite star, `...` actions menu.
  Two composer modes: **Reply** (to customer) vs **Private Comments** (internal notes).
  Composer: attachments (+), **`/` slash → Quick Reply / canned messages**, voice note, send.
- **`...` conversation menu**: Mark Unread/Read, **Mark as Block**, **Assign Contact**,
  **Push Chat to Queue**, Unassign, **Important Contact**, **Add To Drip Campaign**,
  Delete Contact, Copy Contact ID.
- **Right panel — Profile Details**: edit contact; phone (copy); **Add Group**; **Tags**
  (add/remove); **Conversation Status** (Open/Closed/…); **Remarks**; **Enable marketing
  messages** opt-in toggle; **Add Chat Members** (collaborators); **Assigned Agent**
  (+Unassign) and **Assigned Department**; **Contact Attributes** = custom fields synced
  from ERP (Reference No, Sales Person, Client Delivery Date, House Type, New House,
  Disposal Item, Address State, Brand, …). → this is the ERP "跟单/follow-up" surface.
- Implies: WhatsApp 24h session-window handling, bot/agent handover, queueing +
  round-robin assignment, departments, canned/quick replies, private notes, CSAT.

### 3. Contacts (`/contacts`) — CRM list
- Table columns: Name, Phone, Email, **Source / Source Id / Source Url** (lead-source
  attribution), Tags. Row avatar. Bulk-select checkboxes → bulk tag / campaign / export.
- Toolbar: number search, advanced filter, **Channels** selector (per WhatsApp number),
  **Tags** filter, Remove-tag. **Add Contact** split-button → **Import CSV / Export**.
- Custom contact attributes live per-contact (defined in Settings), surfaced in Chat panel.

### 4. WhatsApp Forms (`/whatsappform/forms`) — **Meta WhatsApp Flows** manager
- Tabs: **Forms** / **Responses**. Table: Name, Status (Draft/Published), Created Date,
  Actions = **Analytics / Preview / JSON / ⋮**. **Sync** with Meta; per-Channel.
- Preview opens `business.facebook.com/wa/manage/flows/<id>/preview` → these are native
  Meta WhatsApp Flows (interactive in-chat forms). Use case here: delivery-date / date
  arrangement scheduling forms. Replica needs the WhatsApp Flows API (Flow JSON + data
  endpoint) — build/host/publish flows + capture responses back onto the contact.

### 5. Campaigns (`/campaign`) — one-off broadcasts
- List: Name, Channel, Total Contacts, Schedule Time (IMMEDIATELY / scheduled),
  Running Since, End Time, Status, Approval Request (optional approval gate), Action.
  Date-range filter, search. 82 campaigns in this account.
- Create = 6-step wizard: 1) Campaign Name (+ Advance Configuration) 2) Select
  Sender (channel) 3) Select Contacts (audience by tag/filter/CSV) 4) Select Template
  (approved WA template + variable mapping) 5) Test Send 6) Review + schedule/approval.

### 6. Drip Campaign (`/drip-campaigns`) — scheduled sequences
- Builder = vertical timeline of steps. Each step: Select Unit (Minutes/Hours/Days) +
  After N (delay from previous) + message content + Remove-From-Campaign-After-Replied
  toggle. Name + Save. Contacts enter via Chat menu / automation node.

### 7. Automations (`/automations`) — no-code flow builder (hardest module)
- List cards: name, channel, trigger event + description, active toggle, kebab =
  Edit / Duplicate / Analytics / Delete. Toolbar: Add New Automation, Automations
  Report, Import Automation Template, search, All/Active/Inactive filter.
  ~30 live automations (all the ERP follow-up flows).
- Create/Edit settings: Title, Channel, Event (trigger), Description,
  Fallback Automation, Disable Automation on Assignment.
- TRIGGER CATALOG: Msgs (New Outgoing / New Incoming / New Incoming From New
  Contact / New Voice Call); Widget (New Web Widget); Conversations (Conversation
  Closed); Tags (When Added / When Removed); Contacts (contact field updated);
  Payments (Payment Received on WhatsApp); Social (Comment on a Post); Technical
  (Webhook Received).
- Flow canvas (`/automation-flow/<id>`): node graph, pan/zoom; toolbar = Live/Draft,
  Run (test), Actions (node palette), History (versions), Export, Save As Draft, Publish.
- NODE PALETTE (full action set to replicate):
  - Starting Point: Trigger Node
  - Workflow: Criteria Router (multi-rule branch Field/Operator/Value + "not matches
    any" fallback), Jump To Automation, Delay Execution (N min/hr/day)
  - Messaging: Auto Reply Template Message, Auto Reply Buttons/Options/Products,
    Auto Reply and Collect User Inputs (save to attribute; validation-failed +
    no-response-timeout branches), AI Agent Reply
  - Customer Interaction: Add/Remove Drip Campaign, Add/Remove Campaign, Add Contact
    to List, Set Contact Attribute, Set Conversation Status, Send Email Notification,
    Mark Blocked, Forward Call, Terminate Call, Assign To Team Member, Unassign From
    Team, Marketing Opt-in/Opt-out
  - Security: Hide The File, Mask Text via Regex
  - Technical: Call REST API (POST/GET external URL — the ERP bridge), Meta Conversion
    Event, Eval (expression/JS)
  - Tagging: Add Tags, Remove Tags
  - WhatsApp Chat Commerce: Send Cart Confirmation Message, Send WhatsApp Notification
  - Google Sheets: Add new row in google sheet
  - CSAT: Start / End / Capture CSAT
- Real logic observed (delivery follow-up flow): interactive date-picker buttons ->
  Set Attribute (delivery_date_1, delivery_message_status_1) -> collect House Type
  (Landed/Condo/Apartment), New House (Move-in/Replace), Disposal (Yes/No + item) ->
  Call REST API to a Google Apps Script /exec endpoint (ERP sync) -> Criteria Router
  on button_status (Confirm/Amend/reset/unset) & Amount==0 -> Add Tags (scheduling,
  balance collection) -> Delay 1 day -> balance-payment reminder w/ bank details. Merge
  vars {full_name}{ref_1}{delivery_date_1}{amount}; Action-Callback-Id-Matches triggers
  for interactive button callbacks.
- ARCH NOTE: ERP<->Seampify today = inbound Webhook Received automations + outbound
  Call REST API -> Google Apps Script. A replica can keep the seam or wire the ERP
  directly (this is the follow-up/跟单 engine the whole account exists for).

### 8. Ecommerce (`/ecommerce`) — WhatsApp commerce
- Tabs: **Orders / Products / Catalog Settings**. Catalog Settings = "Authorize Facebook
  to Connect Catalog" (Meta Commerce/product-catalog sync). Not connected for Houzs.
- Products = synced Meta catalog; Orders = WhatsApp cart/checkout orders. Pairs with the
  automation "Send Cart Confirmation Message" node. Low priority for Houzs replica.

### 9. Settings (`/settings/*`)
- **Personal**: My Profile, Security & Password, Notifications.
- **Business**:
  - General Settings (business-wide config, business hours/away likely).
  - **Roles & Permissions** — RBAC role editor.
  - **Teams** — agent teams (the 8 agents seen).
  - **Departments** — routing departments.
  - **Quick Replies** — canned/slash `/` replies used in Chat composer.
  - **Contact Fields** — custom-attribute schema editor. Houzs has **63 fields**, all
    Text(Single Line): reference_no, brand, purchase_venue, sales_person, delivery_state,
    office_contact, message_status, client_delivery_date, delivery_time,
    delivery_message_status, drivers_name/contact/ic, car_plate, house_type, new_house,
    renovation, disposal, disposal_item, delivery_confirmation, reschedule, visiting_time,
    address_state, amount, response, ref_1/2/3, brand_1/2/3, sales_location_1/2/3,
    venue_1/2/3, sales_agent_1/2/3, delivery_date_1/2/3, delivery_message_status_1/2/3,
    order_total, send_status, amend_date_reason(+_2), date_amended, new_delivery_date,
    button_status, sales_person_2, send_status_1_day, automation, replied_check,
    got_amend_date(+_2/_3). → `_1/_2/_3` = up to 3 orders per contact. THIS IS THE
    DOMAIN MODEL of the follow-up engine. Create Contact Field supports multiple types.
- **More**:
  - **Channels** — WABA numbers. Per channel: Settings, **Manage Templates** (WA message
    templates CRUD + Meta approval), **Interactive Messages** (button/list templates),
    **Manage Profile** (WA business profile). Create Channel. Multi-number capable.
  - **Billing** — wallet / subscription / conversation-charge billing.
  - **File Manager** — media library for template/message assets.
  - **Integrations** — marketplace (~25): Zoho CRM/Books/Inventory, WooCommerce, Shopify,
    Salesforce, HubSpot, Dialogflow, ChatGPT Assistant, DeepSeek, **Google Sheets**
    (configured), Calendly, Acuity, Stripe, Razorpay, PhonePe, QFPay, Shiprocket, ShipWay,
    RapidShyp, FreshDesk, IndiaMart, Tally, WebEngage, goCatalogo. Houzs uses Google Sheets.

### 10. System Logs (`/system-logs/*`) — 6 tabs
- **Message History** (Customer/Number/Email/Message/Type[text|interactive|template]/
  Direction/Created At/**Send Status** sent·delivered·read·failed; Advance Filter,
  Channel, date range, **Export**), **Conversations**, **User Activity** (agent audit),
  **System Logs** (automation/webhook execution logs), **Call Logs**, **Downloads**
  (async export jobs).

---
## Platform identity / stack signals
- Seampify = India-origin WABA SaaS (default +91, Razorpay/PhonePe/IndiaMart/Tally in
  integrations). Meta WhatsApp Cloud API partner. Class: Wati/AiSensy/Interakt/DoubleTick.
- Multi-tenant (per-company workspaces), multi-channel (many WABA numbers per workspace).

## What a 1:1 replica must contain (build scope)
CORE PLATFORM
1. **WhatsApp Cloud API integration layer** — send/receive messages, templates,
   interactive (buttons/list/flows), media, read receipts, 24h session window, webhooks
   from Meta. (Requires a Meta WABA + Cloud API access token; or an on-send BSP.)
2. **Team inbox** — realtime conversation list, status (open/closed/queue), assignment
   (agent/department/round-robin + concurrency), private notes, quick replies, tags,
   SLA timers, bot↔agent handover, CSAT.
3. **Contacts CRM** — contacts + typed custom attributes (schema editor), tags, lists,
   source attribution, import/export.
4. **Broadcast Campaigns** — 6-step wizard, audience targeting, template + var mapping,
   test send, schedule, optional approval, delivery analytics.
5. **Drip Campaigns** — delayed multi-step sequences, remove-on-reply.
6. **Automation flow engine** — trigger catalog + node graph runtime + versioning
   (draft/publish) + the full node palette (see §7). This is the biggest build.
7. **WhatsApp Forms** — Meta WhatsApp Flows build/publish/response capture.
8. **Analytics/Dashboards** — message billing, support KPIs, agent live status, CSAT.
9. **Settings** — RBAC, teams, departments, channels, template manager, quick replies,
   custom-field schema, billing, file manager, integrations, webhook/REST hooks.
10. **Ecommerce (optional)** — Meta catalog + cart orders.

## Houzs-specific note (important)
- This whole account exists as Houzs's **order follow-up (跟单) engine**: ERP → webhook →
  automation → WhatsApp customer conversation → collect delivery date / house type /
  disposal / balance payment → Call REST API back to a Google Apps Script → ERP.
- Desktop already has `chatwoot-whatsapp-poc` (a Chatwoot-CE-based Seampify-REPLACEMENT
  evaluation). A "build the same thing" effort should reconcile with that POC — either
  extend Chatwoot (fastest path to the team-inbox+automation base) or build fresh.
- Decision needed from owner: full generic 1:1 clone, vs. a Houzs-tailored follow-up app
  that only implements the slice Houzs actually uses (inbox + automations + contact
  fields + campaigns + WhatsApp Flows), wired straight into the ERP instead of via GAS.
