import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { getDict } from "@/lib/i18n/server";
import { listKeys } from "@/lib/api-keys";
import { can } from "@/lib/permissions";
import { SetCard, SettingsHead } from "../ui";
import { Keys } from "./Keys";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });

/** API keys for other systems, and what the API offers. */
export default async function DevelopersPage() {
  const me = await getCurrentMember();
  if (!me) notFound();
  const t = await getDict();
  const L = t.set;
  const [keys, canManage, h] = await Promise.all([listKeys(me.companyId).catch(() => []), can(me, "settings"), headers()]);
  const base = `https://${h.get("host") ?? "connect"}/api/v1`;
  const endpoints: [string, string, string][] = [
    ["GET", "/contacts?q=&limit=", `curl -H "Authorization: Bearer $KEY" "${base}/contacts?q=wong"`],
    ["GET", "/payments?status=PENDING", `curl -H "Authorization: Bearer $KEY" "${base}/payments?status=VERIFIED"`],
    [
      "POST",
      "/messages",
      `curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\\n  -d '{"phone":"60123456789","template":"delivery_date_confirm","language":"en","params":["Wong","znt5961"]}' \\\n  "${base}/messages"`,
    ],
  ];

  return (
    <PageChrome section="settings" crumbs={[L.developers]}>
      <div className="flex max-w-[1000px] flex-col gap-4 p-4 md:p-6">
        <SettingsHead title={L.developers} sub={L.devSub} />
        <Keys
          canManage={canManage}
          rows={keys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            created: fmtDate(k.createdAt),
            lastUsed: k.lastUsedAt ? fmtDate(k.lastUsedAt) : null,
            revoked: !!k.revokedAt,
            createdBy: k.createdBy,
          }))}
        />
        <SetCard icon="⇄" tone="purple" title={L.endpoints} sub={base}>
          {endpoints.map(([method, path, curl]) => (
            <div key={path} className="border-t border-[var(--color-border-subtle)] px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-[4px] px-1.5 py-px text-[10.5px] font-bold ${
                    method === "GET" ? "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]" : "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]"
                  }`}
                >
                  {method}
                </span>
                <span className="font-code text-[12.5px] text-[var(--color-ink)]">{path}</span>
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre rounded-[8px] bg-[#0b1020] p-3 font-code text-[11.5px] leading-relaxed text-[#cfe3ea]">{curl}</pre>
            </div>
          ))}
        </SetCard>
      </div>
    </PageChrome>
  );
}
