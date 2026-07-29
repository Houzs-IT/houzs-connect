import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation,
  campaign,
  contact,
  conversation,
  member,
} from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";

export default async function DashboardPage() {
  const db = getDb();
  const [contacts, convos, openConvos, automations, campaigns, members] =
    await Promise.all([
      db.$count(contact),
      db.$count(conversation),
      db.$count(conversation, eq(conversation.status, "OPEN")),
      db.$count(automation, eq(automation.enabled, true)),
      db.$count(campaign),
      db.$count(member),
    ]);

  // Demo spend figures mirror Seampify's conversation-billing dashboard.
  const spend = [
    { label: "Marketing", value: "MYR 0.00" },
    { label: "Utility", value: "MYR 19.97" },
    { label: "Service", value: "MYR 0.00" },
    { label: "Marketing-Lite", value: "MYR 3.47" },
  ];

  const stats = [
    { label: "Contacts", value: contacts, hint: "in CRM" },
    { label: "Conversations", value: convos, hint: `${openConvos} open` },
    { label: "Active automations", value: automations, hint: "running" },
    { label: "Team members", value: members, hint: "on org chart" },
    { label: "Campaigns", value: campaigns, hint: "all time" },
    { label: "Est. spend (7d)", value: "MYR 23.43", hint: "WhatsApp" },
  ];

  return (
    <PageChrome
      title="Dashboard"
      subtitle="Spend, delivery categories & team performance"
    >
      <div className="p-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="animate-rise rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="text-[12px] font-medium text-[var(--color-muted)]">
                {s.label}
              </div>
              <div className="mt-1 text-[26px] font-semibold tracking-tight text-[var(--color-ink)]">
                {s.value}
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--color-faint)]">
                {s.hint}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
              Approx. charges by category
            </h3>
            <p className="mb-4 text-[11px] text-[var(--color-faint)]">
              Meta conversation billing · last 7 days (demo)
            </p>
            <div className="flex flex-col gap-3">
              {spend.map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="w-28 text-[12px] text-[var(--color-muted)]">
                    {s.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)]"
                      style={{
                        width:
                          s.label === "Utility"
                            ? "82%"
                            : s.label === "Marketing-Lite"
                              ? "18%"
                              : "3%",
                      }}
                    />
                  </div>
                  <span className="w-24 text-right font-mono text-[12px] text-[var(--color-ink)]">
                    {s.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="dot-grid grid place-items-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 text-center">
            <div>
              <p className="text-[13px] font-medium text-[var(--color-ink)]">
                Live agent status & CSAT
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                Support KPIs, agent timesheet & queue — Phase 3.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageChrome>
  );
}
