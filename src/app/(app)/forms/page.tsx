import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contact as contactTable, form, formResponse } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { relTime, stamp } from "@/lib/format";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { createForm } from "./actions";
import { FormBuilder } from "./FormBuilder";
import { readFields } from "./fields";

/** Newest answers first; enough to work from without paging a whole year in. */
const RESPONSE_LIMIT = 200;
const TONES = ["green", "orange", "purple", "pink", "blue", "cyan"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function FormsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();
  const t = await getDict();
  const L = t.tf;
  const sp = await searchParams;
  const status = one(sp.status);
  const tab = one(sp.tab);

  // Response counts in Postgres, joined through `form` so another company's
  // answers can never land in this map.
  const [rows, responseCounts] = await Promise.all([
    db.query.form.findMany({ where: eq(form.companyId, me.companyId), orderBy: desc(form.createdAt) }),
    db
      .select({ formId: formResponse.formId, n: count() })
      .from(formResponse)
      .innerJoin(form, eq(form.id, formResponse.formId))
      .where(eq(form.companyId, me.companyId))
      .groupBy(formResponse.formId),
  ]);
  const answered = new Map(responseCounts.map((r) => [r.formId, r.n]));
  const withMeta = rows.map((f) => ({ ...f, questions: readFields(f.fields), responses: answered.get(f.id) ?? 0 }));
  const forms = withMeta.filter((f) => !status || f.status === status);
  // An explicitly opened form shows even when the status filter would hide it.
  const selected = withMeta.find((f) => f.id === one(sp.f)) ?? forms[0] ?? null;

  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, ...extra })) if (v) p.set(k, v);
    return `/forms${p.size ? `?${p}` : ""}`;
  };

  // Answers for the selected form, only when that view is open.
  const responses =
    selected && tab === "answers"
      ? await db
          .select({
            id: formResponse.id,
            answers: formResponse.answers,
            createdAt: formResponse.createdAt,
            contactName: contactTable.name,
            contactPhone: contactTable.phone,
          })
          .from(formResponse)
          .leftJoin(contactTable, and(eq(contactTable.id, formResponse.contactId), eq(contactTable.companyId, me.companyId)))
          .where(eq(formResponse.formId, selected.id))
          .orderBy(desc(formResponse.createdAt))
          .limit(RESPONSE_LIMIT)
      : [];

  return (
    <PageChrome
      section="templates"
      page="forms"
      actions={
        <form action={createForm}>
          <input type="hidden" name="name" value={L.newFormName} />
          <button className="flex h-[34px] items-center gap-1.5 rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]">
            <span className="text-[16px] leading-none">+</span>
            {L.newForm}
          </button>
        </form>
      }
    >
      <div className="flex min-h-full">
        <div className="w-[300px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-2)] p-3.5">
          {forms.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-[var(--color-faint)]">{rows.length ? L.noFormsMatch : L.noForms}</p>
          )}
          <div className="flex flex-col gap-2.5">
            {forms.map((f, i) => {
              const on = f.id === selected?.id;
              const tone = TONES[i % TONES.length];
              const live = f.status === "published";
              return (
                <Link
                  key={f.id}
                  href={href({ f: f.id })}
                  className={`flex items-center gap-3 rounded-[12px] border bg-[var(--color-surface)] px-3 py-3 ${
                    on ? "border-[var(--color-accent)] shadow-[0_0_0_3px_var(--color-accent-ring)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                  }`}
                >
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                    style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="5" y="3" width="14" height="18" rx="2" />
                      <path d="M9 8h6M9 12h6M9 16h4" />
                    </svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{f.name}</span>
                    <span className="block truncate text-[11.5px] text-[var(--color-faint)]">
                      {fmt(L.questionsN, { n: f.questions.length })} · {fmt(L.answeredN, { n: f.responses })}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                      live ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                    }`}
                  >
                    {live ? L.inUse : L.draft}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {!selected ? (
          <p className="p-6 text-[13px] text-[var(--color-faint)]">{L.selectForm}</p>
        ) : tab === "answers" ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-semibold text-[var(--color-ink)]">{selected.name}</div>
                <div className="text-[12px] text-[var(--color-faint)]">{fmt(L.answeredN, { n: selected.responses })}</div>
              </div>
              <Link
                href={href({ f: selected.id })}
                className="flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
              >
                {L.backToQuestions}
              </Link>
            </div>
            <div className="p-4">
              <div className="overflow-x-auto rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                {responses.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">{L.noAnswers}</p>
                ) : (
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-faint)]">
                        <th className="px-4 py-2.5">{L.customer}</th>
                        {selected.questions.map((q) => (
                          <th key={q.key} className="px-4 py-2.5">
                            {q.label}
                          </th>
                        ))}
                        <th className="px-4 py-2.5">{L.when}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {responses.map((r) => {
                        const a = r.answers && typeof r.answers === "object" ? (r.answers as Record<string, unknown>) : {};
                        return (
                          <tr key={r.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                            <td className="px-4 py-3 text-[var(--color-ink)]">
                              {r.contactName ?? "—"}
                              {r.contactPhone && <span className="ml-2 text-[11.5px] text-[var(--color-faint)]">{r.contactPhone}</span>}
                            </td>
                            {selected.questions.map((q) => {
                              const v = a[q.key];
                              return (
                                <td key={q.key} className="px-4 py-3 text-[var(--color-muted)]">
                                  {v == null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </td>
                              );
                            })}
                            <td className="px-4 py-3 text-[12px] text-[var(--color-faint)]">{stamp(r.createdAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        ) : (
          <FormBuilder
            key={selected.id}
            id={selected.id}
            initialName={selected.name}
            initialFields={selected.questions}
            published={selected.status === "published"}
            responses={selected.responses}
            sub={`${fmt(L.questionsN, { n: selected.questions.length })} · ${fmt(L.made, { when: relTime(selected.createdAt) })}`}
            answersHref={href({ f: selected.id, tab: "answers" })}
          />
        )}
      </div>
    </PageChrome>
  );
}
