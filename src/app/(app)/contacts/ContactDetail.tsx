import Link from "next/link";
import { attrs, formatPhone, initials, relTime, tint, waIdentifier } from "@/lib/format";
import { fmt, type Dict } from "@/lib/i18n/dict";
import { IconClose } from "@/components/icons";
import { contactDetail } from "./queries";

const EYEBROW = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]";

/**
 * The contact panel beside the list: who they are, their orders (the ERP order
 * event's `ref_N` attributes — Connect does not call the ERP), recent
 * conversations, the first fields, remarks. "Message" opens their newest
 * conversation in Service.
 */
export async function ContactDetail({
  companyId,
  id,
  closeHref,
  s,
  statusLabel,
}: {
  companyId: string;
  id: string;
  closeHref: string;
  s: Dict["contacts"];
  statusLabel: Record<string, string>;
}) {
  const d = await contactDetail(companyId, id);
  if (!d) return null;
  const { c, convos, fields } = d;
  const a = attrs(c.attributes);
  const name = c.name ?? c.phone;
  const ident = waIdentifier(c.phone);

  // ref_1, ref_2, … with their brand / product / delivery siblings.
  const orders: { ref: string; sub: string; delivery: string | null; status: string | null }[] = [];
  for (let i = 1; i <= 9; i++) {
    const ref = a[`ref_${i}`];
    if (!ref) continue;
    orders.push({
      ref,
      sub: [a[`brand_${i}`], a[`product_${i}`]].filter(Boolean).join(" · "),
      delivery: a[`delivery_date_${i}`] ?? null,
      status: (i === 1 ? (a.tms_status ?? a.delivery_message_status_1) : a[`delivery_message_status_${i}`]) ?? null,
    });
  }
  const filled = fields.filter((f) => a[f.key]);
  const latest = convos[0];

  return (
    <aside className="scroll-thin hidden w-[340px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] lg:block">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white" style={{ background: tint(name) }}>
          {initials(name).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-[var(--color-ink)]">{name}</div>
          <div className="text-[12px] tabular-nums text-[var(--color-muted)]" title={ident.label}>
            {ident.isPhone ? formatPhone(c.phone) : ident.text}
          </div>
          <div className="text-[11.5px] text-[var(--color-faint)]">
            {fmt(s.sourceLine, { s: s.sources[c.source ?? "none"] ?? c.source ?? s.sources.none })}
          </div>
        </div>
        <Link href={closeHref} scroll={false} aria-label={s.close} className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
          <IconClose width={15} height={15} />
        </Link>
      </div>
      <div className="flex gap-2 px-4 pb-4">
        <Link
          href={latest ? `/inbox/${latest.id}` : "/inbox"}
          className="flex h-9 flex-1 items-center justify-center rounded-[8px] bg-[var(--color-accent)] text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]"
        >
          {s.message}
        </Link>
        <Link
          href={latest ? `/inbox/${latest.id}` : "/inbox"}
          className="flex h-9 flex-1 items-center justify-center rounded-[8px] border border-[var(--color-border)] text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
        >
          {s.edit}
        </Link>
      </div>

      <div className="flex flex-col gap-4 border-t border-[var(--color-border-subtle)] px-4 py-4">
        <section>
          <div className={`mb-2 ${EYEBROW}`}>{s.orders}</div>
          {orders.length === 0 ? (
            <p className="text-[12.5px] text-[var(--color-faint)]">{s.noOrders}</p>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-[var(--color-border)]">
              {orders.map((o) => (
                <div key={o.ref} className="flex items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-[13px]">
                      <span className="font-semibold text-[var(--color-brand)]">{o.ref}</span>
                      {o.sub && <span className="text-[var(--color-faint)]"> {o.sub}</span>}
                    </div>
                    {o.delivery && <div className="text-[11.5px] text-[var(--color-faint)]">{fmt(s.delivery, { d: o.delivery })}</div>}
                  </div>
                  {o.status && (
                    <span
                      className={`shrink-0 whitespace-nowrap rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                        /deliver/i.test(o.status)
                          ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                          : "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                      }`}
                    >
                      {o.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className={`mb-2 ${EYEBROW}`}>{s.recent}</div>
          {convos.length === 0 ? (
            <p className="text-[12.5px] text-[var(--color-faint)]">{s.noConvos}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {convos.map((cv) => {
                const m = cv.messages[0];
                return (
                  <li key={cv.id}>
                    <Link href={`/inbox/${cv.id}`} className="flex gap-2 rounded-[6px] py-1 hover:bg-[var(--color-surface-2)]">
                      <span
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          cv.status === "CLOSED" ? "bg-[var(--color-border-strong)]" : "bg-[var(--color-success)]"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] text-[var(--color-ink)]">{m?.body || "—"}</span>
                        <span className="block text-[11px] text-[var(--color-faint)]">
                          {[statusLabel[cv.status] ?? cv.status, cv.assignedDepartment?.name, relTime(cv.lastMessageAt)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className={EYEBROW}>{s.fields}</span>
            {latest && (
              <Link href={`/inbox/${latest.id}`} className="text-[11.5px] font-semibold text-[var(--color-accent)] hover:underline">
                {fmt(s.allFields, { n: fields.length })}
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {filled.slice(0, 6).map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="truncate text-[11px] text-[var(--color-faint)]">{f.name}</dt>
                <dd className="truncate text-[13px] font-medium text-[var(--color-ink)]">{a[f.key]}</dd>
              </div>
            ))}
          </dl>
        </section>

        {a.remarks && (
          <section>
            <div className={`mb-2 ${EYEBROW}`}>{s.remarks}</div>
            <p className="whitespace-pre-wrap rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] leading-[1.55] text-[var(--color-ink)]">
              {a.remarks}
            </p>
          </section>
        )}
      </div>
    </aside>
  );
}
