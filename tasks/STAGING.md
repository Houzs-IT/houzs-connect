# Staging

`houzs-connect-staging` is a second Worker on its own Supabase project. It shows a yellow
STAGING strip and runs WhatsApp LIVE on the company number, fenced by `CONNECT_STAGING=1`
(`src/lib/staging-fence.ts`, pinned by `scripts/smoke-staging-fence.mjs`):

- it messages only the phones in its `STAGING_ALLOWED_PHONES` secret (unset = nobody);
- `call_rest_api` reaches only the ERP staging Worker (`houzs-erp-staging.pages.dev`,
  `autocount-sync-api-staging.houzs-erp.workers.dev`) - never production or a live Sheet;
- nothing that changes the WhatsApp account (templates, numbers, business profile, Flows)
  is sent to Meta; reads still work.

Meta delivers every reply for the number to production's webhook, so production forwards
the deliveries of the phones in its `STAGING_RELAY_PHONES` secret to staging, untouched and
with Meta's signature (System Logs: `relayed:staging`). A delivery that also carries anyone
else stays in production whole. While a phone is on that list, its chats with the company
number happen in staging, not in production's inbox.

Publishing: push or fast-forward the `staging` branch; `.github/workflows/deploy-staging.yml`
applies new migrations to the staging database and deploys.

## One-time setup (owner)

1. Supabase (company account): new project `houzs-connect-staging`, region Singapore.
   Copy its session pooler connection string (port 5432).
2. In a terminal in this folder, create the Hyperdrive config (paste the string there, never
   in chat):

   ```bash
   npx wrangler hyperdrive create houzs-connect-staging-pg --connection-string="<staging pooler URL>"
   ```

   Put the printed id in `wrangler.toml` under `[[env.staging.hyperdrive]]` (it is not a secret).
3. GitHub → repo Settings → Secrets → Actions: add `STAGING_DATABASE_URL` = the same pooler URL.
4. Put `DATABASE_URL="<staging pooler URL>"` in `.dev.vars.staging` (git-ignored), then load
   the demo data and make your staging login; the password is printed once:

   ```bash
   pnpm staging:setup --seed --login you@houzscentury.com --name "Your Name"
   ```

   Staging has no ERP, so its logins live in its own `public.users`. After this first one,
   add testers in the app: Settings -> Team -> "Create staging login" (owners and admins,
   staging only), which shows the new person's password once. The same command with another
   `--login` (and `--role Admin`, `Manager`, `Agent`, ...) also works.
5. Push `staging` (first deploy creates the Worker). The address,
   `houzs-connect-staging.<account>.workers.dev`, is printed at the end of the workflow run.
6. Session key for staging logins (generated and sent straight to Cloudflare, never shown):

   ```bash
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put SESSION_SECRET --env staging
   ```

## LIVE testing with the ERP staging board (Delivery Planning -> Send Message)

Order matters: staging first, the production relay last. Run each `wrangler` command in the
folder named; it asks for the value and never echoes it. `<phones>` is the testers' numbers,
comma-separated (`60198765432,60123456789`).

1. Connect staging (this folder) - Meta credentials, the same values as production (Meta
   App Dashboard / WhatsApp Manager; the number id is `1327476460438603`, Houzs Century):

   ```bash
   npx wrangler secret put WHATSAPP_TOKEN --env staging
   npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID --env staging
   npx wrangler secret put WHATSAPP_WABA_ID --env staging
   npx wrangler secret put WHATSAPP_APP_SECRET --env staging
   npx wrangler secret put STAGING_ALLOWED_PHONES --env staging
   ```

2. The two shared keys between ERP staging and Connect staging, generated and sent to both
   Workers without being shown (Git Bash, from the folder that holds both repos):

   ```bash
   K=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") && (cd houzs-connect && printf %s "$K" | npx wrangler secret put ERP_WEBHOOK_SECRET --env staging) && (cd Houzs-Century-ERP/backend && printf %s "$K" | npx wrangler secret put CONNECT_WEBHOOK_KEY --env staging)
   ```

   ```bash
   K=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") && (cd houzs-connect && printf %s "$K" | npx wrangler secret put ERP_CALLBACK_KEY --env staging) && (cd Houzs-Century-ERP/backend && printf %s "$K" | npx wrangler secret put CHAT_CALLBACK_KEY --env staging)
   ```

3. ERP staging (`Houzs-Century-ERP/backend`) - where Send Now posts (not a secret value, but
   the ERP reads it as one):

   ```bash
   printf %s "https://houzs-connect-staging.houzs-erp.workers.dev" | npx wrangler secret put CONNECT_WEBHOOK_URL --env staging
   ```

4. The real delivery flows on the staging database, switched on:

   ```bash
   pnpm staging:setup --flows
   ```

5. Publish: fast-forward `staging` to `main` and push; the workflow deploys.
6. Production relay (this folder, no `--env`) - the same `<phones>` as step 1:

   ```bash
   npx wrangler secret put STAGING_RELAY_PHONES
   ```

7. In ERP staging, give a test SO the tester's phone (staging copies are masked to
   `+60000...`), tick it on Delivery Planning, Send Message -> Send Now. The phone gets the
   template; Confirm / Amend comes back through production (`relayed:staging`) to staging and
   on to ERP staging's `/api/chat-callback`.

To end a test: `npx wrangler secret delete STAGING_RELAY_PHONES` on production first, then
empty `STAGING_ALLOWED_PHONES` on staging.
