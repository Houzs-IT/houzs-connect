import { PageSkeleton, Skel } from "@/components/skeleton";

/** WhatsApp Forms loading state: the form list column beside the builder. */
export default function FormsLoading() {
  return (
    <PageSkeleton section="templates" page="forms">
      <div className="flex min-h-full">
        <div className="flex w-[300px] shrink-0 flex-col gap-2.5 border-r border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
          {[0, 1, 2, 3].map((i) => (
            <Skel key={i} className="h-[62px] w-full rounded-[12px]" />
          ))}
        </div>
        <div className="flex flex-1 flex-col">
          <div className="h-[70px] border-b border-[var(--color-border)] bg-[var(--color-surface)]" />
          <div className="flex gap-4 p-4">
            <div className="flex flex-1 flex-col gap-2.5">
              {[0, 1, 2, 3].map((i) => (
                <Skel key={i} className="h-[58px] w-full rounded-[12px]" />
              ))}
            </div>
            <Skel className="hidden h-[600px] w-[320px] rounded-[30px] xl:block" />
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
