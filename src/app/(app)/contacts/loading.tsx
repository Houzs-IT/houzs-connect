import { PageSkeleton, Skel, TableSkeleton } from "@/components/skeleton";

/**
 * Contacts loading state. The real page is a toolbar over one card-wrapped
 * table, so the column headers render for real and only the cells shimmer — the
 * table lands at its final width and row height, so nothing jumps when rows
 * arrive. The toolbar is a placeholder rather than the real control: it is a
 * client island whose search box would render empty here (loading.tsx cannot
 * read searchParams) and then repaint with the query.
 * The subtitle is data-derived ("N contacts …"), so it stays a placeholder.
 */
export default function ContactsLoading() {
  return (
    <PageSkeleton section="contacts" page="allContacts">
      <div className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <Skel className="h-[34px] w-[248px] rounded-lg" />
          <Skel className="h-[34px] w-[68px] rounded-lg" />
          <Skel className="ml-auto h-[34px] w-[110px] rounded-lg" />
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <TableSkeleton
            headers={[
              "Name",
              "Phone",
              "Email",
              "Source",
              "Source Id",
              "Source Url",
              "Ref",
              "Sales Person",
              "Tags",
              "Created Date",
              "Updated At",
              "Blocked",
              "Action",
            ]}
            widths={[
              "w-32",
              "w-28",
              "w-36",
              "w-16",
              "w-20",
              "w-28",
              "w-16",
              "w-24",
              "w-20",
              "w-24",
              "w-24",
              "w-10",
              "w-14",
            ]}
            rows={10}
            firstColAvatar
            minWidth="min-w-[1400px]"
          />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <Skel className="h-[14px] w-36" />
          <Skel className="h-[14px] w-40" />
        </div>
      </div>
    </PageSkeleton>
  );
}
