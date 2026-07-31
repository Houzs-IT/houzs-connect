"use client";

// Tabbed Dashboard client shell.
//
// The server component (page.tsx) resolves the cheap aggregate counters and
// hands them down as `kpis`, so the tab strip and every KPI tile paint with the
// first byte. The four row-scanning cards arrive as *slots* — server-rendered
// nodes already wrapped in their own <Suspense> upstream — so they stream in
// behind matching skeletons without holding up the shell.
//
// Tabs mirror Seampify's dashboard: Overview / Support / Marketing / Live
// Reporting / Message Analytics / Calling Analytics. Real Connect figures and
// clearly-labelled demo/derived figures are marked in the UI (a "demo" /
// "derived" pill) so operators always know what is wired to live data.

import { useState } from "react";
import { BarChart } from "./charts";
import { BarRow, Card, Pill, Stat } from "./ui";
import { pctOf } from "./util";

// ─────────────────────────── Data contract ───────────────────────────

/** Everything the shell needs up-front: pure aggregate counters, a few queries. */
export interface DashboardKpis {
  contacts: number;
  conversations: number;
  openConvos: number;
  closedConvos: number;
  pendingConvos: number;
  queueConvos: number;
  automations: number;
  campaigns: number;
  campaignsCompleted: number;
  members: number;
  outbound: number;
  inbound: number;
  delivered: number;
  read: number;
  failed: number;
  optIn: number;
  templateUsage: number;
}

export interface DashboardSlots {
  /** Support → "Assigned agents" (grouped per-agent aggregate). */
  agentLoad: React.ReactNode;
  /** Marketing → "Tag reach" (contact↔tag join). */
  tagReach: React.ReactNode;
  /** Live Reporting → "Recent activity" (three merged feeds). */
  activity: React.ReactNode;
  /** Message Analytics → "Messages over time" (seven-day series). */
  messagesSeries: React.ReactNode;
}

const TABS = [
  "Overview",
  "Support",
  "Marketing",
  "Live Reporting",
  "Message Analytics",
  "Calling Analytics",
] as const;
type Tab = (typeof TABS)[number];

// ─────────────────────────── Component ───────────────────────────

export function DashboardTabs({
  kpis: k,
  spend,
  slots,
  initialTab,
}: {
  kpis: DashboardKpis;
  spend: { label: string; value: string; pct: number }[]; // demo
  slots: DashboardSlots;
  initialTab?: string;
}) {
  const start = (TABS as readonly string[]).includes(initialTab ?? "")
    ? (initialTab as Tab)
    : "Overview";
  const [tab, setTab] = useState<Tab>(start);

  function select(t: Tab) {
    setTab(t);
    // URL sync is a nicety — update in place without a server round-trip so the
    // tab is shareable/bookmarkable but switching stays instant.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", t);
      window.history.replaceState(null, "", url.toString());
    }
  }

  // Read implies delivered, so the funnel's "delivered" rung is the union.
  const funnel = {
    sent: k.outbound,
    delivered: k.delivered + k.read,
    read: k.read,
    replied: k.inbound,
  };

  return (
    <div className="p-6">
      {/* Tab strip */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              onClick={() => select(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {/* ─── Overview ─── */}
      {tab === "Overview" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Stat label="Contacts" value={k.contacts} hint="in CRM" />
            <Stat
              label="Conversations"
              value={k.conversations}
              hint={`${k.openConvos} open`}
            />
            <Stat label="Active automations" value={k.automations} hint="running" />
            <Stat label="Team members" value={k.members} hint="on org chart" />
            <Stat label="Campaigns" value={k.campaigns} hint="all time" />
            <Stat label="Est. spend (7d)" value="MYR 23.43" hint="WhatsApp · demo" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Approx. charges by category" meta={<Pill kind="demo" />}>
              <p className="mb-4 -mt-3 text-[11px] text-[var(--color-faint)]">
                Meta conversation billing · last 7 days
              </p>
              <div className="flex flex-col gap-3">
                {spend.map((s) => (
                  <BarRow key={s.label} label={s.label} value={s.value} pct={s.pct} />
                ))}
              </div>
            </Card>

            <Card title="Messages" meta={<Pill kind="real" />}>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Outbound" value={k.outbound} hint="all time" />
                <Stat label="Inbound" value={k.inbound} hint="all time" />
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Support ─── */}
      {tab === "Support" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Open" value={k.openConvos} hint="conversations" />
            <Stat label="Pending" value={k.pendingConvos} hint="awaiting reply" />
            <Stat label="Queue" value={k.queueConvos} hint="unassigned" />
            <Stat label="Closed" value={k.closedConvos} hint="resolved" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Response time" meta={<Pill kind="demo" />}>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="First response" value="2m 41s" />
                <Stat label="Avg. resolution" value="18m" />
                <Stat label="CSAT" value="94%" />
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-faint)]">
                Response-time metrics are not captured by the demo transport yet.
              </p>
            </Card>

            {slots.agentLoad}
          </div>
        </div>
      )}

      {/* ─── Marketing ─── */}
      {tab === "Marketing" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Campaigns sent" value={k.campaignsCompleted} hint="completed" />
            <Stat label="Broadcast sends" value={funnel.sent} hint="messages out" />
            <Stat label="Opted-in contacts" value={k.optIn} hint="marketing" />
            <Stat label="Replies" value={funnel.replied} hint="inbound" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Delivery funnel" meta={<Pill kind="derived" />}>
              <div className="flex flex-col gap-3">
                <BarRow label="Sent" value={String(funnel.sent)} pct={100} />
                <BarRow
                  label="Delivered"
                  value={String(funnel.delivered)}
                  pct={pctOf(funnel.delivered, funnel.sent)}
                />
                <BarRow
                  label="Read"
                  value={String(funnel.read)}
                  pct={pctOf(funnel.read, funnel.sent)}
                />
                <BarRow
                  label="Replied"
                  value={String(funnel.replied)}
                  pct={pctOf(funnel.replied, funnel.sent)}
                />
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-faint)]">
                Sent &amp; replied are live; delivered/read are derived — the demo
                transport marks every send as SENT (Meta delivery receipts arrive
                via webhooks in LIVE mode).
              </p>
            </Card>

            {slots.tagReach}
          </div>
        </div>
      )}

      {/* ─── Live Reporting ─── */}
      {tab === "Live Reporting" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Open now" value={k.openConvos} hint="conversations" />
            <Stat label="Outbound" value={k.outbound} hint="messages" />
            <Stat label="Inbound" value={k.inbound} hint="messages" />
            <Stat label="Automations live" value={k.automations} hint="enabled" />
          </div>

          <div className="mt-6">{slots.activity}</div>
        </div>
      )}

      {/* ─── Message Analytics ─── */}
      {tab === "Message Analytics" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Sent" value={k.outbound} />
            <Stat label="Delivered" value={k.delivered} />
            <Stat label="Read" value={k.read} />
            <Stat label="Failed" value={k.failed} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">{slots.messagesSeries}</div>
            <Card title="Template usage" meta={<Pill kind="real" />}>
              <Stat label="Template messages" value={k.templateUsage} hint="all time" />
              <p className="mt-3 text-[11px] text-[var(--color-faint)]">
                Broadcasts and automation sends dispatched as WhatsApp templates.
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Calling Analytics ─── */}
      {tab === "Calling Analytics" && (
        <div className="animate-rise">
          <div className="mb-4 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-2 text-[12px] text-[var(--color-muted)]">
            WhatsApp Business Calling is not wired into Connect yet — every figure on
            this tab is placeholder/demo data, shown to mirror Seampify&apos;s layout.
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Total calls" value="342" hint="demo" />
            <Stat label="Answered" value="287" hint="demo" />
            <Stat label="Avg. duration" value="3m 12s" hint="demo" />
            <Stat label="Approx. charges" value="MYR 41.80" hint="demo" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Call activity (7 days)" meta={<Pill kind="demo" />}>
                <BarChart data={CALL_ACTIVITY_DEMO} />
              </Card>
            </div>
            <Card title="Calls summary" meta={<Pill kind="demo" />}>
              <div className="flex flex-col gap-3">
                <BarRow label="Answered" value="287" pct={84} color="var(--color-success)" />
                <BarRow label="Missed" value="41" pct={12} color="var(--color-warning)" />
                <BarRow label="Rejected" value="14" pct={4} color="var(--color-danger)" />
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// Static demo dataset for the Calling Analytics chart — Connect has no call
// events, so this is illustrative only (clearly labelled in the UI).
const CALL_ACTIVITY_DEMO = [
  { label: "Mon", value: 38 },
  { label: "Tue", value: 52 },
  { label: "Wed", value: 47 },
  { label: "Thu", value: 61 },
  { label: "Fri", value: 55 },
  { label: "Sat", value: 44 },
  { label: "Sun", value: 45 },
];
