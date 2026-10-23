// Cloudflare Worker entrypoint.
//
// OpenNext generates the real request handler at .open-next/worker.js, but that
// handler has only a `fetch` export — OpenNext 1.20.2 has no hook for a cron
// `scheduled()` handler. So this thin wrapper re-exports OpenNext's fetch handler
// unchanged and adds `scheduled()`, and wrangler.toml points `main` here.
//
// The scheduled handler does NOT touch the DB directly: getDb() reads the
// Cloudflare context from an AsyncLocalStorage store that only the fetch path
// populates, so a direct call throws. Instead it self-fetches POST /api/cron,
// which runs in a normal request context where getDb() and all secrets work.
// chat.houzscentury.com is a Custom Domain, which same-zone fetch() reaches
// (see the note in wrangler.toml).
//
// This file is excluded from `tsc` (tsconfig.json) because the import below only
// exists after `opennextjs-cloudflare build`; wrangler bundles it at deploy time.
import openNextHandler from "./.open-next/worker.js";

const worker = {
  fetch: openNextHandler.fetch,

  async scheduled(_controller, env, ctx) {
    const key = env.CRON_SECRET;
    if (!key) return; // scheduler off until the secret is set
    const origin = env.APP_ORIGIN || "https://chat.houzscentury.com";
    ctx.waitUntil(
      fetch(`${origin}/api/cron`, {
        method: "POST",
        headers: { "x-cron-key": key },
      })
        .then(() => undefined)
        .catch(() => undefined)
    );
  },
};

export default worker;
