import { PageSkeleton, Skel, TableSkeleton } from "@/components/skeleton";

/**
 * Contacts loading state: the filter row and the seven default columns, so the
 * table lands at its final shape. Headers are static English here (a sync
 * loading.tsx cannot read the language cookie); cells shimmer.
 */
export default function ContactsLoading() {
  return (
    <PageSkeleton section="contacts" page="allContacts">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Skel className="h-[38px] w-[380px] rounded-[8px]" />
          <Skel className="h-[34px] w-[70px] rounded-full" />
          <Skel className="h-[34px] w-[110px] rounded-full" />
          <Skel className="h-[34px] w-[90px] rounded-full" />
          <Skel className="ml-auto h-[34px] w-[96px] rounded-[8px]" />
        </div>
        <div className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
          <TableSkeleton
            headers={["", "Name", "Latest order", "Sales", "Tags", "Last message", "Updated"]}
            widths={["w-4", "w-36", "w-20", "w-16", "w-20", "w-40", "w-12"]}
            rows={10}
          />
        </div>
      </div>
    </PageSkeleton>
  );
}
