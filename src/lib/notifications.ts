import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureSettingsExtras } from "@/db/ensure-settings-extras";
import { SLA_MINUTES } from "@/lib/sla";

/*
  What can reach a person, and their choice per kind (connect.notification_pref,
  migration 0014). Browser alerts are shown by the open app (NotifyPoller);
  email needs a mail service Connect does not have yet, so it is stored but
  not sent.
*/

export const NOTIFY_KINDS = ["newMessage", "sla", "mention", "accessRequest"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export type Prefs = Record<NotifyKind, { browser: boolean; email: boolean }>;

export async function loadPrefs(memberId: string): Promise<Prefs> {
  const prefs = Object.fromEntries(NOTIFY_KINDS.map((k) => [k, { browser: true, email: false }])) as Prefs;
  try {
    const db = getDb();
    await ensureSettingsExtras(db);
    const rows = (await db.execute(sql`
      select kind, browser, email from connect.notification_pref where member_id = ${memberId}
    `)) as unknown as { kind: string; browser: boolean; email: boolean }[];
    for (const r of rows) if (r.kind in prefs) prefs[r.kind as NotifyKind] = { browser: r.browser, email: r.email };
  } catch {
    // No table yet: everything on in the browser, nothing by email.
  }
  return prefs;
}

export type Notice = { kind: NotifyKind; title: string; body: string; href: string; at: string };

/**
 * Everything that happened for this person since `since`: customer messages in
 * chats assigned to them, chats of theirs crossing the SLA, @mentions in
 * Internal, and new access requests if they can approve them.
 */
export async function noticesSince(
  me: { id: string; companyId: string },
  since: Date,
  opts: { approver: boolean; all?: boolean }
): Promise<Notice[]> {
  const db = getDb();
  const loaded = await loadPrefs(me.id);
  // The bell lists everything; the browser alerts follow the person's choices.
  const prefs = opts.all
    ? (Object.fromEntries(Object.keys(loaded).map((k) => [k, { browser: true, email: false }])) as Prefs)
    : loaded;
  const out: Notice[] = [];
  const q = async <T,>(s: ReturnType<typeof sql>) => (await db.execute(s).catch(() => [])) as unknown as T[];

  if (prefs.newMessage.browser) {
    const rows = await q<{ conversation_id: string; name: string | null; phone: string; body: string | null; created_at: string }>(sql`
      select distinct on (m.conversation_id) m.conversation_id, ct.name, ct.phone, m.body, m.created_at
      from connect.message m
      join connect.conversation cv on cv.id = m.conversation_id
      join connect.contact ct on ct.id = cv.contact_id
      where cv.assigned_agent_id = ${me.id} and m.direction = 'IN' and m.created_at > ${since.toISOString()}::timestamptz
      order by m.conversation_id, m.created_at desc
      limit 5
    `);
    for (const r of rows) {
      out.push({ kind: "newMessage", title: r.name || r.phone, body: r.body ?? "", href: `/inbox/${r.conversation_id}`, at: String(r.created_at) });
    }
  }

  if (prefs.sla.browser) {
    // Chats of mine whose last customer message crossed the SLA in this window.
    const from = new Date(since.getTime() - SLA_MINUTES * 60_000);
    const rows = await q<{ id: string; name: string | null; phone: string }>(sql`
      select cv.id, ct.name, ct.phone from connect.conversation cv
      join connect.contact ct on ct.id = cv.contact_id
      where cv.assigned_agent_id = ${me.id} and cv.status <> 'CLOSED'
        and (select max(i.created_at) from connect.message i where i.conversation_id = cv.id and i.direction = 'IN')
          between ${from.toISOString()}::timestamptz and now() - make_interval(mins => ${SLA_MINUTES})
        and coalesce((select max(o.created_at) from connect.message o where o.conversation_id = cv.id and o.direction = 'OUT'), 'epoch')
          < (select max(i.created_at) from connect.message i where i.conversation_id = cv.id and i.direction = 'IN')
      limit 5
    `);
    for (const r of rows) {
      out.push({ kind: "sla", title: r.name || r.phone, body: `No reply for ${SLA_MINUTES} minutes`, href: `/inbox/${r.id}`, at: new Date().toISOString() });
    }
  }

  if (prefs.mention.browser) {
    const rows = await q<{ id: string; channel_id: string; parent_id: string | null; body: string; author: string | null; created_at: string }>(sql`
      select m.id, m.channel_id, m.parent_id, m.body, a.name as author, m.created_at
      from connect.internal_message m
      join connect.internal_channel c on c.id = m.channel_id and c.company_id = ${me.companyId}
      left join connect.member a on a.id = m.author_member_id
      where m.created_at > ${since.toISOString()}::timestamptz and coalesce(m.author_member_id, '') <> ${me.id}
        and (m.mentions ? ${me.id} or m.mentions ? 'channel'
          or (c.kind = 'dm' and exists (select 1 from connect.internal_channel_member x where x.channel_id = c.id and x.member_id = ${me.id})))
      order by m.created_at desc
      limit 5
    `);
    for (const r of rows) {
      out.push({
        kind: "mention",
        title: r.author ?? "Internal",
        body: r.body,
        href: `/internal/${r.channel_id}${r.parent_id ? `?t=${r.parent_id}` : ""}`,
        at: String(r.created_at),
      });
    }
  }

  if (prefs.accessRequest.browser && opts.approver) {
    const rows = await q<{ name: string; department: string | null; created_at: string }>(sql`
      select name, department, created_at from connect.access_request
      where company_id = ${me.companyId} and created_at > ${since.toISOString()}::timestamptz and status = 'pending_manager'
      limit 5
    `);
    for (const r of rows) {
      out.push({ kind: "accessRequest", title: r.name, body: r.department ?? "", href: "/settings/team", at: String(r.created_at) });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}
