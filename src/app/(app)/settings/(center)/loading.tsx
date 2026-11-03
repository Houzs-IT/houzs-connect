import { PageSkeleton, Skel } from "@/components/skeleton";

/** Settings loading state: a panel title over two cards. */
export default function SettingsLoading() {
  return (
    <PageSkeleton section="settings">
      <div className="max-w-[1000px] p-4 md:p-6">
        <Skel className="h-[20px] w-48" />
        <Skel className="mt-2 h-[13px] w-72" />
        <div className="mt-5 flex flex-col gap-4">
          <Skel className="h-[150px] w-full rounded-[12px]" />
          <Skel className="h-[220px] w-full rounded-[12px]" />
        </div>
      </div>
    </PageSkeleton>
  );
}
