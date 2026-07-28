import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { asGraph } from "@/lib/automation/types";
import { FlowCanvas } from "@/components/automation/FlowCanvas";
import { setAutomationEnabled } from "../actions";

const TRIGGER_LABEL: Record<string, string> = {
  NEW_INCOMING_MESSAGE: "New incoming message",
  WEBHOOK: "Webhook received (ERP)",
  TAG_ADDED: "When a tag is added",
  DRIVER_EVENT: "Driver / TMS event",
  PAYMENT_RECEIVED: "Payment received",
  CONTACT_FIELD_UPDATED: "Contact field updated",
};

export default async function AutomationDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const automation = await db.automation.findUnique({
    where: { id },
    include: { channel: true, _count: { select: { runs: true } } },
  });
  if (!automation) notFound();

  const graph = asGraph(automation.graph);
  const toggle = setAutomationEnabled.bind(null, automation.id, !automation.enabled);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
        <Link
          href="/automations"
          className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          ← Automations
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold text-[var(--color-ink)]">
            {automation.name}
          </h1>
          <p className="truncate text-[11.5px] text-[var(--color-muted)]">
            {automation.channel.displayName} ·{" "}
            {TRIGGER_LABEL[automation.triggerType] ?? automation.triggerType} · v
            {automation.version} · {automation._count.runs} runs
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <form action={toggle}>
            <button
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${
                automation.enabled
                  ? "bg-[color-mix(in_srgb,var(--color-success)_14%,transparent)] text-[var(--color-success)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
              }`}
            >
              {automation.enabled ? "● Active — click to pause" : "○ Draft — click to activate"}
            </button>
          </form>
        </div>
      </header>

      <FlowCanvas automationId={automation.id} graph={graph} />
    </>
  );
}
