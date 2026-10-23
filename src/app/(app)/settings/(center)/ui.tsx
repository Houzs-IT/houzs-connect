import type { Dict } from "@/lib/i18n/dict";

/** The title block at the top of every Settings panel. */
export function SettingsHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[18px] font-semibold text-[var(--color-ink)]">{title}</h2>
      {sub && <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{sub}</p>}
    </div>
  );
}

/** A white card with an icon, title and subtitle header. */
export function SetCard({
  icon,
  tone = "blue",
  title,
  sub,
  right,
  children,
  className = "",
}: {
  icon?: string;
  tone?: string;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {icon && (
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold"
            style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</h3>
          {sub && <p className="text-[12px] text-[var(--color-faint)]">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** What a not-yet-approved panel will do, said plainly instead of faked. */
export function ProposalNote({ L, body }: { L: Dict["set"]; body: string }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5">
      <span className="rounded-full bg-[var(--color-brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-brand-ink)]">
        {L.proposal}
      </span>
      <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink)]">{body}</p>
      <p className="mt-2 text-[12px] text-[var(--color-faint)]">{L.proposalBody}</p>
    </div>
  );
}
