"use client";

// Tabbed Dashboard client shell. The server component (page.tsx) does all the
// data fetching and hands a fully-computed, serialisable `data` object down; this
// component only owns the tab state + presentation. Tabs mirror Seampify's
// dashboard: Overview / Support / Marketing / Live Reporting / Message Analytics /
// Calling Analytics. Real Connect figures and clearly-labelled demo/derived
// figures are marked in the UI (a "demo" / "derived" pill) so operators always
// know what is wired to live data.

import { useState } from "react";
import { BarChart, LineChart } from "./charts";

// ─────────────────────────── Data contract ───────────────────────────

export interface DashboardData {
  kpis: {
    contacts: number;
    conversations: number;
    openConvos: number;
    closedConvos: number;
    pendingConvos: number;
    queueConvos: number;
    automations: number;
    campaigns: number;
    members: number;
    outbound: number;
    inbound: number;
  };
  spend: { label: string; value: string; pct: number }[]; // demo
  support: {
    agents: { name: string; open: number; total: number }[]; // real
    unassignedOpen: number; // real
  };
  marketing: {
    campaignsCompleted: number; // real
    funnel: { sent: number; delivered: number; read: number; replied: number };
    optIn: number; // real
    tags: { name: string; color: string; reach: number }[]; // real
  };
  activity: { id: string; kind: string; text: string; at: string }[]; // real
  messages: {
    labels: string[];
    sent: number[];
    read: number[];
    failed: number[];
    statusTotals: { sent: number; delivered: number; read: number; failed: number };
    templateUsage: number; // real
  };
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

// ─────────────────────────── Small UI atoms ───────────────────────────

function Pill({ kind }: { kind: "real" | "demo" | "derived" }) {
  const map = {
    real: { t: "live", c: "var(--color-success)" },
    demo: { t: "demo", c: "var(--color-warning)" },
    derived: { t: "derived", c: "var(--color-faint)" },
  } as const;
  const { t, c } = map[kind];
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}
    >
      {t}
    </span>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="animate-rise rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-[12px] font-medium text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tracking-tight text-[var(--color-ink)]">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">{hint}</div>}
    </div>
  );
}

function Card({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">{title}</h3>
        {meta}
      </div>
      {children}
    </div>
  );
}

/** Horizontal proportion bar row (spend, funnel, tags). */
function BarRow({
  label,
  value,
  pct,
  color = "var(--color-accent)",
}: {
  label: string;
  value: string;
  pct: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[12px] text-[var(--color-muted)]">
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }}
        />
      </div>
      <span className="w-24 shrink-0 text-right font-mono text-[12px] text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────── Component ───────────────────────────

export function DashboardTabs({
  data,
  initialTab,
}: {
  data: DashboardData;
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

  const k = data.kpis;

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
            <Card
              title="Approx. charges by category"
              meta={<Pill kind="demo" />}
            >
              <p className="mb-4 -mt-3 text-[11px] text-[var(--color-faint)]">
                Meta conversation billing · last 7 days
              </p>
              <div className="flex flex-col gap-3">
                {data.spend.map((s) => (
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

            <Card title="Assigned agents" meta={<Pill kind="real" />}>
              {data.support.agents.length === 0 && data.support.unassignedOpen === 0 ? (
                <p className="text-[12px] text-[var(--color-faint)]">
                  No conversations assigned yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.support.agents.map((a) => (
                    <div key={a.name} className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--color-ink)]">{a.name}</span>
                      <span className="font-mono text-[12px] text-[var(--color-muted)]">
                        {a.open} open · {a.total} total
                      </span>
                    </div>
                  ))}
                  {data.support.unassignedOpen > 0 && (
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-[var(--color-faint)]">Unassigned</span>
                      <span className="font-mono text-[12px] text-[var(--color-muted)]">
                        {data.support.unassignedOpen} open
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ─── Marketing ─── */}
      {tab === "Marketing" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Campaigns sent" value={data.marketing.campaignsCompleted} hint="completed" />
            <Stat label="Broadcast sends" value={data.marketing.funnel.sent} hint="messages out" />
            <Stat label="Opted-in contacts" value={data.marketing.optIn} hint="marketing" />
            <Stat label="Replies" value={data.marketing.funnel.replied} hint="inbound" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Delivery funnel" meta={<Pill kind="derived" />}>
              <div className="flex flex-col gap-3">
                <BarRow
                  label="Sent"
                  value={String(data.marketing.funnel.sent)}
                  pct={100}
                />
                <BarRow
                  label="Delivered"
                  value={String(data.marketing.funnel.delivered)}
                  pct={pctOf(data.marketing.funnel.delivered, data.marketing.funnel.sent)}
                />
                <BarRow
                  label="Read"
                  value={String(data.marketing.funnel.read)}
                  pct={pctOf(data.marketing.funnel.read, data.marketing.funnel.sent)}
                />
                <BarRow
                  label="Replied"
                  value={String(data.marketing.funnel.replied)}
                  pct={pctOf(data.marketing.funnel.replied, data.marketing.funnel.sent)}
                />
              </div>
              <p className="mt-3 text-[11px] text-[var(--color-faint)]">
                Sent &amp; replied are live; delivered/read are derived — the demo
                transport marks every send as SENT (Meta delivery receipts arrive
                via webhooks in LIVE mode).
              </p>
            </Card>

            <Card title="Tag reach" meta={<Pill kind="real" />}>
              {data.marketing.tags.length === 0 ? (
                <p className="text-[12px] text-[var(--color-faint)]">No tags yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.marketing.tags.map((t) => (
                    <BarRow
                      key={t.name}
                      label={t.name}
                      value={String(t.reach)}
                      pct={pctOf(t.reach, maxReach(data.marketing.tags))}
                      color={t.color}
                    />
                  ))}
                </div>
              )}
            </Card>
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

          <Card
            title="Recent activity"
            meta={<Pill kind="real" />}
          >
            {data.activity.length === 0 ? (
              <p className="text-[12px] text-[var(--color-faint)]">No recent activity.</p>
            ) : (
              <ul className="flex flex-col">
                {data.activity.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 border-b border-[var(--color-border)] py-2.5 text-[13px] last:border-0"
                  >
                    <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                      {a.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                      {a.text}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                      {a.at}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ─── Message Analytics ─── */}
      {tab === "Message Analytics" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Sent" value={data.messages.statusTotals.sent} />
            <Stat label="Delivered" value={data.messages.statusTotals.delivered} />
            <Stat label="Read" value={data.messages.statusTotals.read} />
            <Stat label="Failed" value={data.messages.statusTotals.failed} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Messages over time (7 days)" meta={<Pill kind="real" />}>
                <LineChart
                  labels={data.messages.labels}
                  series={[
                    { name: "Sent", color: "var(--color-accent)", points: data.messages.sent },
                    { name: "Read", color: "var(--color-brand)", points: data.messages.read },
                    { name: "Failed", color: "var(--color-danger)", points: data.messages.failed },
                  ]}
                />
                <Legend
                  items={[
                    { name: "Sent", color: "var(--color-accent)" },
                    { name: "Read", color: "var(--color-brand)" },
                    { name: "Failed", color: "var(--color-danger)" },
                  ]}
                />
              </Card>
            </div>
            <Card title="Template usage" meta={<Pill kind="real" />}>
              <Stat label="Template messages" value={data.messages.templateUsage} hint="all time" />
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

// ─────────────────────────── Helpers ───────────────────────────

function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return (part / whole) * 100;
}

function maxReach(tags: { reach: number }[]): number {
  return Math.max(1, ...tags.map((t) => t.reach));
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
