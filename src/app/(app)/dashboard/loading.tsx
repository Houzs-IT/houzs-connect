import { PageSkeleton, Skel } from "@/components/skeleton";

/**
 * Dashboard loading state — the Overview shape: greeting, tab strip, two
 * headline cards and the right-hand column, so nothing jumps when the real
 * cards stream in.
 */
export default function DashboardLoading() {
  const card = (h: number, key: string | number) => (
    <div key={key} className="rounded-[16px] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-[22px] py-5">
      <Skel className="h-[12px] w-28" />
      <div className="skeleton mt-4 rounded-[10px]" style={{ height: h }} />
    </div>
  );
  return (
    <PageSkeleton section="dashboard" page="overview">
      <div className="flex flex-col gap-5 px-4 py-6 md:px-10 md:py-9">
        <div>
          <Skel className="h-[30px] w-72" />
          <Skel className="mt-2 h-[13px] w-56" />
        </div>
        <Skel className="h-[38px] w-[360px] rounded-[10px]" />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]">
          <div className="grid gap-4 md:grid-cols-2 xl:col-span-2">
            {card(110, "a")}
            {card(110, "b")}
            {card(380, "c")}
            {card(380, "d")}
          </div>
          <div className="flex flex-col gap-4">
            {card(200, "e")}
            {card(120, "f")}
          </div>
        </div>
      </div>
    </PageSkeleton>
  );
}
