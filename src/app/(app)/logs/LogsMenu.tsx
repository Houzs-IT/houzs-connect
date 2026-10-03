import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, conversation, message, webhookEvent } from "@/db/schema";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";

const SOURCE_DOT: Record<string, string> = {
  whatsapp: "var(--color-success)",
  erp: "var(--color-pastel-orange-ink)",
  driver: "var(--color-pastel-cyan-ink)",
  numbers: "var(--color-pastel-purple-ink)",
};

/** System Logs menu: both logs with their sizes, message problems, webhook sources. */
export async function LogsMenu() {
  const t = await getDict();
  const L = t.logs;
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const mine = eq(contact.companyId, me.companyId);
  const msgCount = (extra?: ReturnType<typeof eq>) =>
    db
      .select({ n: count() })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .innerJoin(contact, eq(contact.id, conversation.contactId))
      .where(extra ? and(mine, extra) : mine)
      .then((r) => r[0]?.n ?? 0);
  const [total, failed, queued, sources] = await Promise.all([
    msgCount(),
    msgCount(eq(message.status, "FAILED")),
    msgCount(eq(message.status, "QUEUED")),
    db.select({ source: webhookEvent.source, n: count() }).from(webhookEvent).groupBy(webhookEvent.source),
  ]);
  const hooks = sources.reduce((n, s) => n + s.n, 0);

  return (
    <SecondaryMenu
      title={t.nav.logs}
      groups={[
        {
          title: L.logs,
          items: [
            { href: "/logs", label: L.messageHistory, count: total.toLocaleString("en-US"), exact: true },
            { href: "/logs/webhooks", label: L.webhooks, count: hooks.toLocaleString("en-US"), exact: true },
          ],
        },
        {
          title: L.msgStatus,
          items: [
            { href: "/logs?status=FAILED", label: L.failed, count: failed, dot: "var(--color-danger)" },
            { href: "/logs?status=QUEUED", label: L.waiting, count: queued, dot: "var(--color-pastel-orange-ink)" },
          ],
        },
        {
          title: L.source,
          items: sources.map((s) => ({
            href: `/logs/webhooks?source=${encodeURIComponent(s.source)}`,
            label: L.src[s.source] ?? s.source,
            count: s.n.toLocaleString("en-US"),
            dot: SOURCE_DOT[s.source] ?? "var(--color-border-strong)",
          })),
        },
      ]}
    />
  );
}
