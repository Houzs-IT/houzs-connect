import { getCurrentMember } from "@/lib/current-member";
import { agentsReport, conversationStatus, messageVolume, replyStats, supportStats } from "../queries";
import { parsePeriod, periodWindow } from "../util";

/**
 * Dashboard → Export: the period's headline figures and the agents report as
 * one CSV, from the same queries the page renders. Company-scoped by the
 * signed-in member; anyone signed out gets 401.
 */
export async function GET(req: Request) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const w = periodWindow(parsePeriod(new URL(req.url).searchParams.get("period") ?? undefined));
  const [replies, vol, status, support, agents] = await Promise.all([
    replyStats(me.companyId, w.since),
    messageVolume(me.companyId, w),
    conversationStatus(me.companyId, w),
    supportStats(me.companyId, w),
    agentsReport(me.companyId, w),
  ]);

  const cell = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const row = (...v: unknown[]) => v.map(cell).join(",");
  const secs = (n: number | null) => (n == null ? "" : Math.round(n));

  const lines = [
    row("Houzs Connect dashboard export", w.rangeLabel),
    "",
    row("Metric", "Value"),
    row("Conversations where the customer wrote", replies.asked),
    row("…of which replied", replies.answered),
    row("Reply rate %", replies.asked ? ((replies.answered / replies.asked) * 100).toFixed(1) : ""),
    row("Avg first reply (s)", secs(replies.avgFirst)),
    row("Avg reply (s)", secs(replies.avgReply)),
    row("Messages inbound", vol.total.inbound),
    row("Messages outbound", vol.total.outbound),
    row("Conversations started", support.cur.total),
    row("Active conversations by status", Object.entries(status.by).map(([k, v]) => `${k} ${v}`).join(" · ")),
    "",
    row("Day", "Inbound", "Outbound", "Conversations started", "Assigned"),
    ...w.buckets.map((b, i) =>
      row(b.key, vol.series[i].inbound, vol.series[i].outbound, support.series[i].total, support.series[i].assigned)
    ),
    "",
    row("Agent", "Department", "Assigned", "Open", "Closed", "Avg first reply (s)", "Avg reply (s)"),
    ...agents.list.map((a) => row(a.name, a.dept, a.assigned, a.open, a.closed, secs(a.first), secs(a.avg))),
  ];

  const day = w.buckets[w.buckets.length - 1]?.key ?? "export";
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="connect-dashboard-${w.days}d-${day}.csv"`,
    },
  });
}
