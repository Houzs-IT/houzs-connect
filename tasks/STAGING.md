# Staging

`houzs-connect-staging` is a second Worker on its own Supabase project. It shows a yellow
STAGING strip, sends no WhatsApp (DEMO, no Meta token) and makes no automation calls to the
ERP or any other address. Production (chat.houzscentury.com) is not affected.

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
