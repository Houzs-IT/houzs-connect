import Link from "next/link";
import { notFound } from "next/navigation";
import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { form, formResponse } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { relTime } from "@/lib/format";
import { getCurrentMember } from "@/lib/current-member";
import { createForm } from "./actions";
import { FormActions } from "./FormActions";
import { fieldTypeLabel, readFields } from "./fields";

export default async function FormsPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();

  // The card footer needs a response *count*, so count in Postgres. Loading
  // every form_response row to read `.length` grew with submissions forever.
  // The count is joined through `form` so another company's answers can never
  // land in this map.
  const [rows, responseCounts] = await Promise.all([
    db.query.form.findMany({
      where: eq(form.companyId, me.companyId),
      orderBy: desc(form.createdAt),
    }),
    db
      .select({ formId: formResponse.formId, n: count() })
      .from(formResponse)
      .innerJoin(form, eq(form.id, formResponse.formId))
      .where(eq(form.companyId, me.companyId))
      .groupBy(formResponse.formId),
  ]);
  const countByForm = new Map(responseCounts.map((r) => [r.formId, r.n]));

  const forms = rows.map((f) => ({
    id: f.id,
    name: f.name,
    published: f.status === "published",
    createdAt: f.createdAt,
    fields: readFields(f.fields),
    responses: countByForm.get(f.id) ?? 0,
  }));

  const inUse = forms.filter((f) => f.published).length;

  return (
    <PageChrome
      title="WhatsApp Forms"
      subtitle="Questions customers answer inside the chat — every answer files itself onto their contact"
    >
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        {/* ── New form ───────────────────────────────────────── */}
        <form
          action={createForm}
          className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-card"
        >
          <h3 className="mb-1 text-[13px] font-semibold text-[var(--color-ink)]">
            New form
          </h3>
          <p className="mb-3 text-[11px] text-[var(--color-faint)]">
            It starts as a draft. You add the questions on the next screen, and
            nothing reaches a customer until you put it in use.
          </p>

          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Name</label>
          <input
            name="name"
            required
            placeholder="e.g. Delivery date"
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          />

          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
            Questions (optional — one per line)
          </label>
          {/* A `placeholder`, not a `defaultValue`: pre-filling the box meant an
              untouched submit created a form full of example questions. */}
          <textarea
            name="fields"
            rows={4}
            placeholder={"delivery_date_1 | Preferred delivery date | date\nhouse_type | Property type | select\ndisposal | Dispose old items? | select"}
            className="mb-1.5 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 font-code text-[12px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
          />
          <p className="mb-3 text-[10.5px] leading-snug text-[var(--color-faint)]">
            Each line is{" "}
            <span className="font-code">saved as | question | answer type</span>.
            Leave it empty and add the questions one at a time on the next screen
            instead.
          </p>

          <button
            type="submit"
            className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Create draft &amp; add questions
          </button>
        </form>

        {/* ── The list ───────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-3">
          {forms.length > 0 && (
            <p className="text-[11.5px] text-[var(--color-faint)]">
              {forms.length} form{forms.length === 1 ? "" : "s"} ·{" "}
              {inUse === 0
                ? "none is in use yet"
                : `${inUse} in use, ${forms.length - inUse} draft`}
            </p>
          )}

          {forms.length === 0 && (
            <div className="dot-grid grid min-h-[200px] place-items-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-center">
              <div className="px-6">
                <p className="text-[13px] font-medium text-[var(--color-ink)]">
                  No forms yet
                </p>
                <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                  Make one on the left. A form asks the customer a few questions
                  inside WhatsApp and files each answer onto their contact
                  details, so automations and campaigns can use them.
                </p>
              </div>
            </div>
          )}

          {forms.map((f) => (
            <div
              key={f.id}
              className="animate-rise rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card"
            >
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/forms/${f.id}`}
                    className="text-[14px] font-semibold text-[var(--color-ink)] hover:underline"
                  >
                    {f.name}
                  </Link>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                      f.published
                        ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                        : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
                    }`}
                  >
                    {f.published ? "In use" : "Draft"}
                  </span>
                </div>

                <p className="mt-1 text-[12px] text-[var(--color-muted)]">
                  {f.published
                    ? "Can be sent to customers."
                    : "Cannot be sent to customers yet."}
                </p>

                {f.fields.length === 0 ? (
                  <p className="mt-2 text-[12px] text-[var(--color-faint)]">
                    No questions yet — open it and add the first one.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {f.fields.map((fld) => (
                      <span
                        key={fld.key}
                        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                      >
                        {fld.label}{" "}
                        <span className="text-[var(--color-faint)]">
                          · {fieldTypeLabel(fld.type)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2.5">
                <span className="mr-auto font-mono text-[11px] text-[var(--color-faint)]">
                  {f.fields.length} question{f.fields.length === 1 ? "" : "s"} ·{" "}
                  {f.responses} answered · made {relTime(f.createdAt)}
                </span>
                <Link
                  href={`/forms/${f.id}`}
                  className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                >
                  Open &amp; edit
                </Link>
                <FormActions
                  id={f.id}
                  name={f.name}
                  published={f.published}
                  fieldCount={f.fields.length}
                  responseCount={f.responses}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageChrome>
  );
}
