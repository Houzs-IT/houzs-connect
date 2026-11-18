// Sends what Meta charged each company to the Houzs IT Hub, once a day, from the cron tick.
//
// The hub keeps one WhatsApp bill for the whole account and shares it between the companies
// (Houzs Century, Hookka, 2990s) by these amounts, on its Finance → System billing page.
// This month and last month are sent each time: the hub replaces a month it already has, and
// last month's figures keep settling for a few days after it ends.
//
// One attempt a day after a success, one an hour after a failure; each attempt is written to
// System Logs (webhook_event, source "hub") with the hub's or Meta's answer.

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bypassReadCache } from "@/db/fresh";
import { webhookEvent } from "@/db/schema";
import { loadBilling } from "@/lib/billing";
import { recentMonths, sumCost } from "@/lib/whatsapp/spend";

const VENDOR = "Meta (WhatsApp Business)";
const OK = "hub:whatsapp-usage:ok";
const RETRY_MS = 60 * 60 * 1000;

const mytDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });

export async function sendWhatsAppUsageToHub(): Promise<{ sent: number } | { skipped: string }> {
  const { env } = getCloudflareContext();
  const base = (env.IT_HUB_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.IT_HUB_API_KEY ?? "").trim();
  if (!base || !key) return { skipped: "hub not connected" };

  const db = getDb();
  const [last] = await db
    .select({ eventType: webhookEvent.eventType, createdAt: webhookEvent.createdAt })
    .from(webhookEvent)
    .where(and(eq(webhookEvent.source, "hub"), gte(webhookEvent.createdAt, new Date(Date.now() - 2 * 86_400_000)), bypassReadCache()))
    .orderBy(desc(webhookEvent.createdAt))
    .limit(1);
  if (last?.eventType === OK && mytDay(last.createdAt) === mytDay(new Date())) return { skipped: "sent today" };
  if (last && last.eventType !== OK && Date.now() - last.createdAt.getTime() < RETRY_MS) return { skipped: "failed within the hour" };

  const log = (eventType: string, payload: Record<string, unknown>) =>
    db.insert(webhookEvent).values({ source: "hub", eventType, payload, processed: true }).catch(() => undefined);

  let currency = "MYR";
  const months = [];
  for (const month of recentMonths(2)) {
    const { bill, companies } = await loadBilling(month);
    if (!bill.ok) {
      await log("hub:whatsapp-usage:error", { stage: "meta", month, error: bill.error });
      throw new Error(`Meta did not give ${month}'s spend: ${bill.error}`);
    }
    currency = bill.currency;
    const rows = companies.map((c) => ({ id: c.id, name: c.name, code: c.code, cost: sumCost(c.rows) }));
    // Charges on a number no company holds still reach the hub, so its split adds up to Meta's bill.
    if (bill.unassigned.length) rows.push({ id: "unassigned", name: "Not assigned to a company", code: null, cost: sumCost(bill.unassigned) });
    months.push({ month, rows });
  }

  let status = 0;
  let answer = "";
  try {
    const res = await fetch(`${base}/api/v1/sys/usage-costs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ vendor: VENDOR, currency, months }),
      signal: AbortSignal.timeout(20_000),
    });
    status = res.status;
    answer = (await res.text().catch(() => "")).slice(0, 300);
  } catch (e) {
    answer = e instanceof Error ? e.message : String(e);
  }
  const ok = status >= 200 && status < 300;
  await log(ok ? OK : "hub:whatsapp-usage:error", { stage: "hub", status, answer, months });
  if (!ok) throw new Error(`The hub did not take the WhatsApp usage (${status || "no answer"}): ${answer}`);
  return { sent: months.length };
}
