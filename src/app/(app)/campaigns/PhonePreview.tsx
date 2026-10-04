import { resolveBinding, type VarBinding } from "@/lib/automation/vars";
import type { SampleContact } from "@/app/(app)/templates/types";

/**
 * The same flattening as sampleLookup() in templates/TemplateFields (a client
 * module, so it cannot be imported into this server-safe one) — keep in step.
 */
function lookupOf(sample: SampleContact): Record<string, string> {
  const full = (sample.name ?? "").trim();
  const space = full.indexOf(" ");
  const built: Record<string, string> = {
    full_name: full,
    first_name: space === -1 ? full : full.slice(0, space),
    last_name: space === -1 ? "" : full.slice(space + 1).trim(),
    phone: sample.phone,
  };
  if (sample.email != null) built.email = sample.email;
  if (sample.source != null) built.source = sample.source;
  if (sample.sourceId != null) built.source_id = sample.sourceId;
  if (sample.sourceUrl != null) built.source_url = sample.sourceUrl;
  return { ...sample.attributes, ...built };
}

/** A template body with its {{n}} filled from one contact — what the preview shows. */
export function fillBody(body: string, bindings: VarBinding[], sample: SampleContact | null): string {
  if (!sample) return body;
  const lookup = lookupOf(sample);
  const byIndex = new Map(bindings.map((b) => [b.index, b]));
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n) => {
    const b = byIndex.get(Number(n));
    if (!b) return m;
    const v = resolveBinding(b, lookup).replace(/\s+/g, " ").trim();
    return v === "" ? "-" : v;
  });
}

/** *bold* and {{n}} the way the preview shows them. */
function rich(text: string) {
  return text.split(/(\*[^*\n]+\*|\{\{\s*\d+\s*\}\})/g).map((part, i) => {
    if (/^\{\{\s*\d+\s*\}\}$/.test(part)) {
      return (
        <span key={i} className="font-semibold text-[var(--color-accent)]">
          {part}
        </span>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(1, -1)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

/**
 * A phone showing the message in WhatsApp: the business header, the beige chat
 * wall, one bubble. Server- and client-safe (no hooks).
 */
export function PhonePreview({
  bizName,
  subtitle,
  dayLabel,
  text,
  time,
  footer,
  empty,
  className = "",
}: {
  bizName: string;
  subtitle?: string;
  dayLabel?: string;
  text: string | null;
  time?: string;
  footer?: string;
  empty: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-[30px] border-[8px] border-[#0b1020] bg-[#e9e2d6] shadow-[var(--shadow-modal)] ${className}`}
    >
      <div className="flex items-center gap-2.5 bg-[#1e6f80] px-3 py-2.5 text-white">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-hc-mark.png" alt="" className="h-[18px] w-[18px] object-contain" />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12.5px] font-semibold">{bizName}</div>
          {subtitle && <div className="truncate text-[10.5px] opacity-80">{subtitle}</div>}
        </div>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-2.5">
        {dayLabel && (
          <div className="mb-2 flex justify-center">
            <span className="rounded-[6px] bg-white/80 px-2 py-0.5 text-[10px] text-[var(--color-faint)]">
              {dayLabel}
            </span>
          </div>
        )}
        {text ? (
          <div className="rounded-[10px] rounded-tl-none bg-white px-2.5 py-2 shadow-[0_1px_1px_rgba(0,0,0,0.08)]">
            <p className="whitespace-pre-wrap break-words text-[12px] leading-[1.55] text-[var(--color-ink)]">
              {rich(text)}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--color-faint)]">
              <span className="truncate">{footer}</span>
              {time && <span className="shrink-0">{time}</span>}
            </div>
          </div>
        ) : (
          <p className="mt-8 text-center text-[12px] text-[var(--color-faint)]">{empty}</p>
        )}
      </div>
    </div>
  );
}
