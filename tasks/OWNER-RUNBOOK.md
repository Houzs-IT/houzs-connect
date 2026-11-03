# Houzs Connect — Owner runbook (turning it on)

The human-only steps to switch features on in production (`chat.houzscentury.com`).
These are **configuration, not code** — the code ships via deploy.yml; these are
the secrets, toggles and reviews only the owner can do. In rough order of value.

Secrets go on the **Worker**, never in chat or GitHub: Cloudflare dashboard →
Workers & Pages → the worker → Settings → Variables and Secrets, or
`wrangler secret put <NAME>`.

---

## 1. Scheduler — `CRON_SECRET` on BOTH workers  *(enables Delay, scheduled campaigns, Drip)*

Nothing time-based runs until this is set. It drives three things that otherwise
never fire on their own: automation **Delay** nodes, **scheduled campaigns**, and
**Drip campaigns**.

A dedicated worker `houzs-connect-cron` fires every 2 minutes and calls the main
app's `/api/cron`, authenticated with a shared key. Both workers need the **same**
value:

```bash
# pick one long random string, use it for both
wrangler secret put CRON_SECRET                                   # houzs-connect
wrangler secret put CRON_SECRET --config cron-worker/wrangler.toml   # houzs-connect-cron
```

**Verify:** wait ~2 minutes, then System Logs → filter source `cron`. A tick that
did work logs `cron:tick:ok` (a tick with nothing due logs nothing, to keep the
log readable). Until the secret is set, `/api/cron` answers 503 and the cron
worker is a no-op.

## 2. Webhook signature — `WHATSAPP_APP_SECRET`

Lets the webhook reject forged deliveries (checks Meta's `X-Hub-Signature-256`).

- Meta App Dashboard → the WhatsApp app → Settings → Basic → **App secret**.
- Set it as the Worker secret `WHATSAPP_APP_SECRET` on `houzs-connect`.
- Send one WhatsApp message to a company number to **arm** it; System Logs shows
  the state. (It arms on the first delivery that verifies, so a mistyped secret
  can't silently reject every real message.)

## 3. Business profiles

Settings → Phone numbers → each CONNECTED number → **Edit business profile**:
about / description / address / email / websites / category / photo. The about
line cannot be empty. Each save is logged with Meta's answer (System Logs).

## 4. Auto replies — review and switch on

Settings → Auto Replies, **per company**. The welcome and away drafts (EN + ZH)
ship **off**; review the wording and the business hours, switch them on, then
send one test message from a phone.

## 5. Automation flows — publish

Automations → open each flow in the builder → review → **Publish**. Flows ship as
Draft; a Draft flow never runs. (A flow with a Delay node only resumes once step 1
above is done.)

## 6. Drip campaigns — create and go live

Drip Campaigns → **New drip** → add steps (each: a delay, an approved template,
and optionally "remove if they reply") → **Go live**. Enrol contacts from an
automation's *Add to drip* node or the inbox conversation menu's *Add to drip*.
Steps send on the schedule once step 1 is done. A company with no WhatsApp number
can't create a drip (see step 8).

## 7. Rotate the temporary database password

The Hyperdrive/Supabase password for Connect is still the temporary one set during
cut-over. Rotate it in Supabase, then update the Hyperdrive config / `DATABASE_URL`
on the Worker.

## 8. 2990's Home — give it a WhatsApp number

The company exists but has no channel, so it can't send, run flows or hold a drip.
Settings → Phone numbers → assign it a number before using it.

---

_Reference: `tasks/HANDOFF.md` (full history) and `tasks/DEPLOY-RUNBOOK.md`
(deploy mechanics). The scheduler, Delay-resume and Drip pieces referenced above
ship in PRs #131 and #132._
