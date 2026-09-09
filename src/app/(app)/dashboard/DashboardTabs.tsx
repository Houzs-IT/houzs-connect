"use client";

// Tabbed Dashboard client shell.
//
// The server component (page.tsx) resolves the cheap aggregate counters and
// hands them down as `kpis`, so the tab strip and every KPI tile paint with the
// first byte. The row-scanning cards arrive as *slots* — server-rendered nodes
// already wrapped in their own <Suspense> upstream — so they stream in behind
// matching skeletons without holding up the shell.
//
// Every number rendered here comes from `kpis` or from a streamed slot, and both
// are database reads scoped to the signed-in member's company. There are no
// sample figures in this file: an earlier version carried an invented WhatsApp
// spend ("MYR 23.43", a four-row charges breakdown) and a whole Calling
// Analytics tab of made-up call volumes. Connect receives neither Meta's billing
// data nor any call events, so those figures are gone rather than approximated —
// see the note at the foot of Overview.

import { useState } from "react";
import { BarRow, Card, NoData, Pill, Stat } from "./ui";
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
  sentLast7Days: number;
}

export interface DashboardSlots {
  /** Support → measured first-reply times. */
  replySpeed: React.ReactNode;
  /** Support → who is handling the chats (grouped per-agent aggregate). */
  agentLoad: React.ReactNode;
  /** Marketing → contacts per tag (contact↔tag join). */
  tagReach: React.ReactNode;
  /** Live Reporting → latest activity (messages + automation runs). */
  activity: React.ReactNode;
  /** Message Analytics → messages sent (seven-day series). */
  messagesSeries: React.ReactNode;
}

const TABS = [
  "Overview",
  "Support",
  "Marketing",
  "Live Reporting",
  "Message Analytics",
] as const;
type Tab = (typeof TABS)[number];

// ─────────────────────────── Component ───────────────────────────

export function DashboardTabs({
  kpis: k,
  slots,
  initialTab,
}: {
  kpis: DashboardKpis;
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

  const statuses = [
    { label: "Open", value: k.openConvos },
    { label: "Waiting on a reply", value: k.pendingConvos },
    { label: "In the queue", value: k.queueConvos },
    { label: "Closed", value: k.closedConvos },
  ];

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
            <Stat label="Contacts" value={k.contacts} hint="in the address book" />
            <Stat
              label="Conversations"
              value={k.conversations}
              hint={`${k.openConvos} open`}
            />
            <Stat label="Active automations" value={k.automations} hint="switched on" />
            <Stat label="Team members" value={k.members} hint="still with us" />
            <Stat label="Campaigns" value={k.campaigns} hint="all time" />
            <Stat
              label="Messages sent"
              value={k.sentLast7Days}
              hint="last 7 days"
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Conversations by status" meta={<Pill kind="real" />}>
              {k.conversations === 0 ? (
                <p className="text-[12px] text-[var(--color-faint)]">
                  No conversations yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {statuses.map((s) => (
                    <BarRow
                      key={s.label}
                      label={s.label}
                      value={String(s.value)}
                      pct={pctOf(s.value, k.conversations)}
                    />
                  ))}
                </div>
              )}
            </Card>

            <Card title="Messages" meta={<Pill kind="real" />}>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="We sent" value={k.outbound} hint="all time" />
                <Stat label="Customers sent" value={k.inbound} hint="all time" />
              </div>
            </Card>
          </div>

          {/* What this page deliberately does NOT show. Both of these used to be
              filled with invented figures. */}
          <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
            <span className="font-medium text-[var(--color-ink)]">
              Not shown here:
            </span>{" "}
            what WhatsApp costs, and phone calls. Meta bills conversations on its
            own account and does not send us the amounts, and Connect does not
            handle calls at all — so there is nothing to count. Those figures are
            left out rather than estimated.
          </div>
        </div>
      )}

      {/* ─── Support ─── */}
      {tab === "Support" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Open" value={k.openConvos} hint="being handled" />
            <Stat label="Waiting on a reply" value={k.pendingConvos} hint="customer answered" />
            <Stat label="In the queue" value={k.queueConvos} hint="nobody assigned" />
            <Stat label="Closed" value={k.closedConvos} hint="done" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {slots.replySpeed}
            {slots.agentLoad}
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-4 py-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
            <span className="font-medium text-[var(--color-ink)]">
              Not shown here:
            </span>{" "}
            how long a chat takes to finish, and customer satisfaction scores.
            Closing a chat is not timestamped and Connect never asks customers to
            rate anything, so neither can be worked out from what we store.
          </div>
        </div>
      )}

      {/* ─── Marketing ─── */}
      {tab === "Marketing" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Campaigns sent" value={k.campaignsCompleted} hint="finished" />
            <Stat label="Contacts we may market to" value={k.optIn} hint="not opted out" />
            <Stat label="Messages we sent" value={funnel.sent} hint="all outbound" />
            <Stat label="Messages customers sent" value={funnel.replied} hint="all inbound" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="What happened to the messages we sent" meta={<Pill kind="derived" />}>
              {funnel.sent === 0 ? (
                <NoData>Nothing has been sent from this account yet.</NoData>
              ) : (
                <>
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
                      label="Customers wrote back"
                      value={String(funnel.replied)}
                      pct={pctOf(funnel.replied, funnel.sent)}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
                    Sent and written-back are counted from our own messages.
                    Delivered and read are whatever WhatsApp has told us so far —
                    they only fill in for messages sent from the live number.
                  </p>
                </>
              )}
            </Card>

            {slots.tagReach}
          </div>
        </div>
      )}

      {/* ─── Live Reporting ─── */}
      {tab === "Live Reporting" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Open right now" value={k.openConvos} hint="conversations" />
            <Stat label="We sent" value={k.outbound} hint="messages, all time" />
            <Stat label="Customers sent" value={k.inbound} hint="messages, all time" />
            <Stat label="Automations running" value={k.automations} hint="switched on" />
          </div>

          <div className="mt-6">{slots.activity}</div>
        </div>
      )}

      {/* ─── Message Analytics ─── */}
      {tab === "Message Analytics" && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Sent" value={k.outbound} hint="all time" />
            <Stat label="Delivered" value={k.delivered} hint="confirmed by WhatsApp" />
            <Stat label="Read" value={k.read} hint="confirmed by WhatsApp" />
            <Stat label="Failed" value={k.failed} hint="never arrived" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">{slots.messagesSeries}</div>
            <Card title="Ready-made templates" meta={<Pill kind="real" />}>
              <Stat label="Sent as a template" value={k.templateUsage} hint="all time" />
              <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
                Broadcasts and automations go out as WhatsApp-approved templates.
                This is how many of our messages were sent that way.
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
