import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contactField, quickReply, tag } from "@/db/schema";
import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { addContactField, addQuickReply, addTag, deleteContactField, deleteQuickReply, deleteTag } from "../actions";
import { SettingsHead } from "../ui";

const input =
  "h-[36px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const addBtn =
  "h-[36px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)]";
const addRow = "flex flex-wrap gap-2 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3";

/** A contact field's type, as the add form and the Type funnel name it. */
const FIELD_TYPES: [string, string][] = [
  ["TEXT", "Text"],
  ["NUMBER", "Number"],
  ["DATE", "Date"],
  ["BOOLEAN", "Boolean"],
  ["SELECT", "Select"],
];
const FIELD_TYPE = Object.fromEntries(FIELD_TYPES);

const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep");

/** The actions column every list here shares: just Remove. */
const ACTIONS: DataColumn = { key: "actions", label: "", align: "right", className: "w-[1%]", sort: false, filter: false };

function Remove({ action, id, label }: { action: (fd: FormData) => void; id: string; label: string }) {
  return (
    <form action={action} className="inline-flex">
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

/** One list's heading: icon, title and what it is for. The table below brings its own border. */
function Section({ icon, tone, title, sub, className = "", children }: { icon: string; tone: string; title: string; sub: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-2.5 ${className}`}>
      <div className="flex items-center gap-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-bold"
          style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</h3>
          <p className="text-[12px] text-[var(--color-faint)]">{sub}</p>
        </div>
      </div>
      {children}
    </section>
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

  const replyCols: DataColumn[] = [
    { key: "shortcut", label: L.shortcut, className: "w-[1%] whitespace-nowrap", filter: false },
    { key: "body", label: L.body, filter: false },
    ACTIONS,
  ];
  const replyRows: DataRow[] = replies.map((q) => ({
    id: q.id,
    sort: { shortcut: q.shortcut, body: q.body },
    text: { shortcut: `/${q.shortcut}`, body: q.body },
    cells: {
      shortcut: <span className="rounded-[4px] bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-code text-[11.5px] text-[var(--color-accent-ink)]">/{q.shortcut}</span>,
      body: (
        <span className="line-clamp-2 text-[var(--color-muted)]" title={q.body}>
          {q.body}
        </span>
      ),
      actions: <Remove action={deleteQuickReply} id={q.id} label={L.remove} />,
    },
  }));

  const tagCols: DataColumn[] = [{ key: "name", label: L.tagName, filter: false }, ACTIONS];
  const tagRows: DataRow[] = tags.map((x) => ({
    id: x.id,
    sort: { name: x.name },
    cells: {
      name: (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
          <span className="truncate text-[var(--color-ink)]">{x.name}</span>
        </span>
      ),
      actions: <Remove action={deleteTag} id={x.id} label={L.remove} />,
    },
  }));

  const fieldCols: DataColumn[] = [
    { key: "name", label: L.fieldName, filter: false },
    { key: "key", label: L.fieldKey, filter: false },
    { key: "type", label: t.logs.colType },
    { key: "created", label: t.contacts.colCreated, filter: false },
    ACTIONS,
  ];
  const fieldRows: DataRow[] = fields.map((f) => {
    const type = FIELD_TYPE[f.type] ?? f.type;
    return {
      id: f.id,
      sort: { name: f.name, key: f.key, type, created: f.createdAt.getTime() },
      text: { name: f.name, key: f.key, type, created: fmtDay(f.createdAt) },
      cells: {
        name: <span className="text-[var(--color-ink)]">{f.name}</span>,
        key: <span className="font-code text-[11.5px] text-[var(--color-pastel-purple-ink)]">{f.key}</span>,
        type: (
          <span className="rounded-[4px] bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-muted)]">{type}</span>
        ),
        created: <span className="whitespace-nowrap text-[var(--color-muted)]">{fmtDay(f.createdAt)}</span>,
        actions: <Remove action={deleteContactField} id={f.id} label={L.remove} />,
      },
    };
  });

  return (
    <PageChrome section="settings" crumbs={[L.library]}>
      <div className="p-4 md:p-6">
        <SettingsHead title={L.library} sub={L.librarySub} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Section icon="/" tone="orange" title={L.quickReplies} sub={L.qrSub}>
            <DataTable columns={replyCols} rows={replyRows} minWidth={420} stateKey="settings-quick-replies" empty={L.noneYet} />
            <form action={addQuickReply} className={addRow}>
              <input name="shortcut" placeholder={L.shortcut} required className={`${input} w-28`} />
              <input name="body" placeholder={L.body} required className={`${input} min-w-0 flex-1`} />
              <button type="submit" className={addBtn}>
                {L.add}
              </button>
            </form>
          </Section>

          <Section icon="#" tone="purple" title={L.tags} sub={L.tagsSub}>
            <DataTable columns={tagCols} rows={tagRows} minWidth={300} stateKey="settings-tags" empty={L.noneYet} />
            <form action={addTag} className={addRow}>
              <input name="name" placeholder={L.tagName} required className={`${input} min-w-0 flex-1`} />
              <input name="color" type="color" defaultValue="#1e6f80" className="h-[36px] w-11 cursor-pointer rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]" />
              <button type="submit" className={addBtn}>
                {L.add}
              </button>
            </form>
          </Section>

          <Section icon="▤" tone="cyan" title={L.fields} sub={L.fieldsSub} className="lg:col-span-2">
            <DataTable columns={fieldCols} rows={fieldRows} minWidth={560} stateKey="settings-contact-fields" empty={L.noneYet} />
            <form action={addContactField} className={addRow}>
              <input name="name" placeholder={L.fieldName} required className={`${input} min-w-0 flex-1`} />
              <select name="type" className={input} defaultValue="TEXT">
                {FIELD_TYPES.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
              <button type="submit" className={addBtn}>
                {L.add}
              </button>
            </form>
          </Section>
        </div>
      </div>
    </PageChrome>
  );
}
