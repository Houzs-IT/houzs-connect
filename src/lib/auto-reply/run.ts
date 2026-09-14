// Send a company's automatic reply for one customer message, if one is due.
//
// Called from the WhatsApp webhook after the message is saved and only when no
// automation took it — a flow waiting on a button tap must not have a greeting
// land in the middle of it. The decision is ./decide.ts; this file only reads
// what it needs and sends through the normal transport, so the reply goes out
// from the conversation's own number and is recorded like any other message.

import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { ensureAutoReplyTable } from "@/db/ensure-auto-reply";
import { autoReply, message } from "@/db/schema";
import { sendOutbound } from "@/lib/whatsapp/transport";
import { decideAutoReply, type WeekHours } from "./decide";

/** Marks a message row as an automatic reply, so the next decision can find it. */
export const AUTO_REPLY_KIND = "auto_reply";

export async function maybeAutoReply(
  db: DB,
  args: { conversationId: string; companyId: string; inboundMessageId: string; now?: Date }
): Promise<"away" | "welcome" | null> {
  await ensureAutoReplyTable(db);
  const settings = await db.query.autoReply.findFirst({
    where: eq(autoReply.companyId, args.companyId),
  });
  if (!settings || (!settings.welcomeEnabled && !settings.awayEnabled)) return null;

  const [previousInbound, recentAutos] = await Promise.all([
    db.query.message.findFirst({
      columns: { createdAt: true },
      where: and(
        eq(message.conversationId, args.conversationId),
        eq(message.direction, "IN"),
        ne(message.id, args.inboundMessageId)
      ),
      orderBy: desc(message.createdAt),
    }),
    db
      .select({ createdAt: message.createdAt, payload: message.interactivePayload })
      .from(message)
      .where(
        and(
          eq(message.conversationId, args.conversationId),
          eq(message.direction, "OUT"),
          sql`${message.interactivePayload}->>'kind' = ${AUTO_REPLY_KIND}`
        )
      )
      .orderBy(desc(message.createdAt))
      .limit(20),
  ]);
  const lastOf = (which: string) =>
    recentAutos.find((r) => (r.payload as { which?: string } | null)?.which === which)?.createdAt ?? null;

  const which = decideAutoReply({
    settings: { ...settings, hours: (settings.hours as WeekHours | null) ?? null },
    now: args.now ?? new Date(),
    previousInboundAt: previousInbound?.createdAt ?? null,
    lastWelcomeAt: lastOf("welcome"),
    lastAwayAt: lastOf("away"),
  });
  if (!which) return null;

  await sendOutbound(args.conversationId, which === "away" ? settings.awayText : settings.welcomeText, {
    isBot: true,
    payload: { kind: AUTO_REPLY_KIND, which },
  });
  return which;
}
