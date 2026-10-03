import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contactField, quickReply, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { addContactField, addQuickReply, addTag, deleteContactField, deleteQuickReply, deleteTag } from "../actions";
import { SetCard, SettingsHead } from "../ui";

const input =
  "h-[36px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const addBtn =
  "h-[36px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]";

function Remove({ action, id, label }: { action: (fd: FormData) => void; id: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-[6px] px-2 py-1 text-[11.5px] font-semibold text-[var(--color-faint)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
      >
        {label}
      </button>
    </form>
  );
}

/** Quick replies, tags and contact fields — the company's shared vocabulary. */
export default async function LibraryPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const db = getDb();
  const [fields, tags, replies] = await Promise.all([
    db.query.contactField.findMany({ where: eq(contactField.companyId, me.companyId), orderBy: asc(contactField.name) }),
    db.query.tag.findMany({ where: eq(tag.companyId, me.companyId), orderBy: asc(tag.name) }),
    db.query.quickReply.findMany({ where: eq(quickReply.companyId, me.companyId), orderBy: asc(quickReply.shortcut) }),
  ]);

  return (
    <PageChrome section="settings" crumbs={[L.library]}>
      <div className="max-w-[1100px] p-4 md:p-6">
        <SettingsHead title={L.library} sub={L.librarySub} />
        <div className="grid gap-4 lg:grid-cols-2">
          <SetCard icon="/" tone="orange" title={L.quickReplies} sub={L.qrSub}>
            <div className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
              {replies.map((q) => (
                <div key={q.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="rounded-[4px] bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-code text-[11.5px] text-[var(--color-accent-ink)]">/{q.shortcut}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-muted)]">{q.body}</span>
                  <Remove action={deleteQuickReply} id={q.id} label={L.remove} />
                </div>
              ))}
              {replies.length === 0 && <p className="px-4 py-3 text-[12.5px] text-[var(--color-faint)]">{L.noneYet}</p>}
            </div>
            <form action={addQuickReply} className="flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <input name="shortcut" placeholder={L.shortcut} required className={`${input} w-28`} />
              <input name="body" placeholder={L.body} required className={`${input} min-w-0 flex-1`} />
              <button type="submit" className={addBtn}>
                {L.add}
              </button>
            </form>
          </SetCard>

          <SetCard icon="#" tone="purple" title={L.tags} sub={L.tagsSub}>
            <div className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
              {tags.map((x) => (
                <div key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)]">{x.name}</span>
                  <Remove action={deleteTag} id={x.id} label={L.remove} />
                </div>
              ))}
              {tags.length === 0 && <p className="px-4 py-3 text-[12.5px] text-[var(--color-faint)]">{L.noneYet}</p>}
            </div>
            <form action={addTag} className="flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <input name="name" placeholder={L.tagName} required className={`${input} min-w-0 flex-1`} />
              <input name="color" type="color" defaultValue="#1e6f80" className="h-[36px] w-11 cursor-pointer rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]" />
              <button type="submit" className={addBtn}>
                {L.add}
              </button>
            </form>
          </SetCard>

          <SetCard icon="▤" tone="cyan" title={L.fields} sub={L.fieldsSub} className="lg:col-span-2">
            <div className="grid grid-cols-1 border-t border-[var(--color-border-subtle)] sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.id} className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-[var(--color-ink)]">{f.name}</span>
                    <span className="block truncate font-code text-[11px] text-[var(--color-pastel-purple-ink)]">{f.key}</span>
                  </span>
                  <span className="rounded-[4px] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">{f.type}</span>
                  <Remove action={deleteContactField} id={f.id} label={L.remove} />
                </div>
              ))}
              {fields.length === 0 && <p className="px-4 py-3 text-[12.5px] text-[var(--color-faint)]">{L.noneYet}</p>}
            </div>
            <form action={addContactField} className="flex flex-wrap gap-2 bg-[var(--color-surface-2)] px-4 py-3">
              <input name="name" placeholder={L.fieldName} required className={`${input} min-w-0 flex-1`} />
              <select name="type" className={input} defaultValue="TEXT">
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
                <option value="DATE">Date</option>
                <option value="BOOLEAN">Boolean</option>
                <option value="SELECT">Select</option>
              </select>
              <button type="submit" className={addBtn}>
                {L.add}
              </button>
            </form>
          </SetCard>
        </div>
      </div>
    </PageChrome>
  );
}
