import { PageSkeleton, TableSkeleton } from "@/components/skeleton";

/**
 * Contacts loading state. The real page is one card-wrapped table, so the
 * column headers render for real and only the cells shimmer — the table lands
 * at its final width and row height, so nothing jumps when rows arrive.
 * The subtitle is data-derived ("N contacts …"), so it stays a placeholder.
 */
export default function ContactsLoading() {
  return (
    <PageSkeleton title="Contacts">
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <TableSkeleton
            headers={["Name", "Phone", "Ref", "Sales Person", "Tags"]}
            widths={["w-32", "w-28", "w-16", "w-24", "w-20"]}
            rows={10}
            firstColAvatar
          />
        </div>
      </div>
    </PageSkeleton>
  );
}
