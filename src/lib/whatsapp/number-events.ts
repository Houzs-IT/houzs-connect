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
