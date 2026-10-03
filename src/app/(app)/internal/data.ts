import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureInternalTables } from "@/db/ensure-internal";
import { SLA_MINUTES } from "@/lib/sla";

/*
  Reads for Internal (staff chat). Raw SQL: every list joins channels, read
  state, authors and the linked customer conversation in one round trip, and
  the company scope is applied on the channel in each query.
*/

type Row = Record<string, unknown>;
const rows = async <T,>(q: ReturnType<typeof sql>) => (await getDb().execute(q)) as unknown as T[];

/** Lower-case, dash-separated channel name: "Customer Service" → "customer-service". */
export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "channel";
}

/**
 * Tables exist, and a company opening Internal for the first time gets one
 * channel per department plus #general — the shape the redesign starts from.
 */
export async function ensureInternal(companyId: string, memberId: string): Promise<void> {
  const db = getDb();
  await ensureInternalTables(db);
  const have = await rows<{ n: number }>(sql`
    select count(*)::int as n from connect.internal_channel where company_id = ${companyId} and kind = 'channel'
  `);
  if ((have[0]?.n ?? 0) > 0) return;
  const depts = await rows<{ id: string; name: string }>(sql`
    select id, name from connect.department where company_id = ${companyId} order by name
  `);
  const seeds = [...depts.map((d) => ({ name: slug(d.name), dept: d.id as string | null })), { name: "general", dept: null }];
  const seen = new Set<string>();
  for (const s of seeds) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    await db.execute(sql`
      insert into connect.internal_channel (id, company_id, kind, name, department_id, created_by_member_id)
      values (${createId()}, ${companyId}, 'channel', ${s.name}, ${s.dept}, ${memberId})
    `);
  }
}

export type SideChannel = { id: string; name: string; topic: string | null; unread: number };
export type SideDm = { id: string; otherId: string; otherName: string; unread: number };
export type SideDiscussion = { conversationId: string; name: string; orderRef: string | null; channelId: string; messageId: string };

/** Unread = top-level (or also-in-channel) messages from others since I last read it. */
const unread = (meId: string) => sql`(
  select count(*)::int from connect.internal_message m
  where m.channel_id = c.id and (m.parent_id is null or m.also_in_channel)
    and coalesce(m.author_member_id, '') <> ${meId}
    and m.created_at > coalesce(cm.last_read_at, now() - interval '7 days')
)`;

export async function sidebar(companyId: string, meId: string) {
  const [channels, dms, discussions] = await Promise.all([
    rows<{ id: string; name: string; topic: string | null; unread: number }>(sql`
      select c.id, c.name, c.topic, ${unread(meId)} as unread
      from connect.internal_channel c
      left join connect.internal_channel_member cm on cm.channel_id = c.id and cm.member_id = ${meId}
      where c.company_id = ${companyId} and c.kind = 'channel'
      order by c.name
    `),
    rows<{ id: string; other_id: string; other_name: string; unread: number }>(sql`
      select c.id, o.member_id as other_id, mo.name as other_name, ${unread(meId)} as unread
      from connect.internal_channel c
      join connect.internal_channel_member cm on cm.channel_id = c.id and cm.member_id = ${meId}
      join connect.internal_channel_member o on o.channel_id = c.id and o.member_id <> ${meId}
      join connect.member mo on mo.id = o.member_id
      where c.company_id = ${companyId} and c.kind = 'dm'
      order by mo.name
    `),
    rows<{ conversation_id: string; name: string | null; phone: string; attributes: unknown; channel_id: string; message_id: string }>(sql`
      select distinct on (m.conversation_id) m.conversation_id, ct.name, ct.phone, ct.attributes, m.channel_id,
        coalesce(m.parent_id, m.id) as message_id
      from connect.internal_message m
      join connect.internal_channel c on c.id = m.channel_id and c.company_id = ${companyId}
      join connect.conversation cv on cv.id = m.conversation_id
      join connect.contact ct on ct.id = cv.contact_id
      where m.conversation_id is not null
      order by m.conversation_id, m.created_at desc
      limit 12
    `),
  ]);
  return {
    channels: channels as SideChannel[],
    dms: dms.map((d) => ({ id: d.id, otherId: d.other_id, otherName: d.other_name, unread: d.unread })) as SideDm[],
    discussions: discussions.map((d) => ({
      conversationId: d.conversation_id,
      name: d.name || d.phone,
      orderRef: refOf(d.attributes),
      channelId: d.channel_id,
      messageId: d.message_id,
    })) as SideDiscussion[],
  };
}

function refOf(attributes: unknown): string | null {
  const a = (attributes ?? {}) as Record<string, unknown>;
  const v = a.ref_1 ?? a.order_ref ?? a.so_number;
  return v == null || v === "" ? null : String(v);
}

export type Card = {
  id: string;
  name: string;
  orderRef: string | null;
  lastText: string | null;
  assignee: string | null;
  badge: { text: string; tone: "danger" | "neutral" | "success" } | null;
};

export type ChatMessage = {
  id: string;
  authorId: string | null;
  author: string;
  dept: string | null;
  body: string;
  createdAt: Date;
  parentId: string | null;
  alsoInChannel: boolean;
  systemAction: string | null;
  card: Card | null;
  replies: number;
  lastReplyAt: Date | null;
  replyAuthors: string[];
};

const MESSAGE_SELECT = sql`
  m.id, m.author_member_id, coalesce(a.name, 'Connect') as author, d.name as dept, m.body, m.created_at,
  m.parent_id, m.also_in_channel, m.system_action->>'text' as system_action,
  m.conversation_id, ct.name as c_name, ct.phone as c_phone, ct.attributes as c_attrs, ag.name as c_agent,
  cv.status as c_status,
  (select i.body from connect.message i where i.conversation_id = cv.id and i.direction = 'IN' order by i.created_at desc limit 1) as c_last,
  (select max(i.created_at) from connect.message i where i.conversation_id = cv.id and i.direction = 'IN') as c_last_in,
  (select max(o.created_at) from connect.message o where o.conversation_id = cv.id and o.direction = 'OUT') as c_last_out,
  (select t.name from connect.conversation_tag x join connect.tag t on t.id = x.tag_id where x.conversation_id = cv.id limit 1) as c_tag
`;
const MESSAGE_JOINS = sql`
  left join connect.member a on a.id = m.author_member_id
  left join connect.department d on d.id = a.department_id
  left join connect.conversation cv on cv.id = m.conversation_id
  left join connect.contact ct on ct.id = cv.contact_id
  left join connect.member ag on ag.id = cv.assigned_agent_id
`;

function toMessage(r: Row): ChatMessage {
  const lastIn = r.c_last_in ? new Date(r.c_last_in as string) : null;
  const lastOut = r.c_last_out ? new Date(r.c_last_out as string) : null;
  // Overdue: the customer wrote last, more than the SLA ago.
  const overdue = !!lastIn && (!lastOut || lastOut < lastIn) && Date.now() - lastIn.getTime() > SLA_MINUTES * 60_000 && r.c_status !== "CLOSED";
  return {
    id: r.id as string,
    authorId: (r.author_member_id as string | null) ?? null,
    author: r.author as string,
    dept: (r.dept as string | null) ?? null,
    body: r.body as string,
    createdAt: new Date(r.created_at as string),
    parentId: (r.parent_id as string | null) ?? null,
    alsoInChannel: !!r.also_in_channel,
    systemAction: (r.system_action as string | null) ?? null,
    card: r.conversation_id
      ? {
          id: r.conversation_id as string,
          name: (r.c_name as string | null) || (r.c_phone as string) || "—",
          orderRef: refOf(r.c_attrs),
          lastText: (r.c_last as string | null) ?? null,
          assignee: (r.c_agent as string | null) ?? null,
          badge: overdue
            ? { text: "SLA overdue", tone: "danger" }
            : r.c_tag
              ? { text: String(r.c_tag), tone: "neutral" }
              : r.c_status === "CLOSED"
                ? { text: "Closed", tone: "success" }
                : null,
        }
      : null,
    replies: Number(r.replies ?? 0),
    lastReplyAt: r.last_reply_at ? new Date(r.last_reply_at as string) : null,
    replyAuthors: (r.reply_authors as string[] | null) ?? [],
  };
}

export async function channelInfo(companyId: string, channelId: string, meId: string) {
  const r = await rows<{ id: string; kind: string; name: string; topic: string | null; other_name: string | null }>(sql`
    select c.id, c.kind, c.name, c.topic,
      (select mo.name from connect.internal_channel_member o join connect.member mo on mo.id = o.member_id
        where o.channel_id = c.id and o.member_id <> ${meId} limit 1) as other_name
    from connect.internal_channel c
    where c.id = ${channelId} and c.company_id = ${companyId}
      and (c.kind = 'channel' or exists (select 1 from connect.internal_channel_member x where x.channel_id = c.id and x.member_id = ${meId}))
  `);
  const c = r[0];
  return c ? { id: c.id, kind: c.kind as "channel" | "dm", name: c.kind === "dm" ? (c.other_name ?? c.name) : c.name, topic: c.topic } : null;
}

/** The channel's timeline: top-level messages and replies also sent to it, oldest first. */
export async function channelMessages(channelId: string, limit = 200): Promise<ChatMessage[]> {
  const r = await rows<Row>(sql`
    select * from (
      select ${MESSAGE_SELECT},
        (select count(*)::int from connect.internal_message x where x.parent_id = m.id) as replies,
        (select max(x.created_at) from connect.internal_message x where x.parent_id = m.id) as last_reply_at,
        (select array_agg(distinct xa.name) from connect.internal_message x join connect.member xa on xa.id = x.author_member_id where x.parent_id = m.id) as reply_authors
      from connect.internal_message m
      ${MESSAGE_JOINS}
      where m.channel_id = ${channelId} and (m.parent_id is null or m.also_in_channel)
      order by m.created_at desc
      limit ${limit}
    ) t order by created_at asc
  `);
  return r.map(toMessage);
}

/** A thread: the root message and every reply, oldest first. */
export async function threadMessages(channelId: string, rootId: string): Promise<ChatMessage[]> {
  const r = await rows<Row>(sql`
    select ${MESSAGE_SELECT}, 0 as replies
    from connect.internal_message m
    ${MESSAGE_JOINS}
    where m.channel_id = ${channelId} and (m.id = ${rootId} or m.parent_id = ${rootId})
    order by (m.id <> ${rootId}), m.created_at asc
  `);
  return r.map(toMessage);
}

/** Search every channel I can see. */
export async function searchMessages(companyId: string, meId: string, q: string): Promise<(ChatMessage & { channelId: string; channelName: string })[]> {
  const like = `%${q}%`;
  const r = await rows<Row>(sql`
    select ${MESSAGE_SELECT}, 0 as replies, c.id as channel_id, c.name as channel_name
    from connect.internal_message m
    join connect.internal_channel c on c.id = m.channel_id and c.company_id = ${companyId}
    ${MESSAGE_JOINS}
    where m.body ilike ${like}
      and (c.kind = 'channel' or exists (select 1 from connect.internal_channel_member x where x.channel_id = c.id and x.member_id = ${meId}))
    order by m.created_at desc
    limit 50
  `);
  return r.map((x) => ({ ...toMessage(x), channelId: x.channel_id as string, channelName: x.channel_name as string }));
}

/** Mark a channel read for me (creates my row on first visit). */
export async function markRead(channelId: string, meId: string): Promise<void> {
  await getDb().execute(sql`
    insert into connect.internal_channel_member (channel_id, member_id, last_read_at)
    values (${channelId}, ${meId}, now())
    on conflict (channel_id, member_id) do update set last_read_at = now()
  `);
}
