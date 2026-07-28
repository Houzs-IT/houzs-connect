import { initials, tint } from "@/lib/format";
import { ConversationActions } from "./ConversationActions";

type Field = { key: string; name: string };
type NamedColor = { id: string; name: string; color: string };
type Named = { id: string; name: string };

export function ContactPanel({
  conversationId,
  contactName,
  phone,
  status,
  agentId,
  departmentId,
  tags,
  fields,
  values,
  members,
  departments,
  allTags,
  marketingOptIn,
}: {
  conversationId: string;
  contactName: string;
  phone: string;
  status: string;
  agentId: string | null;
  departmentId: string | null;
  tags: NamedColor[];
  fields: Field[];
  values: Record<string, string>;
  members: Named[];
  departments: Named[];
  allTags: NamedColor[];
  marketingOptIn: boolean;
}) {
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
        <ConversationActions
          conversationId={conversationId}
          members={members}
          departments={departments}
          allTags={allTags}
          agentId={agentId}
          departmentId={departmentId}
          status={status}
          activeTagNames={tags.map((t) => t.name)}
        />
        <div className="mt-3 flex items-center justify-between">
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
