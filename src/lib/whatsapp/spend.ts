// What Meta charged this WhatsApp Business Account this month, per category.
//
// Month to date is asked for DAILY and added up: Meta answers MONTHLY only for
// a window of whole months ("You must [use a full month] time window to get
// monthly granularity data").
//
// Tries the per-message pricing analytics first (Meta's current billing model)
// and falls back to the older conversation analytics. Either may be refused for
// a token without whatsapp_business_management; the error is passed through so
// the page can say so instead of showing zeros.
//
// Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/analytics

import { graph } from "./graph";
import { templateConfig } from "./templates";

const GRAPH = "https://graph.facebook.com/v23.0";

export type Spend = { ok: true; currency: string; rows: { category: string; cost: number; volume: number }[]; source: "pricing" | "conversation" } | { ok: false; error: string };

type Point = { pricing_category?: string; conversation_category?: string; cost?: number; volume?: number; conversation?: number };

export async function monthSpend(): Promise<Spend> {
  const cfg = templateConfig();
  if (!cfg) return { ok: false, error: "WhatsApp is not connected." };
  const ym = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).slice(0, 7);
  const start = Math.floor(new Date(`${ym}-01T00:00:00+08:00`).getTime() / 1000);
  const end = Math.floor(Date.now() / 1000);

  const cur = await graph<{ currency?: string }>(`${GRAPH}/${cfg.wabaId}?fields=currency`, cfg.token);
  const currency = cur.ok ? (cur.data.currency ?? "USD") : "USD";

  const tally = (points: Point[], key: "pricing_category" | "conversation_category", vol: "volume" | "conversation") => {
    const by = new Map<string, { cost: number; volume: number }>();
    for (const p of points) {
      const k = (p[key] ?? "OTHER").toUpperCase();
      const x = by.get(k) ?? { cost: 0, volume: 0 };
      x.cost += Number(p.cost ?? 0);
      x.volume += Number(p[vol] ?? 0);
      by.set(k, x);
    }
    return [...by.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.cost - a.cost);
  };

  const pricing = await graph<{ pricing_analytics?: { data?: { data_points?: Point[] }[] } }>(
    `${GRAPH}/${cfg.wabaId}?fields=pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"]).metric_types(["COST","VOLUME"])`,
    cfg.token
  );
  if (pricing.ok) {
    const points = pricing.data.pricing_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? [];
    return { ok: true, currency, rows: tally(points, "pricing_category", "volume"), source: "pricing" };
  }
  const convo = await graph<{ conversation_analytics?: { data?: { data_points?: Point[] }[] } }>(
    `${GRAPH}/${cfg.wabaId}?fields=conversation_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["CONVERSATION_CATEGORY"]).metric_types(["COST","CONVERSATION"])`,
    cfg.token
  );
  if (convo.ok) {
    const points = convo.data.conversation_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? [];
    return { ok: true, currency, rows: tally(points, "conversation_category", "conversation"), source: "conversation" };
  }
  return { ok: false, error: pricing.error };
}
