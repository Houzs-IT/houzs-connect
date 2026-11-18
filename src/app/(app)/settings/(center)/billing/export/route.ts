import { getCurrentMember } from "@/lib/current-member";
import { isAdminRole } from "@/lib/permissions";
import { loadBilling, pickMonth } from "@/lib/billing";

/** Billing → Export: the month's Meta charges per company, number and category. Admins only: it shows every company. */
export async function GET(req: Request) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  if (!isAdminRole(me.role)) return new Response("Forbidden", { status: 403 });
  const { month } = pickMonth(new URL(req.url).searchParams.get("month") ?? undefined);
  const { bill, companies } = await loadBilling(month);
  // A refusal must not download as an empty bill that looks like nothing was charged.
  if (!bill.ok) return new Response(`Meta did not give this month's spend: ${bill.error}`, { status: 502 });

  const cell = (v: unknown) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const line = (...v: unknown[]) => v.map(cell).join(",");
  const lines = [
    line("Month", "Company", "Code", "WhatsApp number", "Number name", "Category", "Messages", "Cost", "Currency"),
    ...companies.flatMap((c) =>
      c.numbers.flatMap((n) =>
        n.rows.map((r) => line(month, c.name, c.code, n.phone, n.name, r.category, r.volume, r.cost.toFixed(2), bill.currency))
      )
    ),
    ...bill.unassigned.map((r) => line(month, "Not assigned to a company", "", "", "", r.category, r.volume, r.cost.toFixed(2), bill.currency)),
  ];
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="connect-whatsapp-billing-${month}.csv"`,
    },
  });
}
