import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { form } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { createForm, setFormStatus } from "./actions";

export default async function FormsPage() {
  const db = getDb();
  const me = await getCurrentMember();
  const rows = await db.query.form.findMany({
    where: eq(form.companyId, me.companyId),
    orderBy: desc(form.createdAt),
    with: { responses: { columns: { id: true } } },
  });
  const forms = rows.map((f) => ({
    ...f,
    _count: { responses: f.responses.length },
  }));

  return (
    <PageChrome
      title="WhatsApp Forms"
      subtitle="In-chat data-collection forms (LIVE = Meta WhatsApp Flows)"
    >
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        <form
          action={createForm}
          className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">New form</h3>
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Name</label>
          <input
            name="name"
            required
            placeholder="e.g. Delivery Date"
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">
            Fields — one per line: key | label | type
          </label>
          <textarea
            name="fields"
            rows={5}
            defaultValue={"delivery_date_1 | Preferred delivery date | date\nhouse_type | Property type | select\ndisposal | Dispose old items? | select"}
            className="mb-3 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 font-mono text-[12px] outline-none focus:border-[var(--color-accent)]"
          />
          <button className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white">
            Create form
          </button>
        </form>

        <div className="flex flex-col gap-3">
          {forms.length === 0 && (
            <div className="dot-grid grid min-h-[160px] place-items-center rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[13px] text-[var(--color-muted)]">
              No forms yet — create one on the left.
            </div>
          )}
          {forms.map((f) => {
            const fields = Array.isArray(f.fields) ? (f.fields as { key: string; label: string; type: string }[]) : [];
            return (
              <div key={f.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{f.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${f.status === "published" ? "bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] text-[var(--color-success)]" : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"}`}>
                      {f.status}
                    </span>
                    <form action={setFormStatus}>
                      <input type="hidden" name="formId" value={f.id} />
                      <input type="hidden" name="status" value={f.status === "published" ? "draft" : "published"} />
                      <button className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">
                        {f.status === "published" ? "Unpublish" : "Publish"}
                      </button>
                    </form>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {fields.map((fld) => (
                    <span key={fld.key} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]">
                      {fld.label} <span className="text-[var(--color-faint)]">· {fld.type}</span>
                    </span>
                  ))}
                </div>
                <div className="mt-3 border-t border-[var(--color-border)] pt-2 font-mono text-[11px] text-[var(--color-faint)]">
                  {f._count.responses} responses · {fields.length} fields
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PageChrome>
  );
}
