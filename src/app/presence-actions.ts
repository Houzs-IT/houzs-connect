"use server";

import { getCurrentMember } from "@/lib/current-member";
import { touchPresence } from "@/lib/presence";

/** Heartbeat from an open Connect tab — keeps the member "online". */
export async function pingPresence(): Promise<void> {
  const me = await getCurrentMember();
  if (me) await touchPresence(me.id);
}
