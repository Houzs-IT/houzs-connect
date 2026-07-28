import { db } from "@/lib/db";
import { PageChrome } from "@/components/PageChrome";

export default async function SettingsPage() {
  const [members, departments, fields, tags, quickReplies, channels] =
    await Promise.all([
      db.member.findMany({
        orderBy: { name: "asc" },
        include: { manager: true, department: true },
      }),
      db.department.count(),
      db.contactField.count(),
      db.tag.count(),
      db.quickReply.count(),
      db.channel.count(),
    ]);

  const cards = [
    { label: "Team members", value: members.length },
    { label: "Departments", value: departments },
    { label: "Custom fields", value: fields },
    { label: "Tags", value: tags },
    { label: "Quick replies", value: quickReplies },
    { label: "Channels", value: channels },
  ];

  return (
    <PageChrome
      title="Settings"
      subtitle="Org chart, roles, channels, custom fields"
    >
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="text-[22px] font-semibold text-[var(--color-ink)]">
                {c.value}
              </div>
              <div className="text-[11px] text-[var(--color-muted)]">
                {c.label}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">
              Org chart & roles
            </h3>
            <p className="text-[11px] text-[var(--color-faint)]">
              Visibility is derived from this hierarchy.
            </p>
          </div>
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-wide text-[var(--color-faint)]">
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Department</th>
                <th className="px-4 py-2.5 font-medium">Reports to</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium text-[var(--color-ink)]">
                    {m.name}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">
                    {m.title ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-md bg-[var(--color-accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent-ink)]">
                      {m.role}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">
                    {m.department?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">
                    {m.manager?.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageChrome>
  );
}
