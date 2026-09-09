// Houzs Connect - Drizzle schema (Postgres).
//
// Deployed the "Houzs way": Cloudflare Worker + Hyperdrive -> the COMPANY Supabase
// project, same account as the ERP. To avoid colliding with the ERP's `public`
// tables (Contact/Message/Payment etc. would clash) every Connect table lives in a
// dedicated `connect` schema (pgSchema below). The ERP owns `public`; Connect owns
// `connect`; one database, one Hyperdrive, zero collisions.
//
// Columns are snake_case (ERP convention). App code keeps camelCase TS keys.
// IDs are cuid2 (app-generated at insert; see $defaultFn) to match the app's
// existing id shape.

import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const connect = pgSchema("connect");

// ─────────────────────────── Enums ───────────────────────────

export const roleEnum = connect.enum("Role", [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "AGENT",
  "SALES",
  "DRIVER",
  "VIEWER",
]);

export const fieldTypeEnum = connect.enum("FieldType", [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
]);

export const conversationStatusEnum = connect.enum("ConversationStatus", [
  "OPEN",
  "CLOSED",
  "QUEUE",
  "PENDING",
]);

export const directionEnum = connect.enum("Direction", ["IN", "OUT"]);

export const messageTypeEnum = connect.enum("MessageType", [
  "TEXT",
  "INTERACTIVE",
  "TEMPLATE",
  "IMAGE",
  "DOCUMENT",
  "AUDIO",
  "VIDEO",
]);

export const messageStatusEnum = connect.enum("MessageStatus", [
  "QUEUED",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);

export const automationStatusEnum = connect.enum("AutomationStatus", [
  "DRAFT",
  "PUBLISHED",
]);

export const paymentStatusEnum = connect.enum("PaymentStatus", [
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());

// ─────────────────────────── Org & people ───────────────────────────

export const company = connect.table(
  "company",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    // ERP org sync (one-way ERP -> Connect). The ERP `companies` master is the
    // source of truth; these mirror companies.id / companies.code / is_active so
    // 2990 shows up and multi-tenant scoping resolves. Nullable so pre-sync
    // seeded rows stay valid; a (non-partial) unique index keeps erp_company_id
    // 1:1. It must be NON-partial: Postgres won't match a bare ON CONFLICT
    // target to a partial index (42P10), and the sync upserts on erp_company_id.
    // NULLs are distinct in a unique index, so seeded rows (null) still coexist.
    erpCompanyId: integer("erp_company_id"),
    code: text("code"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    erpCompanyIdx: uniqueIndex("company_erp_company_id_key").on(t.erpCompanyId),
  })
);

export const member = connect.table(
  "member",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
    // Email is NO LONGER globally unique: the ERP org sync fans one ERP user out
    // to one member row per granted company, so the same email legitimately
    // appears once per company. Uniqueness is (company_id, email) and identity is
    // (company_id, erp_user_id) — both non-partial unique indexes below.
    email: text("email").notNull(),
    phone: text("phone"),
    title: text("title"),
    role: roleEnum("role").notNull().default("AGENT"),
    status: text("status").notNull().default("active"),
    concurrencyLimit: integer("concurrency_limit").notNull().default(0),
    managerId: text("manager_id"),
    departmentId: text("department_id"),
    // ERP org sync: the ERP users.id this member mirrors, and a soft-delete flag
    // (members are never hard-deleted — they may own conversation assignments —
    // so a user removed from the ERP is marked active=false instead).
    erpUserId: integer("erp_user_id"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("member_company_idx").on(t.companyId),
    managerIdx: index("member_manager_idx").on(t.managerId),
    // Replaces the dropped global email-unique: a person is unique WITHIN a
    // company by email (but recurs across companies via the fan-out). This is
    // also the login upsert's conflict target — see app/login/actions.ts — so it
    // must be NON-partial (a bare ON CONFLICT target won't match a partial index,
    // 42P10). NULLs are distinct in a unique index anyway, so this keeps the same
    // "multiple null rows per company allowed" behavior.
    companyEmailUnique: uniqueIndex("member_company_email_unique").on(t.companyId, t.email),
    erpUserIdx: uniqueIndex("member_company_erp_user_key").on(t.companyId, t.erpUserId),
  })
);

export const department = connect.table(
  "department",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
  },
  (t) => ({ companyIdx: index("department_company_idx").on(t.companyId) })
);

export const team = connect.table(
  "team",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
  },
  (t) => ({ companyIdx: index("team_company_idx").on(t.companyId) })
);

export const teamMember = connect.table(
  "team_member",
  {
    teamId: text("team_id").notNull(),
    memberId: text("member_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.teamId, t.memberId] }) })
);

// ─────────────────────────── Channels ───────────────────────────

export const channel = connect.table(
  "channel",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    provider: text("provider").notNull().default("whatsapp"),
    mode: text("mode").notNull().default("DEMO"),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => ({ companyIdx: index("channel_company_idx").on(t.companyId) })
);

// ─────────────────────────── Contacts / CRM ───────────────────────────

export const contact = connect.table(
  "contact",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    name: text("name"),
    phone: text("phone").notNull(),
    email: text("email"),
    source: text("source"),
    sourceId: text("source_id"),
    sourceUrl: text("source_url"),
    // Dynamic custom attributes keyed by contact_field.key (Seampify's 63 fields).
    attributes: jsonb("attributes"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(true),
    /** Blocked contacts are excluded from broadcasts and flagged in the inbox. */
    blocked: boolean("blocked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    companyPhone: uniqueIndex("contact_company_phone_key").on(t.companyId, t.phone),
    companyIdx: index("contact_company_idx").on(t.companyId),
  })
);

export const contactField = connect.table(
  "contact_field",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: fieldTypeEnum("type").notNull().default("TEXT"),
    options: jsonb("options"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyKey: uniqueIndex("contact_field_company_key_key").on(t.companyId, t.key),
    companyIdx: index("contact_field_company_idx").on(t.companyId),
  })
);

// ─────────────────────────── Conversations / inbox ───────────────────────────

export const conversation = connect.table(
  "conversation",
  {
    id: id(),
    channelId: text("channel_id").notNull(),
    contactId: text("contact_id").notNull(),
    status: conversationStatusEnum("status").notNull().default("OPEN"),
    assignedAgentId: text("assigned_agent_id"),
    assignedDepartmentId: text("assigned_department_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelIdx: index("conversation_channel_idx").on(t.channelId),
    contactIdx: index("conversation_contact_idx").on(t.contactId),
    statusIdx: index("conversation_status_idx").on(t.status),
  })
);

export const message = connect.table(
  "message",
  {
    id: id(),
    conversationId: text("conversation_id").notNull(),
    direction: directionEnum("direction").notNull(),
    type: messageTypeEnum("type").notNull().default("TEXT"),
    body: text("body"),
    mediaUrl: text("media_url"),
    status: messageStatusEnum("status").notNull().default("SENT"),
    sentByMemberId: text("sent_by_member_id"),
    isBot: boolean("is_bot").notNull().default(false),
    waMessageId: text("wa_message_id"),
    interactivePayload: jsonb("interactive_payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ conversationIdx: index("message_conversation_idx").on(t.conversationId) })
);

/**
 * The colleagues watching a conversation — Seampify's "Add Chat Members".
 *
 * NOT the same thing as `conversation.assigned_agent_id`. Assignment is
 * single-valued and says who OWNS the reply; this table is the set of people
 * pulled in to watch and help (the warehouse lead on a damaged-delivery thread,
 * the manager on an escalation). One column cannot express both, which is why
 * this is a row per person rather than another id on `conversation`.
 *
 * `added_by_member_id` is nullable so a row can survive an importer or a future
 * automation adding a watcher with no human actor; every path in the app today
 * writes the acting member.
 */
export const conversationMember = connect.table(
  "conversation_member",
  {
    id: id(),
    conversationId: text("conversation_id").notNull(),
    memberId: text("member_id").notNull(),
    /** Who pulled this person in. Null only for non-human additions. */
    addedByMemberId: text("added_by_member_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // NON-partial, and the ON CONFLICT target addChatMember inserts against:
    // adding someone twice (two agents, one slow panel) must be a no-op, and a
    // bare ON CONFLICT will not match a partial index (42P10).
    //
    // It also serves every read in the app, which is always "the watchers of
    // conversation X" — conversation_id leads the index, so no separate
    // conversation index is needed.
    conversationMemberKey: uniqueIndex("conversation_member_conversation_member_key").on(
      t.conversationId,
      t.memberId
    ),
    // The reverse direction ("what am I watching") is the one lookup the unique
    // index above cannot answer.
    memberIdx: index("conversation_member_member_idx").on(t.memberId),
  })
);

export const note = connect.table(
  "note",
  {
    id: id(),
    conversationId: text("conversation_id").notNull(),
    memberId: text("member_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ conversationIdx: index("note_conversation_idx").on(t.conversationId) })
);

// ─────────────────────────── Tags ───────────────────────────

export const tag = connect.table(
  "tag",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("#16695f"),
  },
  (t) => ({ companyName: uniqueIndex("tag_company_name_key").on(t.companyId, t.name) })
);

export const conversationTag = connect.table(
  "conversation_tag",
  {
    conversationId: text("conversation_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.conversationId, t.tagId] }) })
);

export const contactTag = connect.table(
  "contact_tag",
  {
    contactId: text("contact_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.contactId, t.tagId] }) })
);

// ─────────────────────────── Automations ───────────────────────────

export const automation = connect.table(
  "automation",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    channelId: text("channel_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    triggerType: text("trigger_type").notNull(),
    triggerConfig: jsonb("trigger_config"),
    status: automationStatusEnum("status").notNull().default("DRAFT"),
    enabled: boolean("enabled").notNull().default(false),
    graph: jsonb("graph"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({ companyIdx: index("automation_company_idx").on(t.companyId) })
);

export const automationRun = connect.table(
  "automation_run",
  {
    id: id(),
    automationId: text("automation_id").notNull(),
    contactId: text("contact_id"),
    status: text("status").notNull().default("running"),
    cursorNodeId: text("cursor_node_id"),
    context: jsonb("context"),
    log: jsonb("log"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({ automationIdx: index("automation_run_automation_idx").on(t.automationId) })
);

export const automationVersion = connect.table(
  "automation_version",
  {
    id: id(),
    automationId: text("automation_id").notNull(),
    version: integer("version").notNull(),
    label: text("label"),
    status: text("status"),
    triggerType: text("trigger_type"),
    triggerConfig: jsonb("trigger_config"),
    graph: jsonb("graph"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ automationIdx: index("automation_version_automation_idx").on(t.automationId) })
);

// ─────────────────────────── Payments (receipt OCR) ───────────────────────────

export const payment = connect.table(
  "payment",
  {
    id: id(),
    contactId: text("contact_id").notNull(),
    conversationId: text("conversation_id"),
    amount: doublePrecision("amount"),
    currency: text("currency").notNull().default("MYR"),
    method: text("method"),
    referenceNo: text("reference_no"),
    orderRef: text("order_ref"),
    receiptMediaUrl: text("receipt_media_url"),
    ocrRawText: text("ocr_raw_text"),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ contactIdx: index("payment_contact_idx").on(t.contactId) })
);

// ─────────────────────────── Campaigns ───────────────────────────

export const campaign = connect.table(
  "campaign",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    channelId: text("channel_id").notNull(),
    name: text("name").notNull(),
    templateName: text("template_name"),
    audience: jsonb("audience"),
    scheduleAt: timestamp("schedule_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    stats: jsonb("stats"),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    approvedByMemberId: text("approved_by_member_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index("campaign_company_idx").on(t.companyId) })
);

// ─────────────────────── Template variable bindings ───────────────────────

/**
 * What each {{n}} of an approved WhatsApp template is filled from.
 *
 * The template itself is a Meta asset — it has no row in this database — so the
 * mapping is keyed by the (company, name, language) triple Meta identifies a
 * template by. Name AND language: `delivery_completed_thanks` in en_GB and in
 * en are two different templates as far as Meta is concerned, and they can be
 * mapped differently.
 *
 * `bindings` is an array of { index, source, key?, value? } — see VarBinding in
 * lib/automation/vars.ts. Without this row the send path has no way to know that
 * "{{2}}" means the contact's `ref_1`, and every variable goes out as "-".
 */
export const templateBinding = connect.table(
  "template_binding",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    templateName: text("template_name").notNull(),
    language: text("language").notNull(),
    bindings: jsonb("bindings").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // Non-partial, and the ON CONFLICT target the save action upserts on
    // (a bare ON CONFLICT will not match a partial index — 42P10).
    companyTemplateKey: uniqueIndex("template_binding_company_template_key").on(
      t.companyId,
      t.templateName,
      t.language
    ),
    companyIdx: index("template_binding_company_idx").on(t.companyId),
  })
);

// ─────────────────────────── Quick replies ───────────────────────────

export const quickReply = connect.table(
  "quick_reply",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    shortcut: text("shortcut").notNull(),
    body: text("body").notNull(),
  },
  (t) => ({ companyShortcut: uniqueIndex("quick_reply_company_shortcut_key").on(t.companyId, t.shortcut) })
);

// ─────────────────────────── Driver events ───────────────────────────

export const driverEvent = connect.table(
  "driver_event",
  {
    id: id(),
    driverId: text("driver_id").notNull(),
    contactId: text("contact_id").notNull(),
    orderRef: text("order_ref"),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ contactIdx: index("driver_event_contact_idx").on(t.contactId) })
);

// ─────────────────────────── WhatsApp Forms (Meta Flows) ───────────────────────────

export const form = connect.table(
  "form",
  {
    id: id(),
    companyId: text("company_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    fields: jsonb("fields"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ companyIdx: index("form_company_idx").on(t.companyId) })
);

export const formResponse = connect.table(
  "form_response",
  {
    id: id(),
    formId: text("form_id").notNull(),
    contactId: text("contact_id"),
    answers: jsonb("answers"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ formIdx: index("form_response_form_idx").on(t.formId) })
);

// ─────────────────────────── Inbound webhooks (ERP / driver app) ───────────────────────────

export const webhookEvent = connect.table(
  "webhook_event",
  {
    id: id(),
    source: text("source").notNull(),
    eventType: text("event_type"),
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ sourceIdx: index("webhook_event_source_idx").on(t.source) })
);

// ─────────────────────────── Relations (for db.query nested reads) ───────────────────────────

export const companyRelations = relations(company, ({ many }) => ({
  members: many(member),
  departments: many(department),
  teams: many(team),
  channels: many(channel),
  contacts: many(contact),
  contactFields: many(contactField),
  tags: many(tag),
  automations: many(automation),
  campaigns: many(campaign),
  quickReplies: many(quickReply),
  templateBindings: many(templateBinding),
  forms: many(form),
}));

export const memberRelations = relations(member, ({ one, many }) => ({
  company: one(company, { fields: [member.companyId], references: [company.id] }),
  manager: one(member, {
    fields: [member.managerId],
    references: [member.id],
    relationName: "OrgChart",
  }),
  reports: many(member, { relationName: "OrgChart" }),
  department: one(department, {
    fields: [member.departmentId],
    references: [department.id],
  }),
  teamLinks: many(teamMember),
  assignedConversations: many(conversation, { relationName: "AssignedAgent" }),
  sentMessages: many(message, { relationName: "SentByMember" }),
  notes: many(note),
  driverEvents: many(driverEvent),
}));

export const departmentRelations = relations(department, ({ one, many }) => ({
  company: one(company, { fields: [department.companyId], references: [company.id] }),
  members: many(member),
  conversations: many(conversation, { relationName: "AssignedDepartment" }),
}));

export const teamRelations = relations(team, ({ one, many }) => ({
  company: one(company, { fields: [team.companyId], references: [company.id] }),
  members: many(teamMember),
}));

export const teamMemberRelations = relations(teamMember, ({ one }) => ({
  team: one(team, { fields: [teamMember.teamId], references: [team.id] }),
  member: one(member, { fields: [teamMember.memberId], references: [member.id] }),
}));

export const channelRelations = relations(channel, ({ one, many }) => ({
  company: one(company, { fields: [channel.companyId], references: [company.id] }),
  conversations: many(conversation),
  automations: many(automation),
  campaigns: many(campaign),
}));

export const contactRelations = relations(contact, ({ one, many }) => ({
  company: one(company, { fields: [contact.companyId], references: [company.id] }),
  conversations: many(conversation),
  payments: many(payment),
  tagLinks: many(contactTag),
  driverEvents: many(driverEvent),
}));

export const contactFieldRelations = relations(contactField, ({ one }) => ({
  company: one(company, { fields: [contactField.companyId], references: [company.id] }),
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  channel: one(channel, { fields: [conversation.channelId], references: [channel.id] }),
  contact: one(contact, { fields: [conversation.contactId], references: [contact.id] }),
  assignedAgent: one(member, {
    fields: [conversation.assignedAgentId],
    references: [member.id],
    relationName: "AssignedAgent",
  }),
  assignedDepartment: one(department, {
    fields: [conversation.assignedDepartmentId],
    references: [department.id],
    relationName: "AssignedDepartment",
  }),
  messages: many(message),
  notes: many(note),
  tagLinks: many(conversationTag),
  memberLinks: many(conversationMember),
  payments: many(payment),
}));

/**
 * Only the `conversation` side is reachable from a `many` — the two links to
 * `member` are declared with relation names so that if anyone later adds a
 * `many(conversationMember)` to memberRelations they can say which of the two
 * they mean, instead of hitting Drizzle's "multiple relations" error.
 */
export const conversationMemberRelations = relations(conversationMember, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationMember.conversationId],
    references: [conversation.id],
  }),
  member: one(member, {
    fields: [conversationMember.memberId],
    references: [member.id],
    relationName: "ChatMember",
  }),
  addedBy: one(member, {
    fields: [conversationMember.addedByMemberId],
    references: [member.id],
    relationName: "ChatMemberAddedBy",
  }),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  sentByMember: one(member, {
    fields: [message.sentByMemberId],
    references: [member.id],
    relationName: "SentByMember",
  }),
}));

export const noteRelations = relations(note, ({ one }) => ({
  conversation: one(conversation, {
    fields: [note.conversationId],
    references: [conversation.id],
  }),
  member: one(member, { fields: [note.memberId], references: [member.id] }),
}));

export const tagRelations = relations(tag, ({ one, many }) => ({
  company: one(company, { fields: [tag.companyId], references: [company.id] }),
  conversationLinks: many(conversationTag),
  contactLinks: many(contactTag),
}));

export const conversationTagRelations = relations(conversationTag, ({ one }) => ({
  conversation: one(conversation, {
    fields: [conversationTag.conversationId],
    references: [conversation.id],
  }),
  tag: one(tag, { fields: [conversationTag.tagId], references: [tag.id] }),
}));

export const contactTagRelations = relations(contactTag, ({ one }) => ({
  contact: one(contact, { fields: [contactTag.contactId], references: [contact.id] }),
  tag: one(tag, { fields: [contactTag.tagId], references: [tag.id] }),
}));

export const automationRelations = relations(automation, ({ one, many }) => ({
  company: one(company, { fields: [automation.companyId], references: [company.id] }),
  channel: one(channel, { fields: [automation.channelId], references: [channel.id] }),
  runs: many(automationRun),
  versions: many(automationVersion),
}));

export const automationRunRelations = relations(automationRun, ({ one }) => ({
  automation: one(automation, {
    fields: [automationRun.automationId],
    references: [automation.id],
  }),
}));

export const automationVersionRelations = relations(automationVersion, ({ one }) => ({
  automation: one(automation, {
    fields: [automationVersion.automationId],
    references: [automation.id],
  }),
}));

export const paymentRelations = relations(payment, ({ one }) => ({
  contact: one(contact, { fields: [payment.contactId], references: [contact.id] }),
  conversation: one(conversation, {
    fields: [payment.conversationId],
    references: [conversation.id],
  }),
}));

export const campaignRelations = relations(campaign, ({ one }) => ({
  company: one(company, { fields: [campaign.companyId], references: [company.id] }),
  channel: one(channel, { fields: [campaign.channelId], references: [channel.id] }),
}));

export const quickReplyRelations = relations(quickReply, ({ one }) => ({
  company: one(company, { fields: [quickReply.companyId], references: [company.id] }),
}));

export const templateBindingRelations = relations(templateBinding, ({ one }) => ({
  company: one(company, { fields: [templateBinding.companyId], references: [company.id] }),
}));

export const driverEventRelations = relations(driverEvent, ({ one }) => ({
  driver: one(member, { fields: [driverEvent.driverId], references: [member.id] }),
  contact: one(contact, { fields: [driverEvent.contactId], references: [contact.id] }),
}));

export const formRelations = relations(form, ({ one, many }) => ({
  company: one(company, { fields: [form.companyId], references: [company.id] }),
  responses: many(formResponse),
}));

export const formResponseRelations = relations(formResponse, ({ one }) => ({
  form: one(form, { fields: [formResponse.formId], references: [form.id] }),
}));
