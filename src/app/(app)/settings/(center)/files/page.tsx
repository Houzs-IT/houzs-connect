import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { clockTime, formatPhone } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";

export const dynamic = "force-dynamic";

const TABS = ["all", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "receipts"] as const;
const ICON: Record<string, [string, string]> = {
  IMAGE: ["▣", "pink"],
  DOCUMENT: ["▤", "blue"],
  AUDIO: ["♪", "green"],
  VIDEO: ["▶", "purple"],
  RECEIPT: ["RM", "orange"],
};

type Row = { id: string; kind: string; direction: string; body: string | null; created_at: string; name: string | null; phone: string; conversation_id: string | null };

/** Every photo, file and voice note sent in this company's chats, plus receipts. */
export default async function FilesPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string }> }) {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const sp = await searchParams;
  const type = (TABS as readonly string[]).includes(sp.type ?? "") ? (sp.type as (typeof TABS)[number]) : "all";
  const q = (sp.q ?? "").trim();
  const like = `%${q}%`;
  const digits = q.replace(/\D/g, "");
  const who = q ? sql`and (ct.name ilike ${like} ${digits.length >= 3 ? sql`or ct.phone like ${`%${digits}%`}` : sql``})` : sql``;

  const db = getDb();
  const messages =
    type === "receipts"
      ? []
      : ((await db.execute(sql`
          select m.id, m.type as kind, m.direction, m.body, m.created_at, ct.name, ct.phone, m.conversation_id
          from connect.message m
          join connect.conversation cv on cv.id = m.conversation_id
          join connect.contact ct on ct.id = cv.contact_id
          where ct.company_id = ${me.companyId} and m.media_url like 'whatsapp-media:%'
            ${type === "all" ? sql`and m.type in ('IMAGE','DOCUMENT','AUDIO','VIDEO')` : sql`and m.type = ${type}`}
            ${who}
          order by m.created_at desc limit 120
        `)) as unknown as Row[]);
  const receipts =
    type === "all" || type === "receipts"
      ? ((await db.execute(sql`
          select p.id, 'RECEIPT' as kind, 'IN' as direction, p.reference_no as body, p.created_at, ct.name, ct.phone, p.conversation_id
          from connect.payment p join connect.contact ct on ct.id = p.contact_id
          where ct.company_id = ${me.companyId} and p.receipt_media_url like 'whatsapp-media:%' ${who}
          order by p.created_at desc limit 60
        `)) as unknown as Row[])
      : [];
  const files = [...messages, ...receipts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 120);
  const label: Record<string, string> = { all: L.fAll, IMAGE: L.fPhotos, DOCUMENT: L.fDocs, AUDIO: L.fVoice, VIDEO: L.fVideo, receipts: L.fReceipts };
  const src = (f: Row) => (f.kind === "RECEIPT" ? `/payments/${f.id}/receipt` : `/settings/files/${f.id}`);
  const kindLabel = (kind: string) => label[kind === "RECEIPT" ? "receipts" : kind] ?? kind;
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep");

  const columns: DataColumn[] = [
    { key: "file", label: t.service.mediaFile, filter: false },
    { key: "type", label: t.logs.colType },
    { key: "customer", label: t.logs.colCustomer },
    { key: "direction", label: t.logs.colDirection },
    { key: "when", label: t.logs.when },
    { key: "actions", label: "", align: "right", sort: false, filter: false },
  ];
  const rows: DataRow[] = files.map((f) => {
    const [icon, tone] = ICON[f.kind] ?? ["▤", "blue"];
    const who = f.name || formatPhone(f.phone);
    const visual = f.kind === "IMAGE" || f.kind === "RECEIPT";
    const title = f.body?.split("\n")[0] || kindLabel(f.kind);
    const at = new Date(f.created_at);
    const direction = f.direction === "IN" ? t.logs.incoming : t.logs.outgoing;
    return {
      id: `${f.kind}-${f.id}`,
      // Newest first is the page's own order; a header click sorts by the instant.
      sort: { file: title, type: kindLabel(f.kind), customer: who, direction, when: at.getTime() },
      text: { file: title, type: kindLabel(f.kind), customer: who, direction, when: day(at) },
      cells: {
        file: (
          <div className="flex min-w-0 items-center gap-3">
            <a href={src(f)} target="_blank" rel="noopener" className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[8px] bg-[var(--color-surface-2)]">
              {visual ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src(f)} alt="" loading="lazy" className="h-full w-full object-cover" />
              ) : (
                <span
                  className="grid h-8 w-8 place-items-center rounded-full text-[12px] font-bold"
                  style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                >
                  {icon}
                </span>
              )}
            </a>
            <a href={src(f)} target="_blank" rel="noopener" className="min-w-0 max-w-[320px] truncate font-semibold text-[var(--color-ink)] hover:underline">
              {title}
            </a>
          </div>
        ),
        type: <span className="whitespace-nowrap text-[var(--color-muted)]">{kindLabel(f.kind)}</span>,
        customer: (
          <div className="min-w-0">
            <div className="truncate text-[var(--color-ink)]">{who}</div>
            {f.name && <div className="truncate font-code text-[11px] text-[var(--color-faint)]">{formatPhone(f.phone)}</div>}
          </div>
        ),
        direction: <span className="whitespace-nowrap text-[var(--color-muted)]">{direction}</span>,
        when: (
          <span className="whitespace-nowrap tabular-nums text-[var(--color-muted)]">
            {day(at)} · {clockTime(at)}
          </span>
        ),
        actions: (
          <span className="inline-flex gap-3 whitespace-nowrap text-[12px] font-semibold">
            <a href={f.kind === "RECEIPT" ? src(f) : `${src(f)}?download=1`} className="text-[var(--color-accent)]" download>
              {L.fDownload}
            </a>
            {f.conversation_id && (
              <Link href={`/inbox/${f.conversation_id}`} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                {L.fChat}
              </Link>
            )}
          </span>
        ),
      },
    };
  });

  return (
    <PageChrome section="settings" crumbs={[L.files]}>
      <div className="p-4 md:p-6">
        <SettingsHead title={L.files} sub={L.filesSub} />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {TABS.map((k) => (
            <Link
              key={k}
              href={`/settings/files?type=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`flex h-[32px] items-center rounded-full border px-3 text-[12.5px] font-semibold ${
                type === k ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]"
              }`}
            >
              {label[k]}
            </Link>
          ))}
          <form className="ml-auto">
            <input type="hidden" name="type" value={type} />
            <input
              name="q"
              defaultValue={q}
              placeholder={L.fSearch}
              className="h-[34px] w-[220px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
          </form>
        </div>
        <p className="mb-3 text-[12px] text-[var(--color-faint)]">{fmt(L.fCount, { n: files.length })}</p>
        {/* The type tabs and the customer search above reach the database; the
            table's own sort and funnels work over the files loaded here. Keyed by
            tab so its funnels start fresh when the loaded set changes. */}
        <DataTable key={type} columns={columns} rows={rows} search={false} minWidth={820} stateKey={`settings-files:${type}`} empty={L.fNone} />
        <p className="mt-4 text-[12px] text-[var(--color-faint)]">{L.fNote}</p>
      </div>
    </PageChrome>
  );
}
