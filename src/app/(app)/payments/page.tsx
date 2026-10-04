import Link from "next/link";
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact, payment } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { SecondaryMenu } from "@/components/shell/SecondaryMenu";
import { IconSearch } from "@/components/icons";
import { getCurrentMember } from "@/lib/current-member";
import { displayName, initials, tint } from "@/lib/format";
import { getDict } from "@/lib/i18n/server";
import { shortWhen } from "@/app/(app)/contacts/queries";
import { PaymentReview } from "./PaymentReview";
import { RecordPayment } from "./RecordPayment";
import { money, monthStart } from "./util";
import { mediaIdOf } from "@/lib/whatsapp/download";

/*
  Receipts customers sent in chat: a queue on the left, the selected receipt on
  the right. `payment` has no company_id — it hangs off the contact — so every
  read here is scoped through contact → company.
*/

export const dynamic = "force-dynamic";

const QUEUE_LIMIT = 300;
const STATUS: Record<string, "PENDING" | "VERIFIED" | "REJECTED"> = {
  check: "PENDING",
  confirmed: "VERIFIED",
  rejected: "REJECTED",
};
const METHOD_DOT = ["#d9822b", "#d63f86", "#2f5bd8", "#7a4fd6", "#1593c4", "#1f9d55"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const t = await getDict();
  const L = t.pay;
  const sp = await searchParams;
  // No status in the URL means the default view: what is still to check.
  const st = one(sp.status) || "check";
  const method = one(sp.method);
  const q = one(sp.q).trim().toLowerCase();
  const mine = eq(contact.companyId, me.companyId);

  const [kpi, methods, dupRefs, rows] = await Promise.all([
    db
      .select({
        month: sql<number>`coalesce(sum(${payment.amount}) filter (where ${payment.status} = 'VERIFIED' and ${payment.createdAt} >= ${monthStart().toISOString()}::timestamptz), 0)`.mapWith(Number),
        pending: sql<number>`count(*) filter (where ${payment.status} = 'PENDING')`.mapWith(Number),
        verified: sql<number>`count(*) filter (where ${payment.status} = 'VERIFIED')`.mapWith(Number),
        rejected: sql<number>`count(*) filter (where ${payment.status} = 'REJECTED')`.mapWith(Number),
        total: count(),
        withOrder: sql<number>`count(${payment.orderRef})`.mapWith(Number),
      })
      .from(payment)
      .innerJoin(contact, eq(contact.id, payment.contactId))
      .where(mine),
    db
      .select({ method: payment.method, n: count() })
      .from(payment)
      .innerJoin(contact, eq(contact.id, payment.contactId))
      .where(and(mine, isNotNull(payment.method)))
      .groupBy(payment.method)
      .orderBy(desc(count())),
    // A reference number on two receipts is either a resend or a reused slip.
    db
      .select({ ref: payment.referenceNo })
      .from(payment)
      .innerJoin(contact, eq(contact.id, payment.contactId))
      .where(and(mine, isNotNull(payment.referenceNo)))
      .groupBy(payment.referenceNo)
      .having(sql`count(*) > 1`),
    db
      .select({
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        referenceNo: payment.referenceNo,
        orderRef: payment.orderRef,
        status: payment.status,
        ocrRawText: payment.ocrRawText,
        receiptMediaUrl: payment.receiptMediaUrl,
        conversationId: payment.conversationId,
        createdAt: payment.createdAt,
        name: contact.name,
        phone: contact.phone,
      })
      .from(payment)
      .innerJoin(contact, eq(contact.id, payment.contactId))
      .where(
        and(
          mine,
          ...(STATUS[st] ? [eq(payment.status, STATUS[st])] : []),
          ...(method ? [eq(payment.method, method)] : [])
        )
      )
      .orderBy(desc(payment.createdAt))
      .limit(QUEUE_LIMIT),
  ]);

  const k = kpi[0];
  const dups = new Set(dupRefs.map((d) => d.ref));
  const shown = rows.filter(
    (r) =>
      !q ||
      (r.name ?? "").toLowerCase().includes(q) ||
      r.phone.includes(q) ||
      (r.orderRef ?? "").toLowerCase().includes(q) ||
      (r.referenceNo ?? "").toLowerCase().includes(q)
  );
  const picked = one(sp.p);
  const selected = shown.find((r) => r.id === picked) ?? shown[0] ?? null;
  // Where to go once this receipt is decided: the next one still to check.
  const nextId = selected ? (shown.find((r) => r.id !== selected.id && r.status === "PENDING")?.id ?? null) : null;
  const dupOther =
    selected?.referenceNo && dups.has(selected.referenceNo)
      ? await db
          .select({ name: contact.name, phone: contact.phone })
          .from(payment)
          .innerJoin(contact, eq(contact.id, payment.contactId))
          .where(and(mine, eq(payment.referenceNo, selected.referenceNo), sql`${payment.id} <> ${selected.id}`))
          .limit(1)
      : [];

  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string> = { status: one(sp.status), method, q };
    for (const [key, v] of Object.entries({ ...base, ...extra })) if (v) p.set(key, v);
    return `/payments${p.size ? `?${p}` : ""}`;
  };
  const pct = k.total ? Math.round((k.withOrder / k.total) * 100) : 0;

  const kpis: [string, string, string, string][] = [
    [L.confirmedMonth, money(k.month), "green", "✓"],
    [L.toCheck, String(k.pending), "orange", "◷"],
    [L.rejected, String(k.rejected), "pink", "×"],
    [L.withOrder, `${pct}%`, "blue", "⇄"],
  ];

  return (
    <>
      <SecondaryMenu
        title={t.nav.payments}
        groups={[
          {
            title: L.status,
            items: [
              { href: "/payments", label: L.toCheck, count: k.pending, dot: "var(--color-pastel-orange-ink)", exact: true },
              { href: "/payments?status=confirmed", label: L.confirmed, count: k.verified, dot: "var(--color-success)" },
              { href: "/payments?status=rejected", label: L.rejected, count: k.rejected, dot: "var(--color-danger)" },
              { href: "/payments?status=all", label: L.all, count: k.total },
            ],
          },
          {
            title: L.paidBy,
            items: methods.map((m, i) => ({
              href: `/payments?status=all&method=${encodeURIComponent(m.method ?? "")}`,
              label: m.method ?? L.unknown,
              count: m.n,
              dot: METHOD_DOT[i % METHOD_DOT.length],
            })),
          },
        ]}
      />
      <PageChrome
        section="payments"
        crumbs={[{ check: L.toCheck, confirmed: L.confirmed, rejected: L.rejected, all: L.all }[st] ?? L.toCheck]}
        actions={
          <>
          <a
            href="/payments/export"
            className="hidden h-[34px] items-center md:flex gap-1.5 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
            {L.export}
          </a>
          <RecordPayment />
          </>
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-4 p-4">
          <div className="hidden grid-cols-2 gap-3 md:grid xl:grid-cols-4">
            {kpis.map(([label, v, tone, icon]) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-[12px] border border-[var(--color-border)] px-4 py-4"
                style={{ background: `linear-gradient(135deg,#ffffff 42%, var(--color-pastel-${tone}))` }}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[16px] font-bold"
                  style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                >
                  {icon}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12px] text-[var(--color-muted)]">{label}</div>
                  <div className="text-[21px] font-medium tabular-nums text-[var(--color-ink)]">{v}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Phone: the two numbers that matter and the status pills. */}
          {!picked && (
            <div className="flex flex-col gap-3 md:hidden">
              <div className="grid grid-cols-2 gap-3">
                {[kpis[1], kpis[0]].map(([label, v, tone]) => (
                  <div
                    key={label}
                    className="rounded-[12px] border border-[var(--color-border)] px-3.5 py-3"
                    style={{ background: `linear-gradient(135deg,#ffffff 42%, var(--color-pastel-${tone}))` }}
                  >
                    <div className="truncate text-[12px] text-[var(--color-muted)]">{label}</div>
                    <div
                      className="mt-1 text-[20px] font-medium tabular-nums"
                      style={{ color: tone === "orange" ? "var(--color-pastel-orange-ink)" : "var(--color-ink)" }}
                    >
                      {v}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 overflow-x-auto">
                {(
                  [
                    ["check", "/payments", L.toCheck, k.pending],
                    ["confirmed", "/payments?status=confirmed", L.confirmed, k.verified],
                    ["rejected", "/payments?status=rejected", L.rejected, k.rejected],
                  ] as const
                ).map(([key, to, label, n]) => (
                  <Link
                    key={key}
                    href={to}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                      st === key
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                        : "border-[var(--color-border)] text-[var(--color-ink)]"
                    }`}
                  >
                    {label} <span className="text-[11.5px] text-[var(--color-faint)]">{n}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 gap-4">
            {/* Queue — on a phone it is the whole screen until a receipt is opened. */}
            <div
              className={`min-h-[480px] w-full shrink-0 flex-col overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] lg:flex lg:w-[360px] ${
                picked ? "hidden" : "flex"
              }`}
            >
              <form className="border-b border-[var(--color-border)] p-3">
                {one(sp.status) && <input type="hidden" name="status" value={one(sp.status)} />}
                {method && <input type="hidden" name="method" value={method} />}
                <div className="flex h-[36px] items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-3 focus-within:border-[var(--color-accent)]">
                  <IconSearch width={14} height={14} className="text-[var(--color-faint)]" />
                  <input name="q" defaultValue={q} placeholder={L.search} className="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--color-faint)]" />
                </div>
              </form>
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                {shown.length === 0 && (
                  <p className="px-4 py-10 text-center text-[12.5px] text-[var(--color-faint)]">
                    {q ? L.noMatch : k.total ? L.allDone : L.none}
                  </p>
                )}
                {shown.map((r) => {
                  const on = r.id === selected?.id;
                  const who = displayName(r.name, r.phone);
                  const c = tint(r.phone);
                  const badge =
                    r.status === "PENDING"
                      ? ["bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]", L.toCheck]
                      : r.status === "VERIFIED"
                        ? ["bg-[var(--color-success-soft)] text-[var(--color-success)]", L.confirmed]
                        : ["bg-[var(--color-danger-soft)] text-[var(--color-danger)]", L.rejected];
                  const warn =
                    r.amount == null
                      ? L.amountUnclear
                      : r.referenceNo && dups.has(r.referenceNo)
                        ? L.duplicate
                        : !r.orderRef
                          ? L.noOrder
                          : null;
                  return (
                    <Link
                      key={r.id}
                      href={href({ p: r.id })}
                      scroll={false}
                      className={`flex gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 ${
                        on ? "bg-[var(--color-accent-soft)]/50 lg:shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                        style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
                      >
                        {initials(who)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{who}</span>
                          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">
                            {r.amount != null ? money(r.amount, r.currency) : "—"}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-baseline justify-between gap-2 text-[11.5px]">
                          <span className="truncate text-[var(--color-faint)]">
                            <b className="font-semibold text-[var(--color-brand)]">{r.orderRef ?? "—"}</b> · {r.method ?? L.unknown}
                          </span>
                          <span className="shrink-0 text-[var(--color-faint)]">{shortWhen(r.createdAt, L.yesterday)}</span>
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className={`rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${badge[0]}`}>{badge[1]}</span>
                          {warn && r.status !== "VERIFIED" && (
                            <span
                              className={`text-[11.5px] font-medium ${
                                warn === L.noOrder ? "text-[var(--color-danger)]" : "text-[var(--color-pastel-orange-ink)]"
                              }`}
                            >
                              {warn}
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Review */}
            <div className={`min-w-0 flex-1 lg:block ${picked ? "block" : "hidden"}`}>
              {selected ? (
                <PaymentReview
                  key={selected.id}
                  p={{
                    id: selected.id,
                    name: selected.name,
                    phone: selected.phone,
                    amount: selected.amount,
                    currency: selected.currency,
                    method: selected.method,
                    referenceNo: selected.referenceNo,
                    orderRef: selected.orderRef,
                    status: selected.status,
                    ocrRawText: selected.ocrRawText,
                    hasImage: !!mediaIdOf(selected.receiptMediaUrl),
                    conversationId: selected.conversationId,
                    when: shortWhen(selected.createdAt, L.yesterday),
                    date: selected.createdAt.toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Kuala_Lumpur",
                    }),
                  }}
                  dupWith={dupOther[0] ? dupOther[0].name || dupOther[0].phone : null}
                  nextHref={nextId ? href({ p: nextId }) : href({})}
                  backHref={href({})}
                />
              ) : (
                <p className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[13px] text-[var(--color-faint)]">
                  {L.selectHint}
                </p>
              )}
            </div>
          </div>
        </div>
      </PageChrome>
    </>
  );
}
