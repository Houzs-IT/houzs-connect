import { initials, tint, waIdentifier } from "@/lib/format";
import { CopyButton } from "./CopyButton";
import { RemarksBox } from "./RemarksBox";
import { ProfileEditor } from "./ProfileEditor";
import {
  addChatMember,
  removeChatMember,
  setContactMarketingOptIn,
} from "@/app/(app)/inbox/actions";
import { ConversationActions } from "./ConversationActions";
import { ConversationMenu } from "./ConversationMenu";

type Field = { key: string; name: string };
type NamedColor = { id: string; name: string; color: string };
type Named = { id: string; name: string };
/** A colleague watching this conversation — see conversationMember in schema.ts. */
type ChatMember = { id: string; name: string; addedBy: string | null; addedAt: string };

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
  chatMembers,
  departments,
  allTags,
  marketingOptIn,
  contactId,
  remarks,
  email,
  starred,
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
  chatMembers: ChatMember[];
  departments: Named[];
  allTags: NamedColor[];
  marketingOptIn: boolean;
  contactId: string;
  remarks: string;
  email: string;
  starred: boolean;
}) {
  const populated = fields.filter((f) => values[f.key] != null && values[f.key] !== "");
  // The picker offers the company roster the panel already has, minus whoever is
  // on the conversation — an "Add" that lists people who are already listed
  // above it is just a way to make the no-op path the obvious one.
  const onConversation = new Set(chatMembers.map((m) => m.id));
  const candidates = members.filter((m) => !onConversation.has(m.id));

  return (
    <aside className="scroll-thin hidden w-[300px] shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] xl:block">
      <div className="relative flex flex-col items-center gap-2 border-b border-[var(--color-border)] px-5 py-6 text-center">
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
          <div className="flex items-center gap-1">
            <span
              className="font-mono text-[12px] text-[var(--color-muted)]"
              title={waIdentifier(phone).label}
            >
              {waIdentifier(phone).text}
            </span>
            <CopyButton value={phone} label="number" />
          </div>
          <ProfileEditor
            contactId={contactId}
            name={contactName}
            email={email}
            starred={starred}
          />
          {!waIdentifier(phone).isPhone && (
            // A username contact has NO phone number anywhere in Meta's payload.
            // Saying so beats showing an id that looks like a broken number.
            <div className="mt-0.5 text-[10.5px] text-[var(--color-faint)]">
              WhatsApp username · no phone number shared
            </div>
          )}
        </div>
      </div>

      <Section
        title="Conversation"
        action={<ConversationMenu conversationId={conversationId} />}
      >
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
        {/* A real switch, not a read-out. It used to render the flag and ignore
            every click, which left an agent no way to record "he asked us to
            stop" — and campaigns filter their audience on exactly this column. */}
        <form
          action={setContactMarketingOptIn}
          className="mt-3 flex items-center justify-between"
        >
          <input type="hidden" name="conversationId" value={conversationId} />
          <input type="hidden" name="optIn" value={marketingOptIn ? "0" : "1"} />
          <span className="text-[12px] text-[var(--color-muted)]">Marketing opt-in</span>
          <button
            type="submit"
            role="switch"
            aria-checked={marketingOptIn}
            aria-label="Marketing opt-in"
            title={
              marketingOptIn
                ? "On — broadcasts include this customer. Click to opt them out."
                : "Off — broadcasts skip this customer. Click to opt them back in."
            }
            className={`h-4 w-7 rounded-full p-0.5 transition-colors ${
              marketingOptIn ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"
            }`}
          >
            <span
              className={`block h-3 w-3 rounded-full bg-white transition-transform ${
                marketingOptIn ? "translate-x-3" : ""
              }`}
            />
          </button>
        </form>
      </Section>

      {/* Seampify keeps this separate from Assigned Agent, and so do we: the
          dropdown above says who OWNS the reply, this says who else was pulled
          in to watch. Adding someone here does not change the assignment, and
          it does not (today) widen the org-chart visibility in lib/access.ts —
          so the copy promises attention, not access. */}
      <Section title={`Add Chat Members · ${chatMembers.length}`}>
        {chatMembers.length === 0 ? (
          <p className="text-[12px] text-[var(--color-faint)]">
            Nobody else is on this conversation yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chatMembers.map((m) => (
              <form
                key={m.id}
                action={removeChatMember}
                className="flex items-center gap-1 rounded-md bg-[var(--color-accent-soft)] py-0.5 pl-2 pr-1 text-[11px] font-medium text-[var(--color-accent-ink)]"
              >
                <input type="hidden" name="conversationId" value={conversationId} />
                <input type="hidden" name="memberId" value={m.id} />
                <span
                  title={
                    m.addedBy
                      ? `Added by ${m.addedBy} · ${m.addedAt}`
                      : `Added ${m.addedAt}`
                  }
                >
                  {m.name}
                </span>
                <button
                  type="submit"
                  aria-label={`Remove ${m.name} from this conversation`}
                  title="Remove from this conversation"
                  className="rounded px-0.5 leading-none text-[var(--color-accent)] transition-colors hover:text-[var(--color-danger)]"
                >
                  ×
                </button>
              </form>
            ))}
          </div>
        )}

        {candidates.length > 0 ? (
          <form action={addChatMember} className="mt-2.5 flex items-center gap-1.5">
            <input type="hidden" name="conversationId" value={conversationId} />
            <select
              name="memberId"
              defaultValue=""
              aria-label="Add a colleague to this conversation"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">Add a colleague…</option>
              {candidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-[12px] font-medium text-white"
            >
              Add
            </button>
          </form>
        ) : (
          <p className="mt-2.5 text-[11px] text-[var(--color-faint)]">
            Everyone in the company is already on this conversation.
          </p>
        )}
        <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--color-faint)]">
          Members are shown in the thread header so the room knows who is
          watching. Ownership stays with the assigned agent.
        </p>
      </Section>

      <Section title="Remarks">
        <RemarksBox contactId={contactId} value={remarks} />
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
        {/* "members" would now read as the chat members above; this line has
            always been the company roster the pickers are drawn from. */}
        {members.length} staff · {departments.length} departments
      </div>
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--color-border)] px-5 py-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}
