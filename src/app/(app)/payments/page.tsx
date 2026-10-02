import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, payment } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { setPaymentStatus } from "@/app/actions";
import { relTime } from "@/lib/format";

/**
 * Receipts customers sent in chat, read by OCR.
 *
 * `payment` carries no company_id — it hangs off the contact — so both the
 * figures and the table are scoped through contact → company. Without that join
 * this page listed (and totalled) every company's receipts on the deployment.
 */

/** PaymentStatus in words. Nobody outside the database calls it "VERIFIED". */
const STATUS_LABEL: Record<string, string> = {
  PENDING: "To check",
  VERIFIED: "Confirmed",
  REJECTED: "Rejected",
};

const STATUS_STYLE: Record<string, string> = {
  VERIFIED: "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[var(--color-success)]",
  PENDING: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
  REJECTED: "bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]",
};

/** Receipts shown in the review table — newest first. */
const PAGE_SIZE = 200;

/** Money reads as money: two decimals and thousands separators. */
function money(amount: number, currency = "MYR"): string {
  return `${currency} ${amount.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function PaymentsPage() {
  const db = getDb();
  const me = await getCurrentMember();
  if (!me) return null;

  const mine = eq(contact.companyId, me.companyId);

  // The two headline figures are aggregates, so Postgres computes them. Summing
  // them in JS meant loading every payment (and its contact) just to add up a
  // column, which also capped the table at "however many rows we can afford".
  const [totals, payments] = await Promise.all([
    db
      .select({
        verifiedAmount:
          sql<number>`coalesce(sum(${payment.amount}) filter (where ${payment.status} = 'VERIFIED'), 0)`.mapWith(
            Number
          ),
        pending:
          sql<number>`count(*) filter (where ${payment.status} = 'PENDING')`.mapWith(
            Number
          ),
      })
      .from(payment)
      .innerJoin(contact, eq(contact.id, payment.contactId))
      .where(mine),
    db
      .select({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        referenceNo: payment.referenceNo,
        orderRef: payment.orderRef,
        status: payment.status,
        createdAt: payment.createdAt,
        contactName: contact.name,
        contactPhone: contact.phone,
      })
      .from(payment)
      .innerJoin(contact, eq(contact.id, payment.contactId))
      .where(mine)
      .orderBy(desc(payment.createdAt))
      .limit(PAGE_SIZE),
  ]);

  const totalConfirmed = totals[0].verifiedAmount;
  const toCheck = totals[0].pending;

  return (
    <PageChrome section="payments" page="receipts">
      <div className="p-6">
        <div className="mb-4 flex gap-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="text-[11px] text-[var(--color-muted)]">Confirmed total</div>
            <div className="text-[22px] font-semibold text-[var(--color-ink)]">
              {money(totalConfirmed)}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="text-[11px] text-[var(--color-muted)]">Still to check</div>
            <div className="text-[22px] font-semibold text-[var(--color-ink)]">{toCheck}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Paid by</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-faint)]">
                    No receipts yet. When a customer sends one in a chat, it is read
                    automatically and lands here for checking.
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                    {p.contactName ?? p.contactPhone}
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--color-ink)]">
                    {p.amount != null ? money(p.amount, p.currency) : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted)]">
                    {p.referenceNo ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{p.method ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{p.orderRef ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-faint)]">{relTime(p.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status]}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.status === "PENDING" ? (
                      <div className="flex gap-1.5">
                        <form action={setPaymentStatus}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="status" value="VERIFIED" />
                          <button className="rounded-md bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-success)]">
                            Confirm
                          </button>
                        </form>
                        <form action={setPaymentStatus}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="status" value="REJECTED" />
                          <button className="rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-[11px] font-medium text-[var(--color-muted)]">
                            Reject
                          </button>
                        </form>
                      </div>
                    ) : (
                      <span className="text-[11px] text-[var(--color-faint)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageChrome>
  );
}
