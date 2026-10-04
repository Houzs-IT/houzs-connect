import { Suspense } from "react";
import Link from "next/link";
import { CompanySwitcher, LangToggle } from "@/components/shell/TopbarControls";
import { getDb } from "@/db/client";
import { companyChoices } from "@/lib/companies";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict, getLang } from "@/lib/i18n/server";
import {
  AccountsCard,
  AiCard,
  CardSkeleton,
  ConversationsCard,
  FollowUpCard,
  ReplyRateCards,
  ReplyRateSkeleton,
  ReportCard,
  TeamCard,
  VolumeSection,
} from "./overview";
import { SupportSkeleton, SupportTab } from "./support";
import { LiveSkeleton, LiveTab } from "./live";
import { PeriodPicker } from "./PeriodPicker";
import { parsePeriod, periodWindow } from "./util";
import { Presence } from "./Presence";

const TZ = "Asia/Kuala_Lumpur";
type Tab = "overview" | "support" | "live";

/**
 * Dashboard — Overview / Support / Live reporting. Every figure is read from
 * the `connect` schema for the signed-in member's company (queries.ts); where
 * Connect has no source for something (presence, the AI questions, the staff
 * report) the card says so instead of showing a number.
 *
 * Only the active tab renders, and each of its cards streams behind its own
 * <Suspense>, so the header and tab strip paint immediately.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; period?: string; dept?: string }>;
}) {
  const [{ tab: rawTab, period, dept }, me, t, lang] = await Promise.all([
    searchParams,
    getCurrentMember(),
    getDict(),
    getLang(),
  ]);
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login
  const s = t.dash;
  const tab: Tab = rawTab === "support" || rawTab === "live" ? rawTab : "overview";
  const locale = lang === "zh" ? "zh-CN" : "en-GB";
  const w = periodWindow(parsePeriod(period), locale);
  const now = new Date();
  const companyId = me.companyId;
  const props = { companyId, w, s };

  // "Friday, 2 October" (en-GB leaves the comma out).
  const dateLine = now
    .toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: TZ })
    .replace(/^([A-Za-z]+) /, "$1, ");
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const firstName = me.name.split(/[\s_]+/)[0] || me.name;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: "overview",
      label: s.tOverview,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      ),
    },
    {
      key: "support",
      label: s.tSupport,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      ),
    },
    {
      key: "live",
      label: s.tLive,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="m8 3 4 4 4-4" />
        </svg>
      ),
    },
  ];
  const tabHref = (k: Tab) => {
    const q = new URLSearchParams();
    if (k !== "overview") q.set("tab", k);
    if (period) q.set("period", period);
    const qs = q.toString();
    return qs ? `?${qs}` : "/dashboard";
  };

  return (
    // No page Topbar here: the design gives the Dashboard its own header with
    // presence, language and Export on the right.
    <div className="flex min-w-0 flex-1 flex-col">
    <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-5 px-4 py-6 md:px-10 md:py-9">
        {/* Greeting · presence · language · export */}
        <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-medium tracking-[-0.02em] text-[var(--color-ink)] md:text-[28px]">
            {fmt(s.welcome, { name: firstName })}
          </h1>
          <div className="mt-1 hidden text-[12.5px] text-[var(--color-faint)] md:block">
            {dateLine} · {s.signedInAs} <b className="font-semibold text-[var(--color-muted)]">{me.name}</b>
          </div>
          <div className="mt-1 text-[12.5px] text-[var(--color-faint)] md:hidden">{fmt(s.updated, { time })}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">
            {tab !== "live" && <PeriodPicker value={w.days} range={w.rangeLabel} />}
            <Suspense fallback={null}>
              <Presence companyId={companyId} s={s} />
            </Suspense>
          </div>
        </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:contents">
              <Suspense fallback={null}>
                <Presence companyId={companyId} s={s} />
              </Suspense>
            </span>
            <CompanySwitcher companies={await companyChoices(getDb(), me)} className="hidden md:block" />
            <LangToggle pill />
            <a
              href={`/dashboard/export?period=${w.days}`}
              className="hidden h-[38px] md:flex items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
              </svg>
              {s.export}
            </a>
          </div>
        </div>

        {/* Tabs · period · updated */}
        <div className="flex flex-wrap items-center gap-2.5">
          <nav className="flex w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-[3px] md:mr-2 md:w-auto">
            {tabs.map((tb) => {
              const on = tb.key === tab;
              return (
                <Link
                  key={tb.key}
                  href={tabHref(tb.key)}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3.5 py-1.5 md:flex-none text-[12.5px] font-semibold transition-colors ${
                    on
                      ? "bg-[var(--color-accent)] text-white shadow-[var(--shadow-primary)]"
                      : "text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                  }`}
                >
                  {tb.icon}
                  <span className={tb.key === "live" ? "hidden sm:inline" : undefined}>{tb.label}</span>
                  {tb.key === "live" && <span className="sm:hidden">{s.tLiveShort}</span>}
                  {tb.key === "live" && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] shadow-[0_0_0_3px_rgba(47,138,91,0.18)]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <span className="hidden md:contents">
            {tab !== "live" && <PeriodPicker value={w.days} range={w.rangeLabel} />}
          </span>
          <span className="ml-auto hidden text-[12px] text-[var(--color-faint)] md:inline">{fmt(s.updated, { time })}</span>
        </div>

        {tab === "overview" && (
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:col-span-2">
              {/* Two small tiles side by side on a phone. */}
              <div className="grid grid-cols-2 gap-3 md:contents">
                <Suspense fallback={<ReplyRateSkeleton />}>
                  <ReplyRateCards {...props} />
                </Suspense>
              </div>
              <div className="md:row-span-2">
                <Suspense fallback={<CardSkeleton h={470} />}>
                  <FollowUpCard {...props} />
                </Suspense>
              </div>
              <AiCard s={s} />
              <Suspense fallback={<CardSkeleton h={220} />}>
                <ConversationsCard {...props} />
              </Suspense>
              <div className="md:col-span-2">
                <Suspense fallback={<CardSkeleton h={360} />}>
                  <VolumeSection companyId={companyId} w={w} />
                </Suspense>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <Suspense fallback={<CardSkeleton h={260} />}>
                <TeamCard {...props} />
              </Suspense>
              <ReportCard s={s} />
              <Suspense fallback={<CardSkeleton h={380} />}>
                <AccountsCard companyId={companyId} s={s} />
              </Suspense>
            </div>
          </div>
        )}

        {tab === "support" && (
          <Suspense fallback={<SupportSkeleton />}>
            <SupportTab {...props} dept={dept} />
          </Suspense>
        )}

        {tab === "live" && (
          <Suspense fallback={<LiveSkeleton />}>
            <LiveTab companyId={companyId} s={s} />
          </Suspense>
        )}
      </div>
    </main>
    </div>
  );
}
