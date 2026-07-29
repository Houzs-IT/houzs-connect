import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Minimal OpenNext Cloudflare config. No incremental cache / queue configured
// yet — the app is dynamic (server components + actions hitting Postgres), so
// default in-memory/no-op caching is fine. Add an R2 incremental cache later if
// ISR/static-revalidation is introduced.
export default defineCloudflareConfig();
