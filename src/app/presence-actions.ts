"use server";

import { getCurrentMember } from "@/lib/current-member";
import { photoSrcs } from "@/lib/member-photo";
import { ONLINE_WINDOW_MS, recentPresence, touchPresence } from "@/lib/presence";

/** Heartbeat from an open Connect tab — keeps the member "online", and notes
 *  the page it is on (pathname only) for the who's-online panel. */
export async function pingPresence(path?: string): Promise<void> {
  const me = await getCurrentMember();
  if (!me) return;
  const ok = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && path.length <= 300;
  await touchPresence(me.id, ok ? path : null);
}

export type PresenceMember = {
  id: string;
  name: string;
  role: string;
  lastSeen: string;
  lastPath: string | null;
  /** Profile photo URL (lib/member-photo.ts), or null. */
  photo: string | null;
};
export type TeamPresence = { active: PresenceMember[]; away: PresenceMember[] };

/**
 * Who else in this company is in Connect: active (seen in the last 2 minutes)
 * and away (2–15 minutes). You are left out, as in the ERP.
 */
export async function teamPresence(): Promise<TeamPresence> {
  const me = await getCurrentMember();
  if (!me) return { active: [], away: [] };
  const now = Date.now();
  const people = (await recentPresence(me.companyId)).filter((p) => p.id !== me.id);
  const photos = await photoSrcs(people.map((p) => p.id));
  const toMember = (p: (typeof people)[number]): PresenceMember => ({
    id: p.id,
    name: p.name,
    role: p.role,
    lastSeen: p.lastSeen.toISOString(),
    lastPath: p.lastPath,
    photo: photos.get(p.id) ?? null,
  });
  return {
    active: people.filter((p) => now - p.lastSeen.getTime() < ONLINE_WINDOW_MS).map(toMember),
    away: people.filter((p) => now - p.lastSeen.getTime() >= ONLINE_WINDOW_MS).map(toMember),
  };
}
