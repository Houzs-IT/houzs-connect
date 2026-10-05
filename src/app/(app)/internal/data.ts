import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureInternalTables } from "@/db/ensure-internal";
import { autoJoinDepartmentChannels } from "@/lib/internal-auto-join";
import { photoSrcs } from "@/lib/member-photo";
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
  return s.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "channel";
}

/**
 * Tables exist, and a company opening Internal for the first time gets one
 * channel per department plus #general — the shape the redesign starts from.
 */
export async function ensureInternal(companyId: string, memberId: string): Promise<void> {
  const db = getDb();
  await ensureInternalTables(db);
  if (seeded.has(companyId)) return;
  // The layout and the page both call this on a first visit, at the same time.
  // One transaction per company at a time, re-checking inside it, so the
  // default channels are made once.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"internal-seed:" + companyId}))`);
    // Earlier builds could race and make each default channel twice; drop the
    // empty copies (the oldest of each name stays).
    await tx.execute(sql`
      delete from connect.internal_channel c
      where c.company_id = ${companyId} and c.kind = 'channel'
        and exists (
          select 1 from connect.internal_channel o
          where o.company_id = c.company_id and o.kind = 'channel' and o.name = c.name
            and (o.created_at, o.id) < (c.created_at, c.id)
        )
        and not exists (select 1 from connect.internal_message m where m.channel_id = c.id)
    `);
    const have = (await tx.execute(sql`
      select count(*)::int as n from connect.internal_channel where company_id = ${companyId} and kind = 'channel'
    `)) as unknown as { n: number }[];
    if ((have[0]?.n ?? 0) === 0) {
      const depts = (await tx.execute(sql`
        select id, name from connect.department where company_id = ${companyId} order by name
      `)) as unknown as { id: string; name: string }[];
      const seeds = [...depts.map((d) => ({ name: slug(d.name), dept: d.id as string | null })), { name: "general", dept: null }];
      const seen = new Set<string>();
      for (const s of seeds) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        await tx.execute(sql`
          insert into connect.internal_channel (id, company_id, kind, name, department_id, created_by_member_id)
          values (${createId()}, ${companyId}, 'channel', ${s.name}, ${s.dept}, ${memberId})
        `);
      }
    }
    await settleMembership(tx, companyId);
  });
  seeded.add(companyId);
}


/** Company admins: in every department channel, and they approve any request. */
const ADMIN_ROLES = sql`('SUPER_ADMIN', 'OWNER', 'ADMIN')`;

/**
 * Members for channels made before membership existed (access is null), once
 * (owner's choice, 2026-10-05): a department channel keeps that department
 * plus the company's admins and needs approval to join; #general keeps
 * everyone and is open; any other channel keeps whoever already had it open,
 * its maker as admin, and stays open. Read positions survive.
 */
async function settleMembership(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, companyId: string) {
  const legacy = (await tx.execute(sql`
    select id, name, department_id, created_by_member_id from connect.internal_channel
    where company_id = ${companyId} and kind = 'channel' and access is null
  `)) as unknown as { id: string; name: string; department_id: string | null; created_by_member_id: string | null }[];
  for (const ch of legacy) {
    if (ch.department_id || ch.name === "general") {
      const who = ch.department_id
        ? sql`m.department_id = ${ch.department_id} or m.role::text in ${ADMIN_ROLES}`
        : sql`true`;
      await tx.execute(sql`
        insert into connect.internal_channel_member (channel_id, member_id, state, role)
        select ${ch.id}, m.id, 'member', 'member' from connect.member m
        where m.company_id = ${companyId} and m.active = true and (${who})
        on conflict (channel_id, member_id) do update set state = 'member'
      `);
      await tx.execute(sql`
        delete from connect.internal_channel_member x
        where x.channel_id = ${ch.id} and not exists (
          select 1 from connect.member m
          where m.id = x.member_id and m.company_id = ${companyId} and m.active = true and (${who})
        )
      `);
      await tx.execute(sql`
        update connect.internal_channel set access = ${ch.department_id ? "approval" : "open"} where id = ${ch.id}
      `);
    } else {
      if (ch.created_by_member_id) {
        await tx.execute(sql`
          insert into connect.internal_channel_member (channel_id, member_id, state, role)
          values (${ch.id}, ${ch.created_by_member_id}, 'member', 'admin')
          on conflict (channel_id, member_id) do update set state = 'member', role = 'admin'
        `);
      }
      await tx.execute(sql`update connect.internal_channel set access = 'open' where id = ${ch.id}`);
    }
  }
}

/** Companies already checked by this worker. */
const seeded = new Set<string>();

export type SideChannel = {
  id: string;
  name: string;
  topic: string | null;
  unread: number;
  lastBy: string | null;
  lastBody: string | null;
  /** Requests to join waiting, shown to whoever can approve them. */
  pending: number;
};
export type SideDm = { id: string; otherId: string; otherName: string; unread: number; lastBy: string | null; lastBody: string | null };
export type SideDiscussion = { conversationId: string; name: string; orderRef: string | null; channelId: string; messageId: string };

/** Unread = top-level (or also-in-channel) messages from others since I last read it. */
const unread = (meId: string) => sql`(
  select count(*)::int from connect.internal_message m
  where m.channel_id = c.id and (m.parent_id is null or m.also_in_channel)
    and coalesce(m.author_member_id, '') <> ${meId}
    and m.created_at > coalesce(cm.last_read_at, now() - interval '7 days')
)`;

/** The newest top-level message in channel c: who and what (the phone list previews it). */
const last = sql`(
  select json_build_object('by', a.name, 'body', m.body) from connect.internal_message m
  left join connect.member a on a.id = m.author_member_id
  where m.channel_id = c.id and (m.parent_id is null or m.also_in_channel)
  order by m.created_at desc limit 1
)`;
type Last = { by: string | null; body: string | null } | null;

export async function sidebar(companyId: string, meId: string, companyAdminFlag = false) {
  const companyAdmin = companyAdminFlag ? sql`true` : sql`false`;
  const [channels, dms, discussions] = await Promise.all([
    rows<{ id: string; name: string; topic: string | null; unread: number; last: Last; pending: number }>(sql`
      select c.id, c.name, c.topic, ${unread(meId)} as unread, ${last} as last,
        case when cm.role = 'admin' or ${companyAdmin} then (
          select count(*)::int from connect.internal_channel_member p where p.channel_id = c.id and p.state = 'pending'
        ) else 0 end as pending
      from connect.internal_channel c
      join connect.internal_channel_member cm on cm.channel_id = c.id and cm.member_id = ${meId} and cm.state = 'member'
      where c.company_id = ${companyId} and c.kind = 'channel'
      order by (c.name = 'general'), c.created_at, c.name
    `),
    rows<{ id: string; other_id: string; other_name: string; unread: number; last: Last }>(sql`
      select c.id, o.member_id as other_id, mo.name as other_name, ${unread(meId)} as unread, ${last} as last
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
      join connect.internal_channel_member dm on dm.channel_id = c.id and dm.member_id = ${meId} and dm.state = 'member'
      join connect.conversation cv on cv.id = m.conversation_id
      join connect.contact ct on ct.id = cv.contact_id
      where m.conversation_id is not null
      order by m.conversation_id, m.created_at desc
      limit 12
    `),
  ]);
  return {
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      topic: c.topic,
      unread: c.unread,
      lastBy: c.last?.by ?? null,
      lastBody: c.last?.body ?? null,
      pending: Number(c.pending ?? 0),
    })) as SideChannel[],
    dms: dms.map((d) => ({
      id: d.id,
      otherId: d.other_id,
      otherName: d.other_name,
      unread: d.unread,
      lastBy: d.last?.by ?? null,
      lastBody: d.last?.body ?? null,
    })) as SideDm[],
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
  /** The author's profile photo (lib/member-photo.ts), or null. */
  authorPhoto: string | null;
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
    authorPhoto: null, // filled by withPhotos
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

/** Each author's profile photo — one lookup per timeline, not per message. */
async function withPhotos<T extends ChatMessage>(msgs: T[]): Promise<T[]> {
  const photos = await photoSrcs(msgs.map((m) => m.authorId));
  for (const m of msgs) m.authorPhoto = (m.authorId && photos.get(m.authorId)) || null;
  return msgs;
}

export async function channelInfo(companyId: string, channelId: string, meId: string) {
  const r = await rows<{
    id: string;
    kind: string;
    name: string;
    topic: string | null;
    access: string | null;
    created_by: string | null;
    my_state: string | null;
    my_role: string | null;
    member_count: number;
    pending_count: number;
    other_name: string | null;
  }>(sql`
    select c.id, c.kind, c.name, c.topic, c.access, c.created_by_member_id as created_by,
      me.state as my_state, me.role as my_role,
      (select count(*)::int from connect.internal_channel_member x where x.channel_id = c.id and x.state = 'member') as member_count,
      (select count(*)::int from connect.internal_channel_member x where x.channel_id = c.id and x.state = 'pending') as pending_count,
      (select mo.name from connect.internal_channel_member o join connect.member mo on mo.id = o.member_id
        where o.channel_id = c.id and o.member_id <> ${meId} limit 1) as other_name
    from connect.internal_channel c
    left join connect.internal_channel_member me on me.channel_id = c.id and me.member_id = ${meId}
    where c.id = ${channelId} and c.company_id = ${companyId}
      and (c.kind = 'channel' or me.member_id is not null)
  `);
  const c = r[0];
  if (!c) return null;
  const isMember = c.kind === "dm" || c.my_state === "member";
  return {
    id: c.id,
    kind: c.kind as "channel" | "dm",
    name: c.kind === "dm" ? (c.other_name ?? c.name) : c.name,
    topic: c.topic,
    createdBy: c.created_by,
    access: (c.access === "approval" ? "approval" : "open") as "open" | "approval",
    isMember,
    isPending: c.my_state === "pending",
    /** Admin of this channel (a company admin manages every channel too: check the role as well). */
    isChannelAdmin: isMember && c.my_role === "admin",
    memberCount: Number(c.member_count ?? 0),
    pendingCount: Number(c.pending_count ?? 0),
  };
}

export type ChannelMember = { id: string; name: string; dept: string | null; role: "admin" | "member"; state: "member" | "pending" };

/** Who is in a channel, and who asked to join: requests first, then admins, then by name. */
export async function channelMembers(channelId: string): Promise<ChannelMember[]> {
  const r = await rows<{ id: string; name: string; dept: string | null; role: string; state: string }>(sql`
    select m.id, m.name, d.name as dept, x.role, x.state
    from connect.internal_channel_member x
    join connect.member m on m.id = x.member_id
    left join connect.department d on d.id = m.department_id
    where x.channel_id = ${channelId}
    order by (x.state = 'pending') desc, (x.role = 'admin') desc, m.name
  `);
  return r.map((x) => ({
    id: x.id,
    name: x.name,
    dept: x.dept,
    role: x.role === "admin" ? "admin" : "member",
    state: x.state === "pending" ? "pending" : "member",
  }));
}

export type BrowseChannel = {
  id: string;
  name: string;
  topic: string | null;
  access: "open" | "approval";
  members: number;
  mine: "member" | "pending" | null;
};

/** Every channel in the company, for Browse channels. */
export async function browseChannels(companyId: string, meId: string): Promise<BrowseChannel[]> {
  const r = await rows<{ id: string; name: string; topic: string | null; access: string | null; members: number; mine: string | null }>(sql`
    select c.id, c.name, c.topic, c.access,
      (select count(*)::int from connect.internal_channel_member x where x.channel_id = c.id and x.state = 'member') as members,
      me.state as mine
    from connect.internal_channel c
    left join connect.internal_channel_member me on me.channel_id = c.id and me.member_id = ${meId}
    where c.company_id = ${companyId} and c.kind = 'channel'
    order by (c.name = 'general') desc, c.name
  `);
  return r.map((x) => ({
    id: x.id,
    name: x.name,
    topic: x.topic,
    access: x.access === "approval" ? "approval" : "open",
    members: Number(x.members ?? 0),
    mine: x.mine === "member" ? "member" : x.mine === "pending" ? "pending" : null,
  }));
}

/** The channel's timeline: top-level messages and replies also sent to it, oldest first. */
export async function channelMessages(channelId: string, limit = 200): Promise<ChatMessage[]> {
  const r = await rows<Row>(sql`
    select * from (
      select ${MESSAGE_SELECT},
        (select count(*)::int from connect.internal_message x where x.parent_id = m.id) as replies,
        (select max(x.created_at) from connect.internal_message x where x.parent_id = m.id) as last_reply_at,
        (select json_agg(distinct xa.name) from connect.internal_message x join connect.member xa on xa.id = x.author_member_id where x.parent_id = m.id) as reply_authors
      from connect.internal_message m
      ${MESSAGE_JOINS}
      where m.channel_id = ${channelId} and (m.parent_id is null or m.also_in_channel)
      order by m.created_at desc
      limit ${limit}
    ) t order by created_at asc
  `);
  return withPhotos(r.map(toMessage));
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
  return withPhotos(r.map(toMessage));
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
      and exists (select 1 from connect.internal_channel_member x where x.channel_id = c.id and x.member_id = ${meId} and x.state = 'member')
    order by m.created_at desc
    limit 50
  `);
  return withPhotos(r.map((x) => ({ ...toMessage(x), channelId: x.channel_id as string, channelName: x.channel_name as string })));
}

/** Mark a channel read for me. Only a member has a read position: opening a channel is not joining it. */
export async function markRead(channelId: string, meId: string): Promise<void> {
  await getDb().execute(sql`
    update connect.internal_channel_member set last_read_at = now()
    where channel_id = ${channelId} and member_id = ${meId} and state = 'member'
  `);
}

/**
 * Unread Internal messages for the rail and the phone tab bar: the sum of the
 * badges the Internal menu shows, over the channels and DMs I am in. Fresh
 * (db/fresh.ts) so it drops as soon as a channel is read; 0 when Internal has
 * never been opened (no tables yet) rather than an error in every page.
 */
export async function internalUnreadTotal(companyId: string, meId: string): Promise<number> {
  try {
    await ensureInternalTables(getDb());
    // New colleagues into their department channel (throttled; see the module).
    await autoJoinDepartmentChannels(companyId).catch((e) => console.warn("[internal] auto-join failed:", e));
    const r = await rows<{ n: number }>(sql`
      select coalesce(sum(${unread(meId)}), 0)::int as n
      from connect.internal_channel c
      join connect.internal_channel_member cm on cm.channel_id = c.id and cm.member_id = ${meId} and cm.state = 'member'
      where c.company_id = ${companyId} and now() is not null
    `);
    return Number(r[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
