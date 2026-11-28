// Real-Postgres smoke for the campaign send lease (audit 2026-11-28, X1 + X3).
//
// Before: the claim in campaigns/send.ts also accepted rows already "sending"
// with no owner, and the progress (stats.doneIds) was read before the claim, so
// two senders (the cron + "Send now", a double submit, a second tab) both
// passed and sent the same batch twice. A campaign that stopped halfway stayed
// "sending" forever because the cron only looked at "scheduled".
//
// This runs the REAL claimCampaign / releaseCampaign / campaignsToSend against
// a throwaway database. LOCALHOST ONLY — it refuses any other DATABASE_URL.
//   DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable' node scripts/smoke-campaign-lease.mjs

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

registerCjs();
registerEsm();

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
let n = 0;
function assert(cond, msg) {
  n++;
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (a throwaway localhost Postgres).");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`Refusing a non-localhost database (${host}).`);
globalThis[Symbol.for("__cloudflare-context__")] = { env: { DATABASE_URL: url } };

const { scriptDb } = await import("./_env.ts");
const { db, sql: client } = scriptDb();
const { migrate } = await import("drizzle-orm/postgres-js/migrator");
await migrate(db, { migrationsFolder: resolve(projectRoot, "src/db/migrations"), migrationsSchema: "connect", migrationsTable: "__drizzle_migrations" });

const { eq, sql } = await import("drizzle-orm");
const { campaign } = await import("../src/db/schema.ts");
const { claimCampaign, releaseCampaign } = await import("../src/app/(app)/campaigns/send.ts");
const { campaignsToSend, RESUME_WITHIN_HOURS } = await import("../src/lib/automation/sweeper.ts");

const CO = "smoke-lease-co";
await db.delete(campaign).where(eq(campaign.companyId, CO));
const make = async (values) => (await db.insert(campaign).values({ companyId: CO, channelId: "smoke-ch", name: "smoke", ...values }).returning())[0];

try {
  // ── X1: two senders at the same moment → exactly one sends ──
  const c1 = await make({ status: "scheduled", scheduleAt: new Date(Date.now() - 60_000) });
  const [a, b] = await Promise.all([claimCampaign(db, CO, c1.id), claimCampaign(db, CO, c1.id)]);
  assert([a, b].filter((r) => r.ok).length === 1, "two simultaneous claims: exactly one wins");
  const loser = a.ok ? b : a;
  const winner = a.ok ? a : b;
  assert(!loser.ok && loser.busy === true, "the other one is told it is busy (not 'already sent')");
  // The old bug: a campaign already "sending" with no owner check let a second caller in.
  const again = await claimCampaign(db, CO, c1.id);
  assert(!again.ok && again.busy, "while the lease is held, a resume / second tab / cron is refused");

  // Release with progress → the next claim sees that progress (read from the claimed row).
  assert(await releaseCampaign(db, c1.id, winner.lease, "sending", { total: 40, sent: 20, startedAt: new Date().toISOString(), doneIds: ["p1", "p2"] }), "the holder releases");
  const next = await claimCampaign(db, CO, c1.id);
  assert(next.ok && next.claimed.stats?.doneIds?.join() === "p1,p2", "the next chunk starts from the previous holder's doneIds");
  assert(next.claimed.stats?.lease?.id === next.lease, "and holds its own lease");

  // A holder whose lease ran out cannot overwrite the one that took over.
  await db.execute(sql`update connect.campaign set stats = jsonb_set(stats, '{lease,until}', to_jsonb(now() - interval '1 minute')) where id = ${c1.id}`);
  const takeover = await claimCampaign(db, CO, c1.id);
  assert(takeover.ok, "an expired lease (a dead tab / killed Worker) can be taken over");
  assert(!(await releaseCampaign(db, c1.id, next.lease, "completed", { sent: 99 })), "the stale holder's late write is dropped");
  assert(await releaseCampaign(db, c1.id, takeover.lease, "completed", { sent: 40 }), "the current holder's write lands");
  const done = await claimCampaign(db, CO, c1.id);
  assert(!done.ok && !done.busy, "a completed campaign is 'already sent', not busy");

  // ── X3: the cron resumes a recent campaign left "sending" — and only that ──
  const recent = await make({ status: "sending", stats: { startedAt: new Date(Date.now() - 30 * 60_000).toISOString(), doneIds: ["x"] } });
  const old = await make({ status: "sending", stats: { startedAt: new Date(Date.now() - (RESUME_WITHIN_HOURS + 2) * 3600_000).toISOString() } });
  const held = await make({ status: "sending", stats: { startedAt: new Date().toISOString() } });
  const heldClaim = await claimCampaign(db, CO, held.id);
  assert(heldClaim.ok, "set up: a campaign being sent right now");
  const unapproved = await make({ status: "sending", requiresApproval: true, stats: { startedAt: new Date().toISOString() } });
  const due = await make({ status: "scheduled", scheduleAt: new Date(Date.now() - 60_000) });
  const future = await make({ status: "scheduled", scheduleAt: new Date(Date.now() + 3600_000) });
  const picked = new Set((await campaignsToSend(db, new Date())).filter((r) => r.companyId === CO).map((r) => r.id));
  assert(picked.has(recent.id), "a recent campaign stuck in 'sending' is resumed by the cron");
  assert(!picked.has(old.id), `one that stalled more than ${RESUME_WITHIN_HOURS} h ago waits for a person (no surprise late sends)`);
  assert(!picked.has(held.id), "one whose lease is held is left to its sender");
  assert(!picked.has(unapproved.id), "an unapproved campaign is never resumed");
  assert(picked.has(due.id) && !picked.has(future.id), "due scheduled campaigns are still picked, future ones are not");

  console.log(`smoke-campaign-lease: ok (${n} assertions)`);
} finally {
  await db.delete(campaign).where(eq(campaign.companyId, CO));
  await client.end();
}
