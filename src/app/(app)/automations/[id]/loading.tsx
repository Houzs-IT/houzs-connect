import Link from "next/link";
import { Skel } from "@/components/skeleton";

/**
 * Automation builder loading state.
 *
 * This is the heaviest route in the app (a 184-node graph is ~300ms of server
 * time before a byte moves), so the shell it paints matters: the back link and
 * the palette's category headings are real, the canvas keeps its dot grid, and
 * the left rail keeps its 224px width — so when the real `FlowCanvas` mounts,
 * nothing reflows.
 */
export default function AutomationDetailLoading() {
  const categories = [
    { name: "Trigger", items: 2 },
    { name: "Messaging", items: 5 },
    { name: "Logic", items: 4 },
    { name: "CRM", items: 3 },
  ];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
        <Link
          href="/automations"
          className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          ← Automations
        </Link>
        <div className="min-w-0">
          <Skel className="h-[18px] w-52" />
          <Skel className="mt-1 h-[13px] w-40" />
        </div>
        <Skel className="ml-auto h-[32px] w-[86px] shrink-0 rounded-lg" />
      </header>

      <div className="relative flex h-full min-h-0 flex-1">
        {/* Node palette */}
        <div className="flex w-56 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] p-2">
            <Skel className="h-[31px] w-full rounded-lg" />
          </div>
          <div className="skeleton-stagger flex-1 overflow-hidden p-2">
            {categories.map((cat, ci) => (
              <div key={cat.name} className="mb-3">
                <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-faint)]">
                  {cat.name}
                </div>
                <div className="flex flex-col gap-0.5">
                  {Array.from({ length: cat.items }, (_, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-2 py-1.5"
                      style={{ "--i": ci * 2 + i } as React.CSSProperties}
                    >
                      <Skel className="mt-0.5 h-5 w-5 shrink-0 rounded" />
                      <Skel className="mt-1 h-[12px] w-24" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
            <Skel className="h-[27px] w-[104px] rounded-full" />
            <div className="ml-auto flex items-center gap-1.5">
              <Skel className="mr-1 h-[13px] w-24" />
              <Skel className="h-[31px] w-[68px] rounded-lg" />
              <Skel className="h-[31px] w-[112px] rounded-lg" />
              <Skel className="h-[31px] w-[96px] rounded-lg" />
            </div>
          </div>

          <div className="dot-grid relative min-h-0 flex-1 bg-[var(--color-canvas)]">
            {/* Three ghost nodes on the grid, so the canvas does not read as empty. */}
            <div className="skeleton-stagger absolute inset-0 p-10">
              <div className="flex max-w-3xl flex-col gap-8">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-[228px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
                    style={{
                      marginLeft: `${i * 64}px`,
                      "--i": i,
                    } as React.CSSProperties}
                  >
                    <Skel className="h-[30px] w-full rounded-none rounded-t-xl" />
                    <div className="p-3">
                      <Skel className="h-[13px] w-32" />
                      <Skel className="mt-1.5 h-[13px] w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
