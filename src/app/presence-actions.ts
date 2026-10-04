"use server";

import { getCurrentMember } from "@/lib/current-member";
import { companyPresence, touchPresence } from "@/lib/presence";

/** Heartbeat from an open Connect tab — keeps the member "online". */
export async function pingPresence(): Promise<void> {
  const me = await getCurrentMember();
  if (me) await touchPresence(me.id);
}

export type TeamPresence = { id: string; name: string; online: boolean; lastSeen: string | null; me: boolean }[];

/** Who in this company is in Connect right now, for the top bar. */
export async function teamPresence(): Promise<TeamPresence> {
  const me = await getCurrentMember();
  if (!me) return [];
  const people = await companyPresence(me.companyId);
  return people.map((p) => ({
    id: p.id,
    name: p.name,
    online: p.online,
    lastSeen: p.lastSeen ? p.lastSeen.toISOString() : null,
    me: p.id === me.id,
  }));
}
