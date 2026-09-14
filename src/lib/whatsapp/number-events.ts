// A record of what was asked of Meta about a number, and what Meta answered.
//
// "I pressed Register and it did not work" had no answer except a screenshot:
// the result lived for one render and was gone. These rows go to the same log
// System Logs already reads (source 'numbers'). The PIN and the verification
// code are NEVER stored — only which number, which step, and Meta's own words.
//
// Deliberately not in a "use server" module: everything exported from one of
// those is a POST endpoint, and a log writer must not be callable from outside.

import { getDb } from "@/db/client";
import { webhookEvent } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";

export async function recordNumberEvent(
  action: string,
  number: string,
  result: { ok: boolean; error?: string; statusAfter?: string | null },
  extra: Record<string, unknown> = {}
): Promise<void> {
  const me = await getCurrentMember().catch(() => null);
  await getDb()
    .insert(webhookEvent)
    .values({
      source: "numbers",
      eventType: `numbers:${action}:${result.ok ? "ok" : "failed"}`,
      payload: {
        action,
        number,
        by: me?.email ?? null,
        error: result.error ?? null,
        statusAfter: result.statusAfter ?? null,
        ...extra,
      },
      processed: result.ok,
    })
    .catch(() => {});
}

/**
 * Keep what Meta reported about every number when the Phone numbers page was
 * opened.
 *
 * The page reads status live from Meta and forgets it, so "is Hookka connected
 * yet?" could only be answered by whoever had the page open. Written only when
 * something changed, or once an hour at most, so a page left open does not fill
 * the log.
 */
export async function recordStatusSnapshot(
  numbers: {
    id: string;
    displayPhoneNumber: string;
    verifiedName: string | null;
    connection: string | null;
    codeVerification: string | null;
    nameStatus: string | null;
    newNameStatus: string | null;
    qualityRating: string | null;
    limitTier: string | null;
  }[]
): Promise<void> {
  const snapshot = numbers.map((n) => ({
    id: n.id,
    display: n.displayPhoneNumber,
    name: n.verifiedName,
    connection: n.connection,
    codeVerification: n.codeVerification,
    nameStatus: n.nameStatus,
    newNameStatus: n.newNameStatus,
    qualityRating: n.qualityRating,
    limitTier: n.limitTier,
  }));
  const db = getDb();
  const last = await db.query.webhookEvent.findFirst({
    columns: { payload: true, createdAt: true },
    where: (w, { and, eq }) => and(eq(w.source, "numbers"), eq(w.eventType, "numbers:status:ok")),
    orderBy: (w, { desc }) => desc(w.createdAt),
  });
  const unchanged = JSON.stringify((last?.payload as { numbers?: unknown } | undefined)?.numbers) === JSON.stringify(snapshot);
  const recent = last && Date.now() - last.createdAt.getTime() < 3600_000;
  if (unchanged && recent) return;
  await db
    .insert(webhookEvent)
    .values({ source: "numbers", eventType: "numbers:status:ok", payload: { numbers: snapshot }, processed: true })
    .catch(() => {});
}
