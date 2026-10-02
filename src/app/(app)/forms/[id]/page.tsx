import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  contact as contactTable,
  form as formTable,
  formResponse as formResponseTable,
} from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { stamp } from "@/lib/format";
import { getCurrentMember } from "@/lib/current-member";
import { FormActions } from "../FormActions";
import { FormEditor } from "../FormEditor";
import { readFields } from "../fields";

/** Newest answers first; enough to work from without paging a whole year in. */
const RESPONSE_LIMIT = 200;

export default async function FormDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();

  // Company-scoped read, same as every other authenticated page.
  const form = await db.query.form.findFirst({
    where: and(eq(formTable.id, id), eq(formTable.companyId, me.companyId)),
  });
  if (!form) notFound();

  const fields = readFields(form.fields);

  // Who answered comes from `contact`; `form_response.contact_id` is a plain
  // text column with no relation defined, so it is joined by hand.
  const responses = await db
    .select({
      id: formResponseTable.id,
      answers: formResponseTable.answers,
      createdAt: formResponseTable.createdAt,
      contactName: contactTable.name,
      contactPhone: contactTable.phone,
    })
    .from(formResponseTable)
    .leftJoin(contactTable, eq(contactTable.id, formResponseTable.contactId))
    .where(eq(formResponseTable.formId, id))
    .orderBy(desc(formResponseTable.createdAt))
    .limit(RESPONSE_LIMIT);

  const published = form.status === "published";

  return (
    // The Topbar keeps the section's identity (it is known before the data is,
    // so the loading state can render it for real); the form's own name leads
    // the page body.
    <PageChrome section="templates" page="forms">
      <div className="flex flex-col gap-6 p-6">
        {/* ── Header: back, name, status, actions ───────────── */}
        <div>
          <Link
            href="/forms"
            className="text-[13px] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            ← All forms
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h2 className="text-[17px] font-semibold text-[var(--color-ink)]">
              {form.name}
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                published
                  ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]"
                  : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
              }`}
            >
              {published ? "In use" : "Draft"}
            </span>
            <span className="font-mono text-[11px] text-[var(--color-faint)]">
              {fields.length} question{fields.length === 1 ? "" : "s"} ·{" "}
              {responses.length}
              {responses.length === RESPONSE_LIMIT ? "+" : ""} answered
            </span>
            <div className="ml-auto">
              <FormActions
                id={form.id}
                name={form.name}
                published={published}
                fieldCount={fields.length}
                responseCount={responses.length}
                afterDelete="back"
                size="md"
              />
            </div>
          </div>
          <p className="mt-1 text-[12px] text-[var(--color-muted)]">
            {published
              ? "Customers can be sent this form from a conversation or from an automation step."
              : "Nothing is sent to anyone while it is a draft. Use “Put it in use” when the questions are right."}
          </p>
        </div>

        {/* ── Edit + live preview ───────────────────────────── */}
        <FormEditor
          formId={form.id}
          initialName={form.name}
          initialFields={fields}
        />

        {/* ── Answers ───────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
              Answers
            </h3>
            <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
              What customers sent back. Each answer is also saved onto that
              customer&apos;s contact details.
            </p>
          </div>

          {responses.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
              {published
                ? "Nobody has answered this form yet."
                : "No answers yet — this form is still a draft, so it has not been sent to anyone."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                    <th className="px-4 py-3 font-medium">Customer</th>
                    {fields.map((f) => (
                      <th key={f.key} className="px-4 py-3 font-medium">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((r) => {
                    // `answers` is free-form jsonb: read it defensively and
                    // print a dash for a question this submission skipped.
                    const answers =
                      r.answers && typeof r.answers === "object"
                        ? (r.answers as Record<string, unknown>)
                        : {};
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-[var(--color-border)] last:border-0"
                      >
                        <td className="px-4 py-3 text-[var(--color-ink)]">
                          {r.contactName ?? "Unknown"}
                          {r.contactPhone && (
                            <span className="ml-2 font-mono text-[11px] text-[var(--color-faint)]">
                              {r.contactPhone}
                            </span>
                          )}
                        </td>
                        {fields.map((f) => {
                          const v = answers[f.key];
                          const text =
                            v == null || v === ""
                              ? "—"
                              : typeof v === "object"
                                ? JSON.stringify(v)
                                : String(v);
                          return (
                            <td
                              key={f.key}
                              className="px-4 py-3 text-[var(--color-muted)]"
                            >
                              {text}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 font-mono text-[11.5px] text-[var(--color-faint)]">
                          {stamp(r.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageChrome>
  );
}
