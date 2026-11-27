// AI Connector round 4b — the switches and the single-use proposals
// (migration 0028, src/db/ensure-mcp.ts). Same design as Hookka's
// mcp-actions.ts (hookka-erp-testing PR #1633):
//
//   - a main "Allow AI actions" switch, and one switch per action, all OFF
//     until a connector admin (Super Admin / Owner) turns them on in Settings →
//     AI Connector. A missing row is OFF.
//   - propose_* stores ONE pending action (nothing is written to Connect) and
//     returns its confirmationId; confirm_action claims it with a single UPDATE
//     … RETURNING (used once, 10 minutes, same token and same person), then the
//     action runs ONCE as the person.
//   - a daily cap per person on confirmed actions.
//
// Every comparison against time uses Postgres now() (a stable function), so
// Hyperdrive never answers it from its read cache (src/db/fresh.ts).

import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { ensureMcpTables } from "@/db/ensure-mcp";
import { randomToken } from "./core";

type Row = Record<string, unknown>;
const rows = async (db: DB, q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

export const ACTION_TTL_MS = 10 * 60 * 1000;
export const ACTIONS_PER_DAY = 30;
export const MAIN_SWITCH = "actions";
export const ACTIONS_OFF_MESSAGE = "AI actions are switched off by your admin (Settings → AI Connector).";

/** The write actions (owner approved 2026-11-26). Never: campaigns / broadcasts, deletes, contact imports. */
export const WRITE_KINDS = ["chat_reply", "conversation_assign", "contact_note"] as const;
export type WriteKind = (typeof WRITE_KINDS)[number];
export const isWriteKind = (v: unknown): v is WriteKind => typeof v === "string" && (WRITE_KINDS as readonly string[]).includes(v);

/** What each switch is called on the admin page. The reply one says plainly that it reaches the customer. */
export const WRITE_LABELS: Record<WriteKind, { title: string; sub: string }> = {
  chat_reply: {
    title: "Reply to customers — SENDS TO THE CUSTOMER",
    sub: "The AI drafts a WhatsApp reply; after the person says yes it is sent to the customer from Houzs Connect, as that person. Only inside the 24-hour reply window.",
  },
  conversation_assign: {
    title: "Assign, reassign or resolve conversations",
    sub: "Change who has a chat (person / department) or its status (open, pending, resolved), after the person says yes.",
  },
  contact_note: {
    title: "Add notes to contacts",
    sub: "Add a line to a contact's Remarks, or an internal note on a chat (never sent to the customer), after the person says yes.",
  },
};

export const actionOffMessage = (k: WriteKind) => `"${WRITE_LABELS[k].title}" is switched off by your admin (Settings → AI Connector).`;

/** The day (Malaysia time, UTC+8) a timestamp falls in, as the UTC instant of its midnight. */
export function myDayStartIso(now = Date.now()): string {
  const my = new Date(now + 8 * 3600_000);
  return new Date(Date.UTC(my.getUTCFullYear(), my.getUTCMonth(), my.getUTCDate()) - 8 * 3600_000).toISOString();
}

export type Switches = { main: boolean } & Record<WriteKind, boolean>;

export async function readSwitches(db: DB): Promise<Switches> {
  await ensureMcpTables(db);
  const r = await rows(db, sql`select key, enabled from connect.mcp_settings where now() is not null`);
  const on = new Map(r.map((x) => [String(x.key), x.enabled === true]));
  return {
    main: on.get(MAIN_SWITCH) === true,
    chat_reply: on.get("chat_reply") === true,
    conversation_assign: on.get("conversation_assign") === true,
    contact_note: on.get("contact_note") === true,
  };
}

/** Admin only — the caller (Settings → AI Connector actions.ts) checks the role. */
export async function setSwitch(db: DB, key: string, enabled: boolean, byMemberId: string): Promise<boolean> {
  if (key !== MAIN_SWITCH && !isWriteKind(key)) return false;
  await ensureMcpTables(db);
  await db.execute(sql`
    insert into connect.mcp_settings (key, enabled, updated_by_member_id, updated_at) values (${key}, ${enabled}, ${byMemberId}, now())
    on conflict (key) do update set enabled = excluded.enabled, updated_by_member_id = excluded.updated_by_member_id, updated_at = now()
  `);
  return true;
}

/** May an action of this kind run now? null = yes; otherwise the plain refusal. */
export function kindRefusal(sw: Switches, kind: WriteKind): string | null {
  if (!sw.main) return ACTIONS_OFF_MESSAGE;
  if (!sw[kind]) return actionOffMessage(kind);
  return null;
}

const newId = () => `mcpx_${randomToken(18).replace(/[^A-Za-z0-9]/g, "").slice(0, 24).padEnd(24, "0")}`;
export const CONFIRMATION_ID = /^mcpx_[A-Za-z0-9]{24}$/;

export type Pending = { kind: WriteKind; payload: Record<string, unknown>; summary: string };

/** The store a propose → confirm round trip needs; Postgres here, an in-memory fake in scripts/smoke-mcp-actions.mjs. */
export type ActionStore = {
  switches(): Promise<Switches>;
  create(a: { tokenId: string; memberId: string; email: string; kind: WriteKind; payload: Record<string, unknown>; summary: string }): Promise<string>;
  /** The kind of a pending action this token + person may still confirm, without claiming it. */
  peek(id: string, tokenId: string, memberId: string): Promise<WriteKind | null>;
  /** Single use: claims the row; a second call finds it used. */
  consume(id: string, tokenId: string, memberId: string): Promise<Pending | null>;
  /** Keep the outcome, drop the payload (the message text). */
  finish(id: string, status: number, note: string): Promise<void>;
  cancel(id: string, tokenId: string, memberId: string): Promise<boolean>;
  /** Confirmed actions by this person (email) since `sinceIso`. */
  confirmedSince(email: string, sinceIso: string): Promise<number>;
};

export function pgActionStore(db: DB): ActionStore {
  return {
    switches: () => readSwitches(db),
    async create(a) {
      await ensureMcpTables(db);
      const id = newId();
      await db.execute(sql`
        insert into connect.mcp_pending_actions (id, token_id, member_id, email, kind, payload, summary, expires_at)
        values (${id}, ${a.tokenId}, ${a.memberId}, ${a.email.toLowerCase()}, ${a.kind}, ${JSON.stringify(a.payload)}::jsonb, ${a.summary.slice(0, 4000)},
          now() + make_interval(secs => ${ACTION_TTL_MS / 1000}))
      `);
      return id;
    },
    async peek(id, tokenId, memberId) {
      await ensureMcpTables(db);
      const r = await rows(db, sql`
        select kind from connect.mcp_pending_actions
        where id = ${id} and token_id = ${tokenId} and member_id = ${memberId} and used_at is null and cancelled_at is null and expires_at > now()
      `);
      const k = r[0]?.kind;
      return isWriteKind(k) ? k : null;
    },
    async consume(id, tokenId, memberId) {
      await ensureMcpTables(db);
      const r = await rows(db, sql`
        update connect.mcp_pending_actions set used_at = now()
        where id = ${id} and token_id = ${tokenId} and member_id = ${memberId} and used_at is null and cancelled_at is null and expires_at > now()
        returning kind, payload, summary
      `);
      const x = r[0];
      if (!x || !isWriteKind(x.kind)) return null;
      const payload = typeof x.payload === "string" ? (JSON.parse(x.payload) as Record<string, unknown>) : ((x.payload ?? {}) as Record<string, unknown>);
      return { kind: x.kind, payload, summary: String(x.summary ?? "") };
    },
    async finish(id, status, note) {
      try {
        await db.execute(sql`update connect.mcp_pending_actions set payload = null, outcome_status = ${status}, outcome_note = ${note.slice(0, 300)} where id = ${id}`);
      } catch (e) {
        console.warn("[mcp] finish action failed:", e instanceof Error ? e.message : String(e));
      }
    },
    async cancel(id, tokenId, memberId) {
      await ensureMcpTables(db);
      const r = await rows(db, sql`
        update connect.mcp_pending_actions set cancelled_at = now(), payload = null
        where id = ${id} and token_id = ${tokenId} and member_id = ${memberId} and used_at is null and cancelled_at is null
        returning id
      `);
      return r.length > 0;
    },
    async confirmedSince(email, sinceIso) {
      await ensureMcpTables(db);
      const r = await rows(db, sql`
        select count(*)::int as n from connect.mcp_pending_actions
        where email = ${email.toLowerCase()} and used_at is not null and used_at >= ${sinceIso}::timestamptz
      `);
      return Number(r[0]?.n ?? 0);
    },
  };
}
