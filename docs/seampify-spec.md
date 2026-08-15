# Seampify — observed behaviour, for parity work

Recorded 2026-08-15 by clicking through the owner's live Seampify account
(waba.seampify.com). Everything below was **seen**, not inferred. Where I did
not open a screen, it says so.

This is the reference for "跟 Seampify 一模一样". Read it before designing.

---

## 1. Template variables are bound at SEND time, not at CREATE time

This is the answer to "1 号、2 号、3 号、4 号对接的是什么资料".

**Creating a template** (Settings → Channels → Message Templates → Create
Whatsapp Template → Use a blank template) does NOT bind variables to data. The
editor has:

- Name\* (0/512 counter) · Language\* dropdown · Category\* dropdown
- "Select Utility Template": **Standard | Carousel | Call Permission Request | Request Contact Info**
- Header dropdown (default None)
- Body\* — rich editor, toolbar: **B**, *I*, **S**, emoji, ⓘ, **+ Add Variable**, 0/1024 counter
- **+ Add Variable inserts the next positional token** — `{{1}}`, then `{{2}}`, …
- A **"Samples for body content"** block appears once a variable exists: one
  input per variable, labelled `Example content for 1*`. Helper text says:
  *"To help us review your message template, please add an example for each
  variable in your body text. Do not use real customer information."* — these
  are Meta's `example.body_text` values, for review only.
- Footer (Optional), 0/60 counter
- Right column: a **live WhatsApp phone preview** that updates as you type
- Footer bar: **Copy as cURL** · Cancel · **Submit For Approval**

**Binding happens in the campaign wizard, step 4.** After picking a template it
renders:

```
Template Header
  Order Update from Houzs Century
Template Body
  Hi {{1}} , this is the Customer Service Team from Houzs Century.
  ... {{2}} ... {{3}} ... {{4}} ...

Placeholder {{1}}   [ Placeholder Name* ]  [ Attribute Placeholder ▾ ]
Placeholder {{2}}   [ Placeholder Name* ]  [ Attribute Placeholder ▾ ]
Placeholder {{3}}   [ Placeholder Name* ]  [ Attribute Placeholder ▾ ]
Placeholder {{4}}   [ Placeholder Name* ]  [ Attribute Placeholder ▾ ]
```

Two fields per placeholder: a human label, and a dropdown binding it to a field.
A live preview on the right renders the resolved message including buttons and
footer.

**"Attribute Placeholder" dropdown, in observed order:**

Phone Number · Full Name · First Name · Last Name · Company · Email · Address ·
City · State · Zipcode · Remarks · Is Dialogflow Bot · Last Message Assigned To
Name · Last Message Assigned To Email · Last Message Assigned To Phone · Last
Message Assigned To Department Name · In Queue · Tags · Source Id · Source Url ·
Source Type · Reference N… *(list continues into custom attributes; I did not
scroll to the end)*

Note it mixes **contact fields**, **conversation fields** (last assigned agent,
in queue) and **custom attributes**.

---

## 2. Campaign creation is a 6-step wizard

`Campaigns → + Create Campaign` (the button has a split dropdown arrow whose
menu I did not open).

1. **Add Campaign Name** — 0/150 counter, a green **Dos** / red **Donts** panel
   ("Keep campaign names under 50 characters", "Avoid spamming your audience…"),
   and an "⊕ Advance Configuration" disclosure (not opened).
2. **Select Sender** — a card per WhatsApp channel; validates "Select a channel".
3. **Select Contacts** — **Upload Contacts** (CSV) **OR** *Filter Existing
   Contacts*: a table with a **Filter** button and columns
   `Phone · Email · Tags · Name · Blocked · Company · Remarks`,
   pager with a **Show items** size selector. The owner's account showed
   **417 pages × 10 = ~4,170 contacts**.
4. **Select Template** — searchable dropdown showing `name (language)`, a
   refresh icon, and **Create Template ↗** which opens the template editor.
   Then the placeholder binding described above.
5. **Test Send** — send to yourself before the blast. *(Not opened — I stopped
   rather than send a real message.)*
6. **Review Campaign** — final confirmation. *(Not opened.)*

Campaign list columns: `Name (+ IMMEDIATELY badge) · Channel · Total Contacts ·
Schedule Time · Running Since · End Time · Status · Approval Request · Action ⋮`,
plus Search and a Date Range filter. Real rows showed 418 contacts, status
`completed`.

Our current Campaigns page is one form with a free-text template name and a
single "Send broadcast" button. Steps 1, 4, 5 and 6 have no equivalent.

---

## 3. Templates list

Buttons: **+ Create Whatsapp Template** · **Synchronize with Facebook**.
Filters: Search · Category · Language · Status · date range ("Last 7 Days").
Columns: `Template Name · Category · Language · Status · Message delivered ⓘ ·
Message read rate ⓘ · Created By · Last edited · Actions ⋮`, plus a **View
insights** link per row.

Real data: **64 templates**, most `APPROVED`, with real counters — e.g.
`sales_pic_update` 404 delivered / 65.10% (263) read.

**Two brands share the account**: templates exist in Houzs Century and
`_2990` variants for *2990 HOME SDN. BHD.*, each with its own bank details. This
is why the ERP org sync fans one person out to several companies.

⚠️ Several approved templates embed **live bank account numbers**. Those must
never enter source control — this is why `starterTemplates.ts` excludes the
balance-collection templates.

---

## 4. Conversation right panel (Chat)

Observed order, top to bottom:

`Profile Details` (✕ close) · avatar + name + **Edit** · **Basic Details** +
**Add Group** · phone + copy icon · **Tags** + Add (chips with ×) ·
**Conversation Status** (dropdown) · **Remarks** (free text) · **Enable
marketing messages** toggle with helper text *"Send marketing template messages
to this contact."* · **Add Chat Members** + Add · **Assigned Agent** +
**Unassign** · **Assigned Department**.

**Assigned Agent is a SINGLE-select dropdown.** Multi-person is a separate
feature called **Add Chat Members**. The two are not the same thing.

Thread header: SLA timer badge (`10h 39m`), a favourite star, and a ⋯ menu.
Rail rows carry an SLA badge in `0h 15m 37s` form.

Missing in Connect: Add Group, Remarks, Add Chat Members, profile Edit, copy
phone, favourite star.

---

## 5. Nav

Seampify: Dashboard · Chat · Contacts · WhatsApp Forms · Campaigns · **Drip
Campaign** · Automations · Ecommerce · Settings · System Logs.

Connect: Dashboard · Inbox · Contacts · Automations · Payments · Campaigns ·
Templates · WhatsApp Forms · System Logs · Settings.

The owner has said Ecommerce is not needed. **Drip Campaign has no Connect
equivalent** and was not explored.

Channel settings tabs (Settings → Channels → a channel): Profile · Settings ·
Message Templates · Buttons/Flows/Options/Products Messages · Whatsapp Flows ·
Whatsapp Store Settings · Calls · Webhooks. Only Message Templates was opened.

---

## Not explored

Drip Campaign · WhatsApp Forms · Ecommerce · System Logs · Dashboard ·
Contacts page proper · the other channel-settings tabs · campaign wizard steps
5–6 · "Advance Configuration" · the Create Campaign split-button menu ·
"Browse the WhatsApp template library".
