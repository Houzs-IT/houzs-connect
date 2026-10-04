"use server";

import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureSettingsExtras } from "@/db/ensure-settings-extras";
import { getCurrentMember } from "@/lib/current-member";
import { NOTIFY_KINDS, noticesSince, type Notice } from "@/lib/notifications";
import { can } from "@/lib/permissions";

/** What happened for me since `since` (ISO), for the browser alerts. */
export async function checkNotices(since: string): Promise<Notice[]> {
  const me = await getCurrentMember();
  if (!me) return [];
  const from = new Date(since);
  // Never reach further back than ten minutes — a tab left asleep should not
  // replay the whole afternoon.
  const floor = new Date(Date.now() - 10 * 60_000);
  const approver = (await can(me, "approveDept")) || (await can(me, "approveFinal"));
  return noticesSince(me, Number.isNaN(from.getTime()) || from < floor ? floor : from, { approver });
}

/** The bell in the top bar: the last day of everything, newest first. */
export async function recentNotices(): Promise<Notice[]> {
  const me = await getCurrentMember();
  if (!me) return [];
  const approver = (await can(me, "approveDept")) || (await can(me, "approveFinal"));
  return (await noticesSince(me, new Date(Date.now() - 86_400_000), { approver, all: true })).slice(0, 12);
}

/** Save one choice on Settings → Notifications. */
export async function setNotifyPref(kind: string, channel: "browser" | "email", on: boolean): Promise<{ ok: boolean }> {
  const me = await getCurrentMember();
  if (!me || !(NOTIFY_KINDS as readonly string[]).includes(kind)) return { ok: false };
  const db = getDb();
  await ensureSettingsExtras(db);
  const browser = channel === "browser" ? on : true;
  const email = channel === "email" ? on : false;
  await db.execute(sql`
    insert into connect.notification_pref (member_id, kind, browser, email)
    values (${me.id}, ${kind}, ${browser}, ${email})
    on conflict (member_id, kind) do update set
      ${channel === "browser" ? sql`browser = ${on}` : sql`email = ${on}`}, updated_at = now()
  `);
  return { ok: true };
}
