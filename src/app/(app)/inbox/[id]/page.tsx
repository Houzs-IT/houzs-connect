import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contactField, conversation, department, member, tag } from "@/db/schema";
import { Thread } from "@/components/inbox/Thread";
import { Composer } from "@/components/inbox/Composer";
import { ContactPanel } from "@/components/inbox/ContactPanel";
import { DemoReplyBar } from "@/components/inbox/DemoReplyBar";
import { attrs, initials, tint } from "@/lib/format";

/**
 * How much of the thread is rendered. WhatsApp threads with a customer run for
 * months; loading every message meant the page got slower for exactly the
 * customers the team talks to most. The tail is what operators read, so take
 * the newest N and put them back in reading order.
 */
const THREAD_LIMIT = 200;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();

  const convo = await db.query.conversation.findFirst({
    where: eq(conversation.id, id),
    with: {
      contact: true,
      assignedAgent: true,
      assignedDepartment: true,
      tagLinks: { with: { tag: true } },
      messages: {
        orderBy: (m, { desc }) => desc(m.createdAt),
        limit: THREAD_LIMIT,
      },
    },
  });
  if (!convo) notFound();

  // Newest-first off the index, oldest-first on screen.
  const messages = convo.messages.slice().reverse();

  const [fields, members, departments, tags] = await Promise.all([
    db.query.contactField.findMany({
      where: eq(contactField.companyId, convo.contact.companyId),
      orderBy: asc(contactField.createdAt),
    }),
    db.query.member.findMany({ orderBy: asc(member.name) }),
    db.query.department.findMany({ orderBy: asc(department.name) }),
    db.query.tag.findMany({ where: eq(tag.companyId, convo.contact.companyId) }),
  ]);

  const name = convo.contact.name ?? convo.contact.phone;
  const contactAttrs = attrs(convo.contact.attributes);

  return (
    <div className="flex min-w-0 flex-1">
      {/* Center: thread */}
      <div className="flex min-w-0 flex-1 flex-col bg-[var(--color-canvas)]">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5">
          <div
            className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-white"
            style={{ background: tint(name) }}
          >
            {initials(name).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[var(--color-ink)]">
              {name}
            </div>
            <div className="font-mono text-[11px] text-[var(--color-muted)]">
              +{convo.contact.phone}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted)]">
              {convo.status}
            </span>
            <span className="rounded-full border border-[color-mix(in_srgb,var(--color-success)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-success)]">
              23h 49m window
            </span>
          </div>
        </div>

        <Thread
          messages={messages}
          contactName={name}
          conversationId={convo.id}
        />
        <DemoReplyBar conversationId={convo.id} />
        <Composer conversationId={convo.id} />
      </div>

      {/* Right: contact + order attributes */}
      <ContactPanel
        conversationId={convo.id}
        contactName={name}
        phone={convo.contact.phone}
        status={convo.status}
        agentId={convo.assignedAgentId}
        departmentId={convo.assignedDepartmentId}
        tags={convo.tagLinks.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color }))}
        fields={fields.map((f) => ({ key: f.key, name: f.name }))}
        values={contactAttrs}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        departments={departments.map((d) => ({ id: d.id, name: d.name }))}
        allTags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        marketingOptIn={convo.contact.marketingOptIn}
      />
    </div>
  );
}
