// New colleagues join their department's Internal channel by themselves.
//
// A department channel (internal_channel.department_id) holds that
// department's people (internal/data.ts settleMembership did it once for the
// existing ones). Someone who arrives later — an ERP sync adds a hire, or moves
// someone to another department — is added to that channel the first time
// they are seen there, and recorded in internal_channel_auto. The record is
// what keeps a person who left the channel, or whom an admin removed, from
// being put back: each (channel, person) pair is joined automatically once.
//
// The first run for a company only records who is in its department channels
// now, without adding anyone: those were settled already, and anyone missing
// left or was removed on purpose.

import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { ensureInternalTables } from "@/db/ensure-internal";

/** Per isolate: when each company (or "*" for all) was last checked. */
const lastRun = new Map<string, number>();
const EVERY_MS = 2 * 60 * 1000;

/**
 * Add new department members to their department channel. `companyId` null
 * checks every company (after an ERP sync). Throttled to once every two
 * minutes per company unless `force`.
 */
export async function autoJoinDepartmentChannels(companyId: string | null, force = false): Promise<void> {
  const key = companyId ?? "*";
  const now = Date.now();
  if (!force && now - (lastRun.get(key) ?? 0) < EVERY_MS) return;
  lastRun.set(key, now);

  const db = getDb();
  await ensureInternalTables(db);
  const scope = companyId ? sql`and c.company_id = ${companyId}` : sql``;
  await db.transaction(async (tx) => {
    // First run for a company: remember who is in its department channels'
    // departments now, so only people who arrive from here on are added.
    await tx.execute(sql`
      insert into connect.internal_channel_auto (channel_id, member_id)
      select c.id, m.id
      from connect.internal_channel c
      join connect.member m on m.company_id = c.company_id and m.department_id = c.department_id
      where c.kind = 'channel' and c.department_id is not null and c.access is not null ${scope}
        and not exists (
          select 1 from connect.internal_channel_auto a
          join connect.internal_channel c2 on c2.id = a.channel_id
          where c2.company_id = c.company_id
        )
      on conflict do nothing
    `);
    // Everyone in a department channel's department who has not been put in
    // it before joins it now (a waiting request to join becomes membership).
    await tx.execute(sql`
      with cand as (
        select c.id as channel_id, m.id as member_id
        from connect.internal_channel c
        join connect.member m on m.company_id = c.company_id and m.department_id = c.department_id and m.active = true
        where c.kind = 'channel' and c.department_id is not null and c.access is not null ${scope}
          and not exists (select 1 from connect.internal_channel_auto a where a.channel_id = c.id and a.member_id = m.id)
      ), joined as (
        insert into connect.internal_channel_member (channel_id, member_id, state, role, joined_at)
        select channel_id, member_id, 'member', 'member', now() from cand
        on conflict (channel_id, member_id) do update set state = 'member'
      ), logged as (
        insert into connect.internal_channel_event (id, channel_id, action, target_member_id)
        select gen_random_uuid()::text, channel_id, 'auto_joined', member_id from cand
      )
      insert into connect.internal_channel_auto (channel_id, member_id)
      select channel_id, member_id from cand
      on conflict do nothing
    `);
  });
}
