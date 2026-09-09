"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { setAutomationEnabled } from "./actions";

/**
 * Draft → Live and back, behind a confirmation that says what will pull the
 * trigger.
 *
 * `setAutomationEnabled` has existed and been authorised for a while, but
 * nothing in the app called it — there was no publish control on the list, in
 * the builder, or anywhere else, which is why every imported flow sat in Draft.
 *
 * Publishing is not a display setting: from that moment the flow fires on live
 * customer events and sends real WhatsApp messages, with nobody approving each
 * one. So the confirmation names the trigger in a full sentence, counts the
 * steps that message a customer, counts the steps that call an outside system,
 * and warns when the flow still contains placeholder steps.
 */

export interface PublishFacts {
  id: string;
  name: string;
  enabled: boolean;
  /** "every time a customer sends a message to this WhatsApp number" */
  triggerSentence: string;
  messageSteps: number;
  apiSteps: number;
  /** total placeholder steps in the flow */
  gapCount: number;
  /** how many of those stop the flow dead (Delay) */
  stopCount: number;
}

export function PublishControl({
  facts,
  size = "sm",
}: {
  facts: PublishFacts;
  /** "sm" for the list row, "md" for the builder header. */
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"publish" | "unpublish" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const apply = (enabled: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await setAutomationEnabled(facts.id, enabled);
      if (!res.ok) {
        setError(
          enabled
            ? "Could not publish this automation."
            : "Could not switch this automation off."
        );
        return;
      }
      setOpen(null);
      router.refresh();
    });
  };

  const pad = size === "md" ? "px-3 py-1.5 text-[12.5px]" : "px-2.5 py-1 text-[11.5px]";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(facts.enabled ? "unpublish" : "publish")}
        className={
          facts.enabled
            ? `rounded-lg border border-[var(--color-border)] ${pad} text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]`
            : `rounded-lg bg-[var(--color-accent)] ${pad} font-medium text-white transition-opacity hover:opacity-90`
        }
      >
        {facts.enabled ? "Switch off" : "Publish live"}
      </button>

      <ActionConfirm
        open={open === "publish"}
        title={`Publish “${facts.name}” to real customers?`}
        confirmLabel="Yes, publish live"
        busyLabel="Publishing…"
        busy={pending}
        onCancel={() => setOpen(null)}
        onConfirm={() => apply(true)}
      >
        <p className="text-[var(--color-ink)]">
          Once it is live, this automation runs{" "}
          <strong className="font-semibold">{facts.triggerSentence}</strong>.
        </p>
        <ul className="mt-3 flex list-disc flex-col gap-1 pl-4">
          <li>
            It has <strong className="font-semibold">{facts.messageSteps}</strong>{" "}
            {facts.messageSteps === 1 ? "step that sends" : "steps that send"} a
            WhatsApp message to the customer.
          </li>
          {facts.apiSteps > 0 && (
            <li>
              It has <strong className="font-semibold">{facts.apiSteps}</strong>{" "}
              {facts.apiSteps === 1 ? "step that calls" : "steps that call"} an
              outside system (ERP / Google Script) for real.
            </li>
          )}
          <li>
            Nobody approves each message. Every customer that matches the trigger
            gets it.
          </li>
        </ul>
        {facts.gapCount > 0 && (
          <p className="mt-3 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 text-[11.5px] text-[var(--color-faint)]">
            {facts.gapCount} step{facts.gapCount === 1 ? "" : "s"} in this flow do
            not do the real thing yet
            {facts.stopCount > 0
              ? `, and ${facts.stopCount} of them stop the flow dead so nothing after them ever runs. Check those first — the automations list has a “steps need checking” button.`
              : ". The automations list has a “steps need checking” button that lists them."}
          </p>
        )}
        {error && (
          <p className="mt-3 text-[11.5px] text-[var(--color-danger)]">{error}</p>
        )}
        <p className="mt-3 text-[11.5px] text-[var(--color-faint)]">
          You can switch it back off at any time — it becomes a draft again and
          stops immediately.
        </p>
      </ActionConfirm>

      <ActionConfirm
        open={open === "unpublish"}
        title={`Switch “${facts.name}” off?`}
        confirmLabel="Switch it off"
        busyLabel="Switching off…"
        busy={pending}
        danger
        onCancel={() => setOpen(null)}
        onConfirm={() => apply(false)}
      >
        <p>
          It goes back to being a draft. It stops running {facts.triggerSentence},
          and customers stop receiving its messages.
        </p>
        <p className="mt-2">
          Nothing is deleted — the flow, its steps and its history all stay.
          Publish it again whenever you want.
        </p>
        {error && (
          <p className="mt-2 text-[11.5px] text-[var(--color-danger)]">{error}</p>
        )}
      </ActionConfirm>
    </>
  );
}
