import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaign } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { campaignMessages } from "@/lib/campaign-messages";

/**
 * Campaign → Download: one row per message this campaign sent, as CSV.
 * Company-scoped: the campaign must belong to the signed-in member's company.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const row = await getDb().query.campaign.findFirst({
    where: and(eq(campaign.id, id), eq(campaign.companyId, me.companyId)),
  });
  if (!row) return new Response("Not found", { status: 404 });
  const msgs = await campaignMessages(row.id, 100_000);

  const cell = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const line = (...v: unknown[]) => v.map(cell).join(",");
  const lines = [
    line("Customer", "Phone", "Status", "Replied", "Sent at (UTC)", "Message"),
    ...msgs.map((m) => line(m.contactName, m.phone, m.status, m.replied ? "yes" : "no", m.createdAt.toISOString(), m.body)),
  ];
  const safe = row.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || "campaign";
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="campaign-${safe}.csv"`,
    },
  });
}
