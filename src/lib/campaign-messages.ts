import { sql } from "drizzle-orm";
import { getDb, type DB } from "@/db/client";

/*
  Which campaign sent a message: connect.message.campaign_id (migration 0011).

  Written right after each campaign send (campaigns/actions.ts) and read here
  for the list's sent / read / replied bar and the campaign detail page. Like
  member.last_seen_at (lib/presence.ts) it is NOT in schema.ts's `message`
  table: Drizzle selects the full column list on every message read — the
  inbox, the webhook, System Logs — so a deploy ahead of the migration would
  take all of them down. Raw SQL here instead; before the column exists the
  numbers simply read as unknown.

  Only campaigns sent after this shipped have per-message rows. Older ones keep
  just the totals in campaign.stats.
*/

let ensured: Promise<void> | null = null;

export function ensureCampaignColumn(db: DB): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await db.execute(sql`ALTER TABLE "connect"."message" ADD COLUMN IF NOT EXISTS "campaign_id" text`);
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS "message_campaign_idx" ON "connect"."message" ("campaign_id")`
      );
    })().catch((e) => {
      ensured = null; // never cache a failure
      throw e;
    });
  }
  return ensured;
}

/** Stamp freshly sent messages with their campaign. Best-effort. */
export async function tagCampaignMessages(campaignId: string, messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  const db = getDb();
  try {
    await ensureCampaignColumn(db);
    await db.execute(sql`
      UPDATE "connect"."message" SET "campaign_id" = ${campaignId}
      WHERE "id" IN (${sql.join(messageIds.map((id) => sql`${id}`), sql`, `)})
    `);
  } catch {
    // The send itself already happened; losing the tag only loses the stats.
  }
}

export type CampaignCounts = {
  /** Messages recorded for the campaign (one per recipient attempted). */
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
  /** Recipients who wrote back after the campaign message. */
  replied: number;
  /** Average seconds from the campaign message to the first reply. */
  avgReplySec: number | null;
};

/** Per-campaign counts for many campaigns at once. Empty map before mig 0010. */
export async function campaignCounts(ids: string[]): Promise<Map<string, CampaignCounts>> {
  const out = new Map<string, CampaignCounts>();
  if (!ids.length) return out;
  const db = getDb();
  try {
    const rows = (await db.execute(sql`
      select m.campaign_id,
        count(*)::int as total,
        count(*) filter (where m.status in ('SENT','DELIVERED','READ'))::int as sent,
        count(*) filter (where m.status = 'DELIVERED')::int as delivered,
        count(*) filter (where m.status = 'READ')::int as read,
        count(*) filter (where m.status = 'FAILED')::int as failed,
        count(*) filter (where m.status = 'QUEUED')::int as pending,
        count(r.at)::int as replied,
        avg(extract(epoch from (r.at - m.created_at))) as avg_reply
      from connect.message m
      left join lateral (
        select min(i.created_at) as at from connect.message i
        where i.conversation_id = m.conversation_id and i.direction = 'IN'
          and i.created_at > m.created_at and i.created_at < m.created_at + interval '7 days'
      ) r on r.at is not null
      where m.campaign_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      group by m.campaign_id
    `)) as unknown as {
      campaign_id: string;
      total: number;
      sent: number;
      delivered: number;
      read: number;
      failed: number;
      pending: number;
      replied: number;
      avg_reply: string | number | null;
    }[];
    for (const r of rows) {
      out.set(r.campaign_id, {
        total: r.total,
        sent: r.sent,
        delivered: r.delivered,
        read: r.read,
        failed: r.failed,
        pending: r.pending,
        replied: r.replied,
        avgReplySec: r.avg_reply == null ? null : Number(r.avg_reply),
      });
    }
  } catch {
    // Column not there yet (before migration 0011).
  }
  return out;
}

export type CampaignMessageRow = {
  id: string;
  conversationId: string;
  contactName: string | null;
  phone: string;
  status: string;
  body: string | null;
  createdAt: Date;
  replied: boolean;
  waMessageId: string | null;
};

/** One campaign's messages, newest first, with whether the customer replied. */
export async function campaignMessages(campaignId: string, limit = 500): Promise<CampaignMessageRow[]> {
  const db = getDb();
  try {
    const rows = (await db.execute(sql`
      select m.id, m.conversation_id, ct.name, ct.phone, m.status, m.body, m.created_at, m.wa_message_id,
        exists (select 1 from connect.message i where i.conversation_id = m.conversation_id
          and i.direction = 'IN' and i.created_at > m.created_at
          and i.created_at < m.created_at + interval '7 days') as replied
      from connect.message m
      join connect.conversation c on c.id = m.conversation_id
      join connect.contact ct on ct.id = c.contact_id
      where m.campaign_id = ${campaignId}
      order by m.created_at desc
      limit ${limit}
    `)) as unknown as {
      id: string;
      conversation_id: string;
      name: string | null;
      phone: string;
      status: string;
      body: string | null;
      created_at: string | Date;
      replied: boolean;
      wa_message_id: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      contactName: r.name,
      phone: r.phone,
      status: r.status,
      body: r.body,
      createdAt: new Date(r.created_at),
      replied: !!r.replied,
      waMessageId: r.wa_message_id,
    }));
  } catch {
    return [];
  }
}

export type CampaignErrorRow = { reason: string; code: string | null; count: number };

/**
 * Why a campaign's FAILED messages failed, grouped. Meta reports the error on
 * the status webhook for that message id (kept in webhook_event); a message Meta
 * refused at send time has no id at all, and is grouped as such.
 */
export async function campaignErrors(campaignId: string): Promise<CampaignErrorRow[]> {
  const db = getDb();
  try {
    const rows = (await db.execute(sql`
      select coalesce(err.title, case when m.wa_message_id is null then 'Refused by WhatsApp when sending' else 'Failed (no reason reported)' end) as reason,
        err.code, count(*)::int as n
      from connect.message m
      left join lateral (
        select s->'errors'->0->>'title' as title, s->'errors'->0->>'code' as code
        from connect.webhook_event w,
          jsonb_path_query(w.payload, '$.entry[*].changes[*].value.statuses[*]') s
        where m.wa_message_id is not null
          and w.source = 'whatsapp' and w.event_type like 'status%'
          and w.created_at >= m.created_at and w.created_at < m.created_at + interval '3 days'
          and s->>'id' = m.wa_message_id and s->>'status' = 'failed'
        limit 1
      ) err on true
      where m.campaign_id = ${campaignId} and m.status = 'FAILED'
      group by 1, 2
      order by 3 desc
    `)) as unknown as { reason: string; code: string | null; n: number }[];
    return rows.map((r) => ({ reason: r.reason, code: r.code, count: r.n }));
  } catch {
    return [];
  }
}
