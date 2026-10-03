import { Skel } from "@/components/skeleton";

/** Campaign detail loading state: header with tabs, KPI row, cards. */
export default function CampaignDetailLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Skel className="h-[14px] w-56" />
        <Skel className="mx-auto h-[38px] w-[200px] rounded-[10px]" />
        <Skel className="h-[34px] w-[190px] rounded-[8px]" />
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skel key={i} className="h-[76px] rounded-[12px]" />
          ))}
        </div>
        <Skel className="h-[140px] rounded-[12px]" />
        <div className="grid gap-4 xl:grid-cols-[330px_300px_1fr]">
          <Skel className="h-[568px] rounded-[12px]" />
          <Skel className="h-[568px] rounded-[30px]" />
          <Skel className="h-[568px] rounded-[12px]" />
        </div>
      </div>
    </div>
  );
}
