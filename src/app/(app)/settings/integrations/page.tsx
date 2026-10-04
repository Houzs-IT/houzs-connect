import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { isLive, phoneNumberInfo } from "@/lib/whatsapp/cloud-api";
import { SettingsHead } from "../ui";

export const dynamic = "force-dynamic";

const when = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).replace("Sept", "Sep");

/** The systems Connect talks to, and whether each one is actually talking back. */
export default async function IntegrationsPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const db = getDb();
  const last = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q).catch(() => [])) as unknown as { at: string | null }[];
    return r[0]?.at ? new Date(r[0].at) : null;
  };
  const [wa, erpAt, driverAt] = await Promise.all([
    phoneNumberInfo().catch(() => null),
    last(sql`select max(created_at) as at from connect.webhook_event where source = 'erp'`),
    last(sql`
      select max(d.created_at) as at from connect.driver_event d
      join connect.contact c on c.id = d.contact_id where c.company_id = ${me.companyId}
    `),
  ]);
  const live = isLive();

  const cards: { name: string; icon: string; tone: string; state: string; good: boolean | null; body: string }[] = [
    { name: L.iErp, icon: "H", tone: "orange", state: L.iPaused, good: null, body: L.iErpBody },
    {
      name: L.iWa,
      icon: "☏",
      tone: "green",
      state: !live ? L.iDemo : wa?.connection === "CONNECTED" ? L.iConnected : (wa?.connection ?? L.iNotSet),
      good: live ? wa?.connection === "CONNECTED" : null,
      body: wa?.displayPhoneNumber ? `${wa.displayPhoneNumber}${wa.verifiedName ? ` · ${wa.verifiedName}` : ""}` : "",
    },
    { name: L.iErpHook, icon: "⇄", tone: "blue", state: erpAt ? L.iConnected : L.iNotSet, good: !!erpAt, body: erpAt ? fmt(L.iLast, { when: when(erpAt) }) : L.iNever },
    { name: L.iDriver, icon: "▶", tone: "cyan", state: driverAt ? L.iConnected : L.iNotSet, good: !!driverAt, body: driverAt ? fmt(L.iLast, { when: when(driverAt) }) : L.iNever },
  ];

  return (
    <PageChrome section="settings" crumbs={[L.integrations]}>
      <div className="max-w-[1000px] p-4 md:p-6">
        <SettingsHead title={L.integrations} sub={L.iTitle} />
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((c) => (
            <section key={c.name} className="flex items-start gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[15px] font-bold"
                style={{ background: `var(--color-pastel-${c.tone})`, color: `var(--color-pastel-${c.tone}-ink)` }}
              >
                {c.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">{c.name}</h3>
                  <span
                    className={`rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${
                      c.good === true
                        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : c.good === false
                          ? "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                          : "bg-[var(--color-pastel-orange)] text-[var(--color-warning)]"
                    }`}
                  >
                    {c.state}
                  </span>
                </div>
                {c.body && <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">{c.body}</p>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </PageChrome>
  );
}
