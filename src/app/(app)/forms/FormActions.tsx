"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { deleteForm, duplicateForm, setFormStatus } from "./actions";

/**
 * Publish / unpublish / duplicate / delete for one form, with a confirmation in
 * front of the two that matter.
 *
 * Publishing a form is far less dangerous than publishing an automation — it
 * makes the form available to be sent, it does not send anything — so the
 * confirm says exactly that rather than borrowing the automation's warning.
 * Deleting takes the collected answers with it, which is not recoverable.
 *
 * Shared by the list row and the form's own page; `afterDelete` decides whether
 * the page it sits on still exists afterwards.
 */
export function FormActions({
  id,
  name,
  published,
  fieldCount,
  responseCount,
  afterDelete = "stay",
  size = "sm",
}: {
  id: string;
  name: string;
  published: boolean;
  fieldCount: number;
  responseCount: number;
  /** "back" navigates to /forms once the form is gone (used on its own page). */
  afterDelete?: "stay" | "back";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "publish" | "unpublish" | "delete">(
    "none"
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const pad = size === "md" ? "px-3 py-1.5 text-[12.5px]" : "px-2.5 py-1 text-[11.5px]";
  const ghost = `rounded-lg border border-[var(--color-border)] ${pad} text-[var(--color-ink)] hover:bg-[var(--color-surface-2)] disabled:opacity-60`;

  const run = (which: "publish" | "unpublish" | "delete") => {
    setError(null);
    startTransition(async () => {
      switch (which) {
        case "publish":
        case "unpublish": {
          const res = await setFormStatus(id, which === "publish");
          if (!res.ok) return setError("Could not change this form.");
          break;
        }
        case "delete": {
          const res = await deleteForm(id);
          if (!res.ok) return setError("Could not delete this form.");
          setMode("none");
          if (afterDelete === "back") {
            router.push("/forms");
            return;
          }
          break;
        }
      }
      setMode("none");
      router.refresh();
    });
  };

  const duplicate = () => {
    setError(null);
    startTransition(async () => {
      const res = await duplicateForm(id);
      if (!res.ok) return setError("Could not copy this form.");
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={duplicate} disabled={pending} className={ghost}>
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => setMode(published ? "unpublish" : "publish")}
          className={
            published
              ? ghost
              : `rounded-lg bg-[var(--color-accent)] ${pad} font-medium text-white transition-opacity hover:opacity-90`
          }
        >
          {published ? "Stop using it" : "Put it in use"}
        </button>
        <button
          type="button"
          onClick={() => setMode("delete")}
          className={`rounded-lg ${pad} font-medium text-[var(--color-faint)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]`}
        >
          Delete
        </button>
      </div>

      {error && (
        <p className="mt-1 text-[11px] text-[var(--color-danger)]">{error}</p>
      )}

      <ActionConfirm
        open={mode === "publish"}
        title={`Start using “${name}”?`}
        confirmLabel="Put it in use"
        busy={pending}
        onCancel={() => setMode("none")}
        onConfirm={() => run("publish")}
      >
        <p>
          It becomes available to send to customers — from a conversation, or from
          an automation step. Nothing is sent to anyone by publishing it.
        </p>
        <p className="mt-2">
          It asks {fieldCount} question{fieldCount === 1 ? "" : "s"}. Answers are
          filed onto the customer&apos;s contact details, where automations and
          campaigns can use them.
        </p>
        {fieldCount === 0 && (
          <p className="mt-2 text-[var(--color-danger)]">
            This form has no questions yet, so a customer would open an empty
            form.
          </p>
        )}
      </ActionConfirm>

      <ActionConfirm
        open={mode === "unpublish"}
        title={`Stop using “${name}”?`}
        confirmLabel="Stop using it"
        busy={pending}
        danger
        onCancel={() => setMode("none")}
        onConfirm={() => run("unpublish")}
      >
        <p>
          It goes back to being a draft and can no longer be sent to customers.
        </p>
        <p className="mt-2">
          Nothing is deleted — the questions and the{" "}
          {responseCount === 1 ? "1 answer" : `${responseCount} answers`} already
          collected all stay.
        </p>
      </ActionConfirm>

      <ActionConfirm
        open={mode === "delete"}
        title={`Delete “${name}”?`}
        confirmLabel="Delete it"
        busyLabel="Deleting…"
        busy={pending}
        danger
        onCancel={() => setMode("none")}
        onConfirm={() => run("delete")}
      >
        <p className="text-[var(--color-ink)]">This cannot be undone.</p>
        <p className="mt-2">
          The form, its {fieldCount} question{fieldCount === 1 ? "" : "s"} and the{" "}
          {responseCount === 1 ? "1 answer" : `${responseCount} answers`} customers
          have already sent through it are all removed.
        </p>
        {published && (
          <p className="mt-2 text-[var(--color-danger)]">
            This form is in use right now.
          </p>
        )}
        <p className="mt-2">
          If you only want to stop sending it, press Cancel and use “Stop using
          it” instead.
        </p>
      </ActionConfirm>
    </>
  );
}
