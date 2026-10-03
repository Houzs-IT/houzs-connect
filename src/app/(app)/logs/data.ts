import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/*
  Reads for System Logs → Message history. Raw SQL because they join through
  conversation → contact for the company scope and read Meta's status webhooks
  (kept verbatim in webhook_event) for the per-message timeline.
*/

const TZ = "Asia/Kuala_Lumpur";

export type TodayStats = { sent: number; delivered: number; read: number; failed: number; waiting: number };

/** Outbound messages created today (Malaysian day), by where they got to. */
export async function todayStats(companyId: string): Promise<TodayStats> {
  const rows = (await getDb().execute(sql`
    select
      count(*)::int as sent,
      count(*) filter (where m.status in ('DELIVERED','READ'))::int as delivered,
      count(*) filter (where m.status = 'READ')::int as read,
      count(*) filter (where m.status = 'FAILED')::int as failed,
      count(*) filter (where m.status = 'QUEUED')::int as waiting
    from connect.message m
    join connect.conversation c on c.id = m.conversation_id
    join connect.contact ct on ct.id = c.contact_id
    where ct.company_id = ${companyId} and m.direction = 'OUT'
      and m.created_at >= (date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})
  `)) as unknown as TodayStats[];
  return rows[0] ?? { sent: 0, delivered: 0, read: 0, failed: 0, waiting: 0 };
}

export type LogRow = {
  id: string;
  conversationId: string;
  name: string | null;
  phone: string;
  body: string | null;
  type: string;
  direction: "IN" | "OUT";
  status: string;
  waMessageId: string | null;
  createdAt: Date;
  sendError: string | null;
};

export type LogFilter = { q: string; status: string; direction: string; type: string; days: number | null };

export async function logRows(companyId: string, f: LogFilter, limit = 200): Promise<LogRow[]> {
  const like = f.q ? `%${f.q}%` : null;
  const digits = f.q.replace(/\D/g, "");
  const rows = (await getDb().execute(sql`
    select m.id, m.conversation_id, ct.name, ct.phone, m.body, m.type, m.direction, m.status,
      m.wa_message_id, m.created_at,
      case when m.interactive_payload->>'kind' = 'send_error' then m.interactive_payload->>'reason' end as send_error
    from connect.message m
    join connect.conversation c on c.id = m.conversation_id
    join connect.contact ct on ct.id = c.contact_id
    where ct.company_id = ${companyId}
      ${f.status ? sql`and m.status = ${f.status}` : sql``}
      ${f.direction ? sql`and m.direction = ${f.direction}` : sql``}
      ${f.type ? sql`and m.type = ${f.type}` : sql``}
      ${f.days ? sql`and m.created_at >= now() - make_interval(days => ${f.days})` : sql``}
      ${like ? sql`and (ct.name ilike ${like} or m.body ilike ${like} ${digits ? sql`or ct.phone like ${`%${digits}%`}` : sql``})` : sql``}
    order by m.created_at desc
    limit ${limit}
  `)) as unknown as {
    id: string;
    conversation_id: string;
    name: string | null;
    phone: string;
    body: string | null;
    type: string;
    direction: "IN" | "OUT";
    status: string;
    wa_message_id: string | null;
    created_at: string | Date;
    send_error: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    name: r.name,
    phone: r.phone,
    body: r.body,
    type: r.type,
    direction: r.direction,
    status: r.status,
    waMessageId: r.wa_message_id,
    createdAt: new Date(r.created_at),
    sendError: r.send_error,
  }));
}

export type StatusEvent = { status: string; at: Date; code: string | null; title: string | null; detail: string | null };

/**
 * What Meta reported about one message, in order: sent / delivered / read /
 * failed with its error. Read from the status webhooks within a week of the send.
 */
export async function statusTimeline(waMessageId: string, createdAt: Date): Promise<StatusEvent[]> {
  try {
    const rows = (await getDb().execute(sql`
      select s->>'status' as status, s->>'timestamp' as ts,
        s->'errors'->0->>'code' as code, s->'errors'->0->>'title' as title,
        coalesce(s->'errors'->0->'error_data'->>'details', s->'errors'->0->>'message') as detail
      from connect.webhook_event w,
        jsonb_path_query(w.payload, '$.entry[*].changes[*].value.statuses[*]') s
      where w.source = 'whatsapp' and w.event_type like 'status%'
        and w.created_at >= ${createdAt} and w.created_at < ${new Date(createdAt.getTime() + 7 * 86_400_000)}
        and s->>'id' = ${waMessageId}
      order by (s->>'timestamp')::bigint
    `)) as unknown as { status: string; ts: string; code: string | null; title: string | null; detail: string | null }[];
    return rows.map((r) => ({
      status: r.status,
      at: new Date(Number(r.ts) * 1000),
      code: r.code,
      title: r.title,
      detail: r.detail,
    }));
  } catch {
    return [];
  }
}

/** The failure code and title Meta reported, for the failed rows on screen. */
export async function failureReasons(rows: LogRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const failed = rows.filter((r) => r.status === "FAILED" && r.waMessageId).slice(0, 50);
  await Promise.all(
    failed.map(async (r) => {
      const ev = (await statusTimeline(r.waMessageId!, r.createdAt)).find((e) => e.status === "failed");
      if (ev && (ev.code || ev.title)) out.set(r.id, [ev.code, ev.title].filter(Boolean).join(" · "));
    })
  );
  return out;
}
