import { Skel } from "@/components/skeleton";

/** Composer loading state: header with the step strip, a card, the phone. */
export default function NewCampaignLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
        <Skel className="h-8 w-8 rounded-[8px]" />
        <Skel className="h-[14px] w-40" />
        <Skel className="mx-auto h-[24px] w-[360px] rounded-full" />
        <Skel className="h-[34px] w-[150px] rounded-[8px]" />
      </div>
      <div className="flex flex-1 gap-5 p-6">
        <div className="flex flex-1 flex-col gap-4">
          <Skel className="h-[22px] w-48" />
          <Skel className="h-[90px] w-full rounded-[12px]" />
          <Skel className="h-[120px] w-full rounded-[12px]" />
          <Skel className="h-[200px] w-full rounded-[12px]" />
        </div>
        <Skel className="hidden h-[600px] w-[352px] rounded-[30px] xl:block" />
      </div>
    </div>
  );
}
