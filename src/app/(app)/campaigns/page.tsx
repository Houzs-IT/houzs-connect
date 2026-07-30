import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaign, tag } from "@/db/schema";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { createAndSendCampaign } from "./actions";
import { relTime } from "@/lib/format";

export default async function CampaignsPage() {
  const db = getDb();
  const me = await getCurrentMember();
  if (!me) return null;
  const [campaigns, tags] = await Promise.all([
    db.query.campaign.findMany({
      where: eq(campaign.companyId, me.companyId),
      orderBy: desc(campaign.createdAt),
    }),
    db.query.tag.findMany({
      where: eq(tag.companyId, me.companyId),
      orderBy: asc(tag.name),
    }),
  ]);

  return (
    <PageChrome title="Campaigns" subtitle="One-off WhatsApp broadcasts">
      <div className="grid gap-6 p-6 lg:grid-cols-[380px_1fr]">
        {/* Create */}
        <form
          action={createAndSendCampaign}
          className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">
            New broadcast
          </h3>
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Name</label>
          <input
            name="name"
            required
            placeholder="e.g. Balance reminder"
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Audience</label>
          <select
            name="audience"
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="all">All contacts</option>
            {tags.map((t) => (
              <option key={t.id} value={t.name}>Tagged: {t.name}</option>
            ))}
          </select>
          <label className="mb-1 block text-[11px] text-[var(--color-muted)]">Message</label>
          <textarea
            name="message"
            required
            rows={4}
            placeholder="Hi {full_name}, a quick reminder about order {ref_1}…"
            className="mb-3 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 text-[13px] outline-none focus:border-[var(--color-accent)]"
          />
          <p className="mb-3 text-[11px] text-[var(--color-faint)]">
            Merge vars: {"{full_name}"} {"{ref_1}"} {"{amount}"} … · DEMO sends via the stubbed transport.
          </p>
          <button className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white">
            Send broadcast
          </button>
        </form>

        {/* History */}
        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Audience</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--color-faint)]">No campaigns yet.</td></tr>
              )}
              {campaigns.map((c) => {
                const stats = (c.stats as { total?: number; sent?: number } | null) ?? {};
                const aud = (c.audience as { value?: string } | null)?.value ?? "all";
                return (
                  <tr key={c.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-3 font-medium text-[var(--color-ink)]">{c.name}</td>
                    <td className="px-4 py-3 text-[var(--color-muted)]">{aud}</td>
                    <td className="px-4 py-3 font-mono text-[var(--color-ink)]">
                      {stats.sent ?? 0}/{stats.total ?? 0}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-faint)]">{relTime(c.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-success)]">
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
