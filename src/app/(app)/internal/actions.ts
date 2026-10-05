"use server";

import { createId } from "@paralleldrive/cuid2";
import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureInternalTables } from "@/db/ensure-internal";
import { getCurrentMember } from "@/lib/current-member";
import { isAdminRole } from "@/lib/permissions";
import { channelInfo, markRead, slug } from "./data";

type Rows<T> = T[];
const q = async <T,>(s: ReturnType<typeof sql>) => (await getDb().execute(s)) as unknown as Rows<T>;

/** Signed in, tables present. Every action below is scoped to `me.companyId`. */
async function ctx() {
  const me = await getCurrentMember();
  if (!me) return null;
  await ensureInternalTables(getDb());
  return me;
}

/**
 * Who a message mentions: "@Name" for any colleague in this company (longest
 * names first, so "@Lee Wei" does not also count as "@Lee"), and "@channel".
 */
async function mentionsIn(companyId: string, body: string): Promise<string[]> {
  if (!body.includes("@")) return [];
  const people = await q<{ id: string; name: string }>(sql`
    select id, name from connect.member where company_id = ${companyId} and active = true
  `);
  const lower = body.toLowerCase();
  const out = new Set<string>();
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    if (lower.includes(`@${p.name.toLowerCase()}`)) out.add(p.id);
  }
  if (/@(channel|here)\b/i.test(body)) out.add("channel");
  return [...out];
}

export async function postMessage(input: {
  channelId: string;
  body: string;
  parentId?: string | null;
  alsoInChannel?: boolean;
  conversationId?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const body = input.body.trim().slice(0, 4000);
  if (!body && !input.conversationId) return { ok: false, error: "Write something first." };
  const ch = await channelInfo(me.companyId, input.channelId, me.id);
  if (!ch) return { ok: false, error: "Channel not found." };
  if (!ch.isMember) return { ok: false, error: "Join this channel to post in it." };

  let parentId: string | null = null;
  if (input.parentId) {
    const p = await q<{ id: string; parent_id: string | null }>(sql`
      select id, parent_id from connect.internal_message where id = ${input.parentId} and channel_id = ${ch.id}
    `);
    if (!p[0]) return { ok: false, error: "That thread is gone." };
    parentId = p[0].parent_id ?? p[0].id; // a reply to a reply joins the same thread
  }

  let conversationId: string | null = null;
  if (input.conversationId) {
    const c = await q<{ id: string }>(sql`
      select cv.id from connect.conversation cv join connect.contact ct on ct.id = cv.contact_id
      where cv.id = ${input.conversationId} and ct.company_id = ${me.companyId}
    `);
    if (!c[0]) return { ok: false, error: "That conversation is not in this company." };
    conversationId = c[0].id;
  }

  const id = createId();
  const mentions = await mentionsIn(me.companyId, body);
  await getDb().execute(sql`
    insert into connect.internal_message (id, channel_id, author_member_id, body, parent_id, also_in_channel, conversation_id, mentions)
    values (${id}, ${ch.id}, ${me.id}, ${body}, ${parentId}, ${!!(parentId && input.alsoInChannel)}, ${conversationId},
      ${mentions.length ? JSON.stringify(mentions) : null}::jsonb)
  `);
  await markRead(ch.id, me.id);
  revalidatePath("/internal", "layout");
  return { ok: true, id };
}

type Access = "open" | "approval";
const cleanAccess = (a: unknown): Access => (a === "approval" ? "approval" : "open");

/**
 * Make a channel. Whoever makes it is its admin; `memberIds` are added as
 * members (colleagues in this company only).
 */
export async function createChannel(
  name: string,
  topic: string,
  access: Access = "open",
  memberIds: string[] = []
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const clean = slug(name);
  if (!name.trim()) return { ok: false, error: "Give the channel a name." };
  const dup = await q<{ id: string }>(sql`
    select id from connect.internal_channel where company_id = ${me.companyId} and kind = 'channel' and name = ${clean}
  `);
  if (dup[0]) return { ok: false, error: `#${clean} already exists.` };
  const id = createId();
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`
      insert into connect.internal_channel (id, company_id, kind, name, topic, created_by_member_id, access)
      values (${id}, ${me.companyId}, 'channel', ${clean}, ${topic.trim().slice(0, 120) || null}, ${me.id}, ${cleanAccess(access)})
    `);
    await tx.execute(sql`
      insert into connect.internal_channel_member (channel_id, member_id, state, role, last_read_at)
      values (${id}, ${me.id}, 'member', 'admin', now())
    `);
    const others = [...new Set(memberIds)].filter((m) => m && m !== me.id).slice(0, 500);
    if (others.length) {
      await tx.execute(sql`
        insert into connect.internal_channel_member (channel_id, member_id, state, role)
        select ${id}, m.id, 'member', 'member' from connect.member m
        where m.company_id = ${me.companyId} and m.active = true and m.id in ${sql`(${sql.join(others.map((o) => sql`${o}`), sql`, `)})`}
        on conflict (channel_id, member_id) do nothing
      `);
    }
  });
  revalidatePath("/internal", "layout");
  return { ok: true, id };
}

/**
 * A channel this person may manage (members, settings, delete): a company
 * admin any channel, otherwise an admin of that channel.
 */
async function managed(me: { companyId: string; id: string; role: string }, id: string) {
  const r = await q<{ id: string; my_role: string | null; my_state: string | null }>(sql`
    select c.id, x.role as my_role, x.state as my_state
    from connect.internal_channel c
    left join connect.internal_channel_member x on x.channel_id = c.id and x.member_id = ${me.id}
    where c.id = ${id} and c.company_id = ${me.companyId} and c.kind = 'channel'
  `);
  const ch = r[0];
  if (!ch) return { error: "Channel not found." } as const;
  if (!isAdminRole(me.role) && !(ch.my_role === "admin" && ch.my_state === "member")) {
    return { error: "Only an admin of this channel, or a company admin, can do that." } as const;
  }
  return { ch } as const;
}

export async function updateChannel(id: string, name: string, topic: string, access?: Access): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!name.trim()) return { ok: false, error: "Give the channel a name." };
  const own = await managed(me, id);
  if ("error" in own) return { ok: false, error: own.error };
  const clean = slug(name);
  const dup = await q<{ id: string }>(sql`
    select id from connect.internal_channel
    where company_id = ${me.companyId} and kind = 'channel' and name = ${clean} and id <> ${id}
  `);
  if (dup[0]) return { ok: false, error: `#${clean} already exists.` };
  await getDb().execute(sql`
    update connect.internal_channel
    set name = ${clean}, topic = ${topic.trim().slice(0, 120) || null}
      ${access ? sql`, access = ${cleanAccess(access)}` : sql``}
    where id = ${id}
  `);
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/**
 * Delete a channel with its messages and read markers. The last channel stays:
 * a company with none gets the default set made again on its next visit
 * (data.ts ensureInternal), which would look like the delete did not happen.
 */
export async function deleteChannel(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const own = await managed(me, id);
  if ("error" in own) return { ok: false, error: own.error };
  const n = await q<{ n: number }>(sql`
    select count(*)::int as n from connect.internal_channel where company_id = ${me.companyId} and kind = 'channel'
  `);
  if ((n[0]?.n ?? 0) <= 1) return { ok: false, error: "Keep at least one channel." };
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`delete from connect.internal_message where channel_id = ${id}`);
    await tx.execute(sql`delete from connect.internal_channel_member where channel_id = ${id}`);
    await tx.execute(sql`delete from connect.internal_channel where id = ${id} and company_id = ${me.companyId}`);
  });
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/**
 * Join a channel: straight in when it is open (or for a company admin);
 * otherwise a request that a channel admin approves.
 */
export async function joinChannel(id: string): Promise<{ ok: boolean; state?: "member" | "pending"; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const ch = await channelInfo(me.companyId, id, me.id);
  if (!ch || ch.kind !== "channel") return { ok: false, error: "Channel not found." };
  if (ch.isMember) return { ok: true, state: "member" };
  const direct = ch.access === "open" || isAdminRole(me.role);
  await getDb().execute(sql`
    insert into connect.internal_channel_member (channel_id, member_id, state, role, requested_at, last_read_at)
    values (${id}, ${me.id}, ${direct ? "member" : "pending"}, 'member', now(), ${direct ? sql`now()` : sql`null`})
    on conflict (channel_id, member_id) do update set state = excluded.state, requested_at = now()
  `);
  revalidatePath("/internal", "layout");
  return { ok: true, state: direct ? "member" : "pending" };
}

/** Withdraw my request to join. */
export async function cancelJoinRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  await getDb().execute(sql`
    delete from connect.internal_channel_member where channel_id = ${id} and member_id = ${me.id} and state = 'pending'
  `);
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/** Leave a channel (not a DM). */
export async function leaveChannel(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  await getDb().execute(sql`
    delete from connect.internal_channel_member x
    using connect.internal_channel c
    where x.channel_id = c.id and c.id = ${id} and c.company_id = ${me.companyId} and c.kind = 'channel' and x.member_id = ${me.id}
  `);
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/** Approve or decline a request to join. */
export async function decideJoinRequest(id: string, memberId: string, approve: boolean): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const own = await managed(me, id);
  if ("error" in own) return { ok: false, error: own.error };
  await getDb().execute(
    approve
      ? sql`update connect.internal_channel_member set state = 'member', joined_at = now()
            where channel_id = ${id} and member_id = ${memberId} and state = 'pending'`
      : sql`delete from connect.internal_channel_member where channel_id = ${id} and member_id = ${memberId} and state = 'pending'`
  );
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/** Add colleagues to a channel (a pending request among them is approved). */
export async function addChannelMembers(id: string, memberIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const own = await managed(me, id);
  if ("error" in own) return { ok: false, error: own.error };
  const ids = [...new Set(memberIds)].filter(Boolean).slice(0, 500);
  if (!ids.length) return { ok: true };
  await getDb().execute(sql`
    insert into connect.internal_channel_member (channel_id, member_id, state, role)
    select ${id}, m.id, 'member', 'member' from connect.member m
    where m.company_id = ${me.companyId} and m.active = true and m.id in ${sql`(${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`}
    on conflict (channel_id, member_id) do update set state = 'member'
  `);
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/** Take someone out of a channel. */
export async function removeChannelMember(id: string, memberId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const own = await managed(me, id);
  if ("error" in own) return { ok: false, error: own.error };
  await getDb().execute(sql`delete from connect.internal_channel_member where channel_id = ${id} and member_id = ${memberId}`);
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/** Make a member an admin of the channel, or back to a member. */
export async function setChannelRole(id: string, memberId: string, role: "admin" | "member"): Promise<{ ok: boolean; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  const own = await managed(me, id);
  if ("error" in own) return { ok: false, error: own.error };
  await getDb().execute(sql`
    update connect.internal_channel_member set role = ${role === "admin" ? "admin" : "member"}
    where channel_id = ${id} and member_id = ${memberId} and state = 'member'
  `);
  revalidatePath("/internal", "layout");
  return { ok: true };
}

/** The DM between me and a colleague — created on first use, one per pair. */
export async function openDm(otherId: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const me = await ctx();
  if (!me) return { ok: false, error: "Not signed in." };
  if (otherId === me.id) return { ok: false, error: "Pick a colleague." };
  const other = await q<{ id: string; name: string }>(sql`
    select id, name from connect.member where id = ${otherId} and company_id = ${me.companyId} and active = true
  `);
  if (!other[0]) return { ok: false, error: "Colleague not found." };
  const key = [me.id, otherId].sort().join(":");
  const found = await q<{ id: string }>(sql`
    select id from connect.internal_channel where company_id = ${me.companyId} and dm_key = ${key}
  `);
  if (found[0]) return { ok: true, id: found[0].id };
  const id = createId();
  const db = getDb();
  await db.execute(sql`
    insert into connect.internal_channel (id, company_id, kind, name, dm_key, created_by_member_id)
    values (${id}, ${me.companyId}, 'dm', ${other[0].name}, ${key}, ${me.id})
    on conflict (company_id, dm_key) do nothing
  `);
  const row = await q<{ id: string }>(sql`
    select id from connect.internal_channel where company_id = ${me.companyId} and dm_key = ${key}
  `);
  const cid = row[0]?.id ?? id;
  await db.execute(sql`
    insert into connect.internal_channel_member (channel_id, member_id) values (${cid}, ${me.id}), (${cid}, ${otherId})
    on conflict do nothing
  `);
  revalidatePath("/internal", "layout");
  return { ok: true, id: cid };
}

/** Customer conversations to link into a message, by name, phone or order ref. */
export async function findConversations(text: string): Promise<{ id: string; name: string; phone: string; orderRef: string | null }[]> {
  const me = await getCurrentMember();
  if (!me) return [];
  const t = text.trim();
  if (t.length < 2) return [];
  const like = `%${t}%`;
  const digits = t.replace(/\D/g, "");
  const r = await q<{ id: string; name: string | null; phone: string; ref: string | null }>(sql`
    select distinct on (ct.id) cv.id, ct.name, ct.phone, ct.attributes->>'ref_1' as ref
    from connect.conversation cv join connect.contact ct on ct.id = cv.contact_id
    where ct.company_id = ${me.companyId}
      and (ct.name ilike ${like} or ct.attributes->>'ref_1' ilike ${like} ${digits.length >= 3 ? sql`or ct.phone like ${`%${digits}%`}` : sql``})
    order by ct.id, cv.last_message_at desc nulls last
    limit 8
  `);
  return r.map((x) => ({ id: x.id, name: x.name || x.phone, phone: x.phone, orderRef: x.ref }));
}

export async function markChannelRead(channelId: string): Promise<void> {
  const me = await ctx();
  if (!me) return;
  const ch = await channelInfo(me.companyId, channelId, me.id);
  if (ch) await markRead(ch.id, me.id);
}
