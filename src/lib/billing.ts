import { and, count, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel, company, conversation, member, message } from "@/db/schema";
import { addRows, monthBill, monthWindow, recentMonths, type Bill, type SpendRow } from "@/lib/whatsapp/spend";
import { templateConfig } from "@/lib/whatsapp/templates";

export type CompanyBill = {
  id: string;
  name: string;
  code: string | null;
  seats: number;
  sent: number;
  received: number;
  numbers: { phone: string; name: string; rows: SpendRow[] }[];
  rows: SpendRow[];
};

/** Meta looks back one year at most, so that is all the picker offers. */
export function pickMonth(raw: string | string[] | undefined): { month: string; months: string[] } {
  const months = recentMonths(12);
  const asked = typeof raw === "string" ? raw : "";
  return { month: months.includes(asked) ? asked : months[0], months };
}

/**
 * One month for every active company: Meta's charges on the numbers it holds and
 * what its people did in Connect. Connect's own counts still show when Meta refuses.
 */
export async function loadBilling(month: string): Promise<{ bill: Bill; companies: CompanyBill[] }> {
  const db = getDb();
  const { start, end } = monthWindow(month);
  const inMonth = and(gte(message.createdAt, new Date(start * 1000)), lt(message.createdAt, new Date(end * 1000)));
  const [companies, channels, seats, traffic] = await Promise.all([
    db.select({ id: company.id, name: company.name, code: company.code }).from(company).where(eq(company.active, true)),
    db.select({ companyId: channel.companyId, phone: channel.phone, name: channel.displayName, phoneNumberId: channel.phoneNumberId }).from(channel),
    db.select({ companyId: member.companyId, n: count() }).from(member).where(eq(member.active, true)).groupBy(member.companyId),
    db
      .select({ companyId: channel.companyId, direction: message.direction, n: count() })
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .innerJoin(channel, eq(channel.id, conversation.channelId))
      .where(inMonth)
      .groupBy(channel.companyId, message.direction),
  ]);

  // Only a channel holding a Meta number can be charged; the rest have a placeholder phone.
  const held = channels.filter((c) => c.phoneNumberId);
  const digits = (p: string) => p.replace(/\D/g, "");
  const cfg = templateConfig();
  const bill: Bill = cfg ? await monthBill(cfg, held.map((c) => c.phone), month) : { ok: false, error: "WhatsApp is not connected." };
  const rowsOf = (phone: string) => (bill.ok ? (bill.numbers.find((n) => n.phone === digits(phone))?.rows ?? []) : []);
  const moved = (companyId: string, direction: string) => traffic.find((t) => t.companyId === companyId && t.direction === direction)?.n ?? 0;

  return {
    bill,
    companies: companies.map((c) => {
      const numbers = held.filter((h) => h.companyId === c.id).map((h) => ({ phone: h.phone, name: h.name, rows: rowsOf(h.phone) }));
      return {
        ...c,
        seats: seats.find((s) => s.companyId === c.id)?.n ?? 0,
        sent: moved(c.id, "OUT"),
        received: moved(c.id, "IN"),
        numbers,
        rows: addRows(numbers.map((n) => n.rows)),
      };
    }),
  };
}
