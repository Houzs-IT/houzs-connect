import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { formatPhone } from "@/lib/format";
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

  return (
    <PageChrome section="settings" crumbs={[L.files]}>
      <div className="max-w-[1180px] p-4 md:p-6">
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
        {files.length === 0 ? (
          <p className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center text-[13px] text-[var(--color-faint)]">{L.fNone}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {files.map((f) => {
              const [icon, tone] = ICON[f.kind] ?? ["▤", "blue"];
              const who = f.name || formatPhone(f.phone);
              const visual = f.kind === "IMAGE" || f.kind === "RECEIPT";
              return (
                <div key={`${f.kind}-${f.id}`} className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <a href={src(f)} target="_blank" rel="noopener" className="grid h-[120px] place-items-center bg-[var(--color-surface-2)]">
                    {visual ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src(f)} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <span
                        className="grid h-12 w-12 place-items-center rounded-full text-[16px] font-bold"
                        style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
                      >
                        {icon}
                      </span>
                    )}
                  </a>
                  <div className="px-3 py-2">
                    <div className="truncate text-[12.5px] font-semibold text-[var(--color-ink)]">{f.body?.split("\n")[0] || label[f.kind === "RECEIPT" ? "receipts" : f.kind] || "—"}</div>
                    <div className="truncate text-[11.5px] text-[var(--color-faint)]">
                      {fmt(f.direction === "IN" ? L.fFrom : L.fTo, { who })} ·{" "}
                      {new Date(f.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" })}
                    </div>
                    <div className="mt-1.5 flex gap-3 text-[12px] font-semibold">
                      <a href={f.kind === "RECEIPT" ? src(f) : `${src(f)}?download=1`} className="text-[var(--color-accent)]" download>
                        {L.fDownload}
                      </a>
                      {f.conversation_id && (
                        <Link href={`/inbox/${f.conversation_id}`} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                          {L.fChat}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[12px] text-[var(--color-faint)]">{L.fNote}</p>
      </div>
    </PageChrome>
  );
}
