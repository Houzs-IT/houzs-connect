import { PageChrome } from "./PageChrome";

export function Placeholder({
  title,
  subtitle,
  phase,
  points,
}: {
  title: string;
  subtitle: string;
  phase: string;
  points: string[];
}) {
  return (
    <PageChrome title={title} subtitle={subtitle}>
      <div className="grid min-h-full place-items-center p-6">
        <div className="dot-grid w-full max-w-lg rounded-2xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-8 text-center">
          <span className="inline-block rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent-ink)]">
            {phase}
          </span>
          <h2 className="mt-4 text-[18px] font-semibold text-[var(--color-ink)]">
            {title}
          </h2>
          <ul className="mx-auto mt-4 flex max-w-sm flex-col gap-2 text-left">
            {points.map((p) => (
              <li
                key={p}
                className="flex items-start gap-2 text-[13px] text-[var(--color-muted)]"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PageChrome>
  );
}
