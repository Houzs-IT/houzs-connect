import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contactField, member, quickReply, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import {
  addContactField,
  addQuickReply,
  addTag,
  deleteContactField,
  deleteQuickReply,
  deleteTag,
} from "./actions";

const inputCls =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const addBtnCls =
  "rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90";

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function DeleteBtn({ action, id }: { action: (fd: FormData) => void; id: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-md px-2 py-1 text-[11px] font-medium text-[var(--color-faint)] transition-colors hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
      >
        Remove
      </button>
    </form>
  );
}

export default async function SettingsPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const db = getDb();

  // Every one of these four was unfiltered, and the ERP org sync deliberately
  // fans one ERP user out to one member row PER GRANTED COMPANY — so the org
  // chart listed the same person once per company ("Bernard … Sales Department"
  // directly above "Bernard … — —") and the count read 112 for a company with
  // roughly half that many staff. Tags, fields and quick replies had the same
  // hole, which is worse than a wrong number: the /bank quick reply carries a
  // live account number, and an unscoped read would hand it to another tenant.
  const [members, fields, tags, quickReplies] = await Promise.all([
    db.query.member.findMany({
      where: eq(member.companyId, me.companyId),
      orderBy: asc(member.name),
      with: { manager: true, department: true },
    }),
    db.query.contactField.findMany({
      where: eq(contactField.companyId, me.companyId),
      orderBy: asc(contactField.name),
    }),
    db.query.tag.findMany({
      where: eq(tag.companyId, me.companyId),
      orderBy: asc(tag.name),
    }),
    db.query.quickReply.findMany({
      where: eq(quickReply.companyId, me.companyId),
      orderBy: asc(quickReply.shortcut),
    }),
  ]);

  const cards = [
    { label: "Team members", value: members.length },
    { label: "Custom fields", value: fields.length },
    { label: "Tags", value: tags.length },
    { label: "Quick replies", value: quickReplies.length },
  ];

  return (
    <PageChrome title="Settings" subtitle="Org chart, custom fields, tags, quick replies">
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="text-[22px] font-semibold text-[var(--color-ink)]">{c.value}</div>
              <div className="text-[11px] text-[var(--color-muted)]">{c.label}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Quick replies */}
          <Card title="Quick replies" subtitle="Typed after &quot;/&quot; in the composer.">
            <div className="divide-y divide-[var(--color-border)]">
              {quickReplies.map((q) => (
                <div key={q.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-accent-ink)]">
                    /{q.shortcut}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-muted)]">{q.body}</span>
                  <DeleteBtn action={deleteQuickReply} id={q.id} />
                </div>
              ))}
              {quickReplies.length === 0 && (
                <div className="px-4 py-3 text-[12px] text-[var(--color-faint)]">No quick replies yet.</div>
              )}
            </div>
            <form action={addQuickReply} className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <input name="shortcut" placeholder="shortcut" required className={`${inputCls} w-28`} />
              <input name="body" placeholder="Message body" required className={`${inputCls} min-w-0 flex-1`} />
              <button type="submit" className={addBtnCls}>Add</button>
            </form>
          </Card>

          {/* Tags */}
          <Card title="Tags" subtitle="Label conversations and contacts.">
            <div className="divide-y divide-[var(--color-border)]">
              {tags.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)]">{t.name}</span>
                  <DeleteBtn action={deleteTag} id={t.id} />
                </div>
              ))}
              {tags.length === 0 && (
                <div className="px-4 py-3 text-[12px] text-[var(--color-faint)]">No tags yet.</div>
              )}
            </div>
            <form action={addTag} className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <input name="name" placeholder="Tag name" required className={`${inputCls} min-w-0 flex-1`} />
              <input name="color" type="color" defaultValue="#16695f" className="h-9 w-10 cursor-pointer rounded border border-[var(--color-border)] bg-[var(--color-surface)]" />
              <button type="submit" className={addBtnCls}>Add</button>
            </form>
          </Card>
        </div>

        {/* Contact fields */}
        <Card title="Contact fields" subtitle="The CRM attribute schema synced from ERP orders.">
          <div className="grid grid-cols-1 divide-y divide-[var(--color-border)] sm:grid-cols-2 sm:divide-y-0">
            {fields.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[var(--color-ink)]">{f.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-[var(--color-faint)]">{f.key}</span>
                </span>
                <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                  {f.type}
                </span>
                <DeleteBtn action={deleteContactField} id={f.id} />
              </div>
            ))}
            {fields.length === 0 && (
              <div className="px-4 py-3 text-[12px] text-[var(--color-faint)]">No fields yet.</div>
            )}
          </div>
          <form action={addContactField} className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
            <input name="name" placeholder="Field name (e.g. Delivery Date)" required className={`${inputCls} min-w-0 flex-1`} />
            <select name="type" className={inputCls} defaultValue="TEXT">
              <option value="TEXT">Text</option>
              <option value="NUMBER">Number</option>
              <option value="DATE">Date</option>
              <option value="BOOLEAN">Boolean</option>
              <option value="SELECT">Select</option>
            </select>
            <button type="submit" className={addBtnCls}>Add</button>
          </form>
        </Card>

        {/* Org chart (read-only — synced from ERP on login) */}
        <Card title="Org chart & roles" subtitle="Synced from the Houzs ERP staff directory each time someone signs in.">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium">Reports to</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-2.5 font-medium text-[var(--color-ink)]">{m.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-md bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent-ink)]">
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">{m.department?.name ?? "—"}</td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">{m.manager?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </PageChrome>
  );
}
