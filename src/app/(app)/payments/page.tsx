import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { payment } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { setPaymentStatus } from "@/app/actions";
import { relTime } from "@/lib/format";

const STATUS_STYLE: Record<string, string> = {
  VERIFIED: "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[var(--color-success)]",
  PENDING: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
  REJECTED: "bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]",
};

export default async function PaymentsPage() {
  const db = getDb();
  const payments = await db.query.payment.findMany({
    orderBy: desc(payment.createdAt),
    with: { contact: true },
  });

  const totalVerified = payments
    .filter((p) => p.status === "VERIFIED")
    .reduce((s, p) => s + (p.amount ?? 0), 0);
  const pending = payments.filter((p) => p.status === "PENDING").length;

  return (
    <PageChrome
      title="Payments"
      subtitle="Receipts auto-captured by OCR from customer chats"
    >
      <div className="p-6">
        <div className="mb-4 flex gap-4">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="text-[11px] text-[var(--color-muted)]">Verified total</div>
            <div className="text-[22px] font-semibold text-[var(--color-ink)]">
              MYR {totalVerified.toLocaleString()}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <div className="text-[11px] text-[var(--color-muted)]">Pending review</div>
            <div className="text-[22px] font-semibold text-[var(--color-ink)]">{pending}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Method</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-faint)]">
                    No payments captured yet. Send a receipt from a chat (demo bar) to see OCR auto-record one.
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                    {p.contact.name ?? p.contact.phone}
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--color-ink)]">
                    {p.amount != null ? `${p.currency} ${p.amount.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[var(--color-muted)]">
                    {p.referenceNo ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{p.method ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{p.orderRef ?? "—"}</td>
                  <td className="px-4 py-3 text-[var(--color-faint)]">{relTime(p.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {p.status === "PENDING" ? (
                      <div className="flex gap-1.5">
                        <form action={setPaymentStatus}>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="status" value="VERIFIED" />
                          <button className="rounded-md bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-success)]">
                            Verify
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
