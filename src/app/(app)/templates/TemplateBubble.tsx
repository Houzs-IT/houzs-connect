/**
 * A template drawn as the WhatsApp bubble a customer sees: bold header, body
 * with *bold* and {{n}} slots (highlighted, or filled when `fill` is given),
 * grey footer, then the quick-reply buttons under a hairline.
 */
export function TemplateBubble({
  header,
  body,
  footer,
  buttons,
  time,
  fill,
}: {
  header?: string;
  body: string;
  footer?: string;
  buttons: string[];
  time?: string;
  /** {{n}} → the value to show instead of the slot (bolded). */
  fill?: (n: number) => string | null;
}) {
  const parts = body.split(/(\*[^*\n]+\*|\{\{\s*\d+\s*\}\})/g);
  return (
    <div className="overflow-hidden rounded-[10px] bg-white shadow-[0_1px_2px_rgba(17,23,34,0.1)]">
      <div className="px-3 py-2.5">
        {header?.trim() && <p className="mb-1 text-[12.5px] font-semibold text-[var(--color-ink)]">{header.trim()}</p>}
        <p className="whitespace-pre-wrap break-words text-[12px] leading-[1.6] text-[var(--color-ink)]">
          {parts.map((p, i) => {
            const slot = /^\{\{\s*(\d+)\s*\}\}$/.exec(p);
            if (slot) {
              const v = fill?.(Number(slot[1]));
              return v ? (
                <strong key={i} className="font-semibold">
                  {v}
                </strong>
              ) : (
                <span key={i} className="font-semibold text-[var(--color-pastel-purple-ink)]">
                  {p}
                </span>
              );
            }
            if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
              return (
                <strong key={i} className="font-semibold">
                  {p.slice(1, -1)}
                </strong>
              );
            }
            return <span key={i}>{p}</span>;
          })}
        </p>
        {(footer?.trim() || time) && (
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-[var(--color-faint)]">
            <span className="truncate">{footer?.trim()}</span>
            {time && <span className="shrink-0">{time}</span>}
          </div>
        )}
      </div>
      {buttons.map((b) => (
        <div key={b} className="border-t border-[var(--color-border-subtle)] py-2 text-center text-[12.5px] font-medium text-[var(--color-accent)]">
          {b}
        </div>
      ))}
    </div>
  );
}
