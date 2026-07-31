import Link from "next/link";
import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { automation } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { IconBolt } from "@/components/icons";

const TRIGGER_LABEL: Record<string, string> = {
  NEW_INCOMING_MESSAGE: "New incoming message",
  WEBHOOK: "Webhook received",
  ACTION_CALLBACK: "Action callback id matches",
  TAG_ADDED: "When a tag is added",
  PAYMENT_RECEIVED: "Payment received",
  DRIVER_EVENT: "Driver event",
  CONTACT_FIELD_UPDATED: "Contact field updated",
};

export default async function AutomationsPage() {
  const db = getDb();
  const automations = await db.query.automation.findMany({
    orderBy: desc(automation.updatedAt),
    with: { channel: true },
  });

  return (
    <PageChrome
      title="Automations"
      subtitle="Trigger → node-graph flows · the follow-up engine"
    >
      <div className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {automations.map((a) => {
            const graph = (a.graph as { nodes?: unknown[] } | null) ?? {};
            const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
            return (
              <Link
                key={a.id}
                href={`/automations/${a.id}`}
                className="animate-rise flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
              >
                <div className="flex items-start justify-between">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                    <IconBolt width={18} height={18} />
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                      a.enabled
                        ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                        : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
                    }`}
                  >
                    {a.enabled ? "Active" : "Draft"}
                  </span>
                </div>
                <h3 className="mt-3 text-[14px] font-semibold text-[var(--color-ink)]">
                  {a.name}
                </h3>
                <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
                  {a.channel.displayName} ·{" "}
                  {TRIGGER_LABEL[a.triggerType] ?? a.triggerType}
                </p>
                {a.description && (
                  <p className="mt-2 line-clamp-2 text-[12px] text-[var(--color-faint)]">
                    {a.description}
                  </p>
                )}
                <div className="mt-3 border-t border-[var(--color-border)] pt-2 font-mono text-[11px] text-[var(--color-faint)]">
                  {nodeCount} nodes · v{a.version}
                </div>
              </Link>
            );
          })}

          <div className="dot-grid grid min-h-[168px] place-items-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-center">
            <div className="px-6">
              <p className="text-[13px] font-medium text-[var(--color-ink)]">
                Visual flow builder
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                Drag-and-drop canvas (buttons, criteria router, delay, collect
                input, call ERP, capture receipt) — Phase 2.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageChrome>
  );
}
