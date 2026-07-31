import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaign, contact, contactField, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { CampaignComposer } from "./CampaignComposer";
import { relTime } from "@/lib/format";

// Status → token colour. Campaign.status is free-form text (no enum) so we map
// the known lifecycle values and fall back to a neutral tint.
const STATUS_COLOR: Record<string, string> = {
  draft: "var(--color-faint)",
  scheduled: "var(--color-warning)",
  sending: "var(--color-accent)",
  completed: "var(--color-success)",
  sent: "var(--color-success)",
};

interface CampaignStats {
  total?: number;
  sent?: number;
  delivered?: number;
  read?: number;
  replied?: number;
}

export default async function CampaignsPage() {
  const db = getDb();
  const me = await getCurrentMember();
  if (!me) return null;

  const [campaigns, tagsWithLinks, totalContacts, fields] = await Promise.all([
    db.query.campaign.findMany({
      where: eq(campaign.companyId, me.companyId),
      orderBy: desc(campaign.createdAt),
    }),
    db.query.tag.findMany({
      where: eq(tag.companyId, me.companyId),
      orderBy: asc(tag.name),
      with: { contactLinks: true },
    }),
    db.$count(contact, eq(contact.companyId, me.companyId)),
    db.query.contactField.findMany({
      where: eq(contactField.companyId, me.companyId),
      orderBy: asc(contactField.key),
    }),
  ]);

  const tagOpts = tagsWithLinks.map((t) => ({
    name: t.name,
    color: t.color,
    count: t.contactLinks.length,
  }));

  // Built-in merge vars plus every configured custom field key.
  const varKeys = ["full_name", "phone", ...fields.map((f) => f.key)];

  return (
    <PageChrome title="Campaigns" subtitle="One-time WhatsApp broadcasts">
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        <CampaignComposer
          tags={tagOpts}
          totalContacts={totalContacts}
          varKeys={varKeys}
        />

        {/* History */}
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Audience</th>
                <th className="px-4 py-3 font-medium">Recipients</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Read</th>
                <th className="px-4 py-3 font-medium">Replied</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[var(--color-faint)]">
                    No campaigns yet.
                  </td>
                </tr>
              )}
              {campaigns.map((c) => {
                const stats = (c.stats as CampaignStats | null) ?? {};
                const aud = (c.audience as { value?: string } | null)?.value ?? "all";
                const color = STATUS_COLOR[c.status] ?? "var(--color-muted)";
                const when = c.scheduleAt
                  ? `scheduled ${relTime(c.scheduleAt)}`
                  : relTime(c.createdAt);
                return (
                  <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-ink)]">
                      {c.name}
                      {c.templateName && (
                        <span className="ml-2 font-mono text-[10px] text-[var(--color-faint)]">
                          {c.templateName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{aud}</td>
                    <td className="px-4 py-3 font-mono text-[var(--color-muted)]">
                      {stats.total ?? 0}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-ink)]">
                      {stats.sent ?? 0}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-muted)]">
                      {stats.read ?? 0}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--color-muted)]">
                      {stats.replied ?? 0}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-faint)]">{when}</td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-medium capitalize"
                        style={{
                          background: `color-mix(in srgb, ${color} 12%, transparent)`,
                          color,
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PageChrome>
  );
}
