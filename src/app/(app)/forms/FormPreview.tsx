import { fieldTypeLabel, type FormField } from "./fields";

/**
 * What the customer sees when this form opens inside WhatsApp.
 *
 * No hooks and no "use client", so the same component renders in the server
 * page and inside the client editor as the owner types — he should not have to
 * publish a form to find out what he built.
 *
 * The controls are inert on purpose: this is a picture of the customer's
 * screen, not a form anyone here fills in. Real answers arrive from Meta's
 * WhatsApp Flow webhook.
 */
export function FormPreview({
  name,
  fields,
}: {
  name: string;
  fields: FormField[];
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="mb-2 text-[11px] text-[var(--color-faint)]">
        What the customer sees in WhatsApp
      </p>

      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2.5">
          <p className="text-[12.5px] font-semibold text-[var(--color-accent-ink)]">
            {name.trim() || "Untitled form"}
          </p>
        </div>

        <div className="flex flex-col gap-3 p-3">
          {fields.length === 0 ? (
            <p className="py-6 text-center text-[11.5px] text-[var(--color-faint)]">
              No questions yet, so the customer would open an empty form.
            </p>
          ) : (
            fields.map((f) => (
              <div key={f.key}>
                <p className="mb-1 text-[11.5px] font-medium text-[var(--color-ink)]">
                  {f.label}
                </p>
                <PreviewControl type={f.type} />
              </div>
            ))
          )}

          <button
            type="button"
            disabled
            aria-hidden
            tabIndex={-1}
            className="mt-1 w-full cursor-default rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[12.5px] font-medium text-white opacity-90"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

/** The inert stand-in for one answer control. */
function PreviewControl({ type }: { type: FormField["type"] }) {
  const box =
    "flex h-[30px] items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-[11.5px] text-[var(--color-faint)]";

  if (type === "select") {
    return (
      <div className={`${box} justify-between`}>
        <span>Choose one…</span>
        <span aria-hidden>▾</span>
      </div>
    );
  }
  if (type === "date") {
    return (
      <div className={`${box} justify-between`}>
        <span>DD / MM / YYYY</span>
        <span aria-hidden>▤</span>
      </div>
    );
  }
  const placeholder: Record<string, string> = {
    text: "Type your answer…",
    number: "0",
    email: "name@example.com",
    phone: "+60…",
  };
  return (
    <div className={box}>
      <span>{placeholder[type] ?? fieldTypeLabel(type)}</span>
    </div>
  );
}
