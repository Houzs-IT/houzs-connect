// Houzs Connect — dedicated Cron Trigger worker.
//
// The main app runs on OpenNext, whose generated worker exposes no scheduled()
// handler, and wrapping it to add one makes wrangler re-bundle OpenNext's server
// function and fail on node built-ins. So the schedule lives in this tiny
// standalone Worker: every 2 minutes (cron-worker/wrangler.toml [triggers]) it
// POSTs the main app's /api/cron with the shared key, which does the real work
// (resume Delay runs, send due scheduled campaigns, advance drip enrolments).
//
// It needs no node compat — only the global fetch. Deployed alongside the main
// Worker by .github/workflows/deploy.yml. Set its CRON_SECRET (= the main
// Worker's) with `wrangler secret put CRON_SECRET --config cron-worker/wrangler.toml`.
const worker = {
  async scheduled(_controller, env, ctx) {
    const key = env.CRON_SECRET;
    if (!key) return; // scheduler off until the secret is set
    const url = env.CRON_TARGET_URL || "https://chat.houzscentury.com/api/cron";
    ctx.waitUntil(
      fetch(url, { method: "POST", headers: { "x-cron-key": key } })
        .then(() => undefined)
        .catch(() => undefined)
    );
  },
};

export default worker;
