import { PageSkeleton, Skel, TableSkeleton } from "@/components/skeleton";

/**
 * Payments loading state — the two summary tiles above the receipts table.
 * The tiles keep the real `px-4 py-3` box so the table never shifts up.
 */
export default function PaymentsLoading() {
  return (
    <PageSkeleton section="payments" page="receipts">
      <div className="p-6">
        <div className="mb-4 flex gap-4">
          {["Confirmed total", "Still to check"].map((label) => (
            <div
              key={label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="text-[11px] text-[var(--color-muted)]">{label}</div>
              <Skel className="mt-1 h-[26px] w-32" />
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <TableSkeleton
            headers={[
              "Customer",
              "Amount",
              "Reference",
              "Paid by",
              "Order",
              "Received",
              "Status",
              "Action",
            ]}
            widths={[
              "w-28",
              "w-20",
              "w-24",
              "w-16",
              "w-16",
              "w-16",
              "w-16",
              "w-24",
            ]}
            rows={8}
          />
        </div>
      </div>
    </PageSkeleton>
  );
}
