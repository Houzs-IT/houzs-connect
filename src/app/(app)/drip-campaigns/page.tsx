import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { channel as channelTable, dripCampaign, dripEnrollment, dripStep } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/dict";
import { ensureDripTables } from "@/db/ensure-drip";
import { listSendableTemplates } from "@/app/actions";
import { createDrip } from "./actions";
import { DripBuilder } from "./DripBuilder";
import type { DripUnit } from "./spec";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TONES = ["green", "orange", "purple", "pink", "blue", "cyan"];

export default async function DripPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();
  await ensureDripTables(db).catch(() => {});
  const t = await getDict();
  const L = t.drip;
  const sp = await searchParams;

  const [drips, stepCounts, enrollCounts, templates, channel] = await Promise.all([
    db.query.dripCampaign.findMany({
      where: eq(dripCampaign.companyId, me.companyId),
      orderBy: asc(dripCampaign.createdAt),
    }),
    db
      .select({ dripId: dripStep.dripId, n: count() })
      .from(dripStep)
      .innerJoin(dripCampaign, eq(dripCampaign.id, dripStep.dripId))
      .where(eq(dripCampaign.companyId, me.companyId))
      .groupBy(dripStep.dripId),
    db
      .select({ dripId: dripEnrollment.dripId, n: count() })
      .from(dripEnrollment)
      .innerJoin(dripCampaign, eq(dripCampaign.id, dripEnrollment.dripId))
      .where(and(eq(dripCampaign.companyId, me.companyId), eq(dripEnrollment.status, "active")))
      .groupBy(dripEnrollment.dripId),
    listSendableTemplates(),
    db.query.channel.findFirst({ where: eq(channelTable.companyId, me.companyId) }),
  ]);

  const stepN = new Map(stepCounts.map((r) => [r.dripId, r.n]));
  const enrollN = new Map(enrollCounts.map((r) => [r.dripId, r.n]));
  const selected = drips.find((d) => d.id === one(sp.d)) ?? drips[0] ?? null;
  const steps = selected
    ? await db.query.dripStep.findMany({
        where: eq(dripStep.dripId, selected.id),
        orderBy: asc(dripStep.position),
      })
    : [];

  const initialSteps = steps.map((s) => ({
    afterUnit: (s.afterUnit as DripUnit) ?? "days",
    afterAmount: s.afterAmount,
    templateName: s.templateName ?? "",
    templateLang: s.templateLang ?? "",
    templateBody: s.templateBody ?? "",
    removeAfterReplied: s.removeAfterReplied,
  }));

  return (
    <PageChrome
      section="drip"
      actions={
        channel ? (
          <form action={createDrip}>
            <input type="hidden" name="name" value={L.newName} />
            <button className="flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]">
              <span className="text-[16px] leading-none">+</span>
              {L.new}
            </button>
          </form>
        ) : null
      }
    >
      <div className="flex min-h-full">
        <div className="w-[300px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
          {drips.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-[var(--color-faint)]">{L.none}</p>
          )}
          <div className="flex flex-col gap-2.5">
            {drips.map((d, i) => {
              const on = d.id === selected?.id;
              const tone = TONES[i % TONES.length];
              const live = d.status === "live";
              return (
                <Link
                  key={d.id}
                  href={`/drip-campaigns?d=${d.id}`}
                  className={`flex items-center gap-3 rounded-[12px] border bg-[var(--color-surface)] px-3 py-3 ${
                    on
                      ? "border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-ring)]"
                      : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                  }`}
                >
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                    style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{d.name}</span>
                    <span className="block truncate text-[11.5px] text-[var(--color-faint)]">
                      {fmt(L.stepsN, { n: stepN.get(d.id) ?? 0 })} · {fmt(L.enrolledN, { n: enrollN.get(d.id) ?? 0 })}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                      live
                        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                    }`}
                  >
                    {live ? L.live : L.draft}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {!channel ? (
          <p className="p-6 text-[13px] text-[var(--color-faint)]">{L.needChannel}</p>
        ) : !selected ? (
          <p className="p-6 text-[13px] text-[var(--color-faint)]">{L.select}</p>
        ) : (
          <DripBuilder
            key={selected.id}
            id={selected.id}
            initialName={selected.name}
            initialSteps={initialSteps}
            live={selected.status === "live"}
            enrolled={enrollN.get(selected.id) ?? 0}
            templates={templates}
          />
        )}
      </div>
    </PageChrome>
  );
}
