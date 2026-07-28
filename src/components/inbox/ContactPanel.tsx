import { initials, tint } from "@/lib/format";

type Field = { key: string; name: string };
type NamedColor = { name: string; color: string };

export function ContactPanel({
  contactName,
  phone,
  status,
  assignedAgent,
  assignedDepartment,
  tags,
  fields,
  values,
  members,
  departments,
  marketingOptIn,
}: {
  contactName: string;
  phone: string;
  status: string;
  assignedAgent: string | null;
  assignedDepartment: string | null;
  tags: NamedColor[];
  fields: Field[];
  values: Record<string, string>;
  members: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  allTags: NamedColor[];
  marketingOptIn: boolean;
}) {
  // Only show fields that have a value (the customer's live order detail).
  const populated = fields.filter((f) => values[f.key] != null && values[f.key] !== "");

  return (
    <aside className="scroll-thin hidden w-[300px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] xl:block">
      <div className="flex flex-col items-center gap-2 border-b border-[var(--color-border)] px-5 py-6 text-center">
        <div
          className="grid h-14 w-14 place-items-center rounded-full text-lg font-semibold text-white"
          style={{ background: tint(contactName) }}
        >
          {initials(contactName).toUpperCase()}
        </div>
        <div>
          <div className="text-[15px] font-semibold text-[var(--color-ink)]">
            {contactName}
          </div>
          <div className="font-mono text-[12px] text-[var(--color-muted)]">
            +{phone}
          </div>
        </div>
      </div>

      <Section title="Conversation">
        <Row label="Status" value={status} />
        <Row label="Assigned agent" value={assignedAgent ?? "Unassigned"} />
        <Row label="Department" value={assignedDepartment ?? "—"} />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[12px] text-[var(--color-muted)]">Marketing opt-in</span>
          <span
            className={`h-4 w-7 rounded-full p-0.5 transition-colors ${
              marketingOptIn ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"
            }`}
          >
            <span
              className={`block h-3 w-3 rounded-full bg-white transition-transform ${
                marketingOptIn ? "translate-x-3" : ""
              }`}
            />
          </span>
        </div>
      </Section>

      <Section title="Tags">
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && (
            <span className="text-[12px] text-[var(--color-faint)]">No tags</span>
          )}
          {tags.map((t) => (
            <span
              key={t.name}
              className="rounded-md px-2 py-0.5 text-[11px] font-medium"
              style={{ background: `${t.color}1f`, color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      </Section>

      <Section title={`Order details · ${populated.length}/${fields.length}`}>
        {populated.length === 0 && (
          <p className="text-[12px] text-[var(--color-faint)]">
            No attributes synced yet.
          </p>
        )}
        <dl className="flex flex-col gap-2">
          {populated.map((f) => (
            <div key={f.key} className="flex flex-col">
              <dt className="text-[10.5px] uppercase tracking-wide text-[var(--color-faint)]">
                {f.name}
              </dt>
              <dd className="text-[13px] text-[var(--color-ink)]">
                {values[f.key]}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <div className="px-5 pb-6 pt-1 font-mono text-[10px] text-[var(--color-faint)]">
        {members.length} members · {departments.length} departments
      </div>
    </aside>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--color-border)] px-5 py-4">
      <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[12px] text-[var(--color-muted)]">{label}</span>
      <span className="text-[12.5px] font-medium text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}
