// Seed Houzs Connect demo data into the `connect` schema. Standalone (tsx) —
// connects directly via .dev.vars DATABASE_URL. Demo data lives in a script, not
// a numbered migration (ERP convention): migrations run in prod, seeds don't.
//   pnpm db:seed
import { eq } from "drizzle-orm";
import { scriptDb } from "./_env";
import {
  automation,
  channel,
  company,
  contact,
  contactField,
  contactTag,
  conversation,
  conversationTag,
  department,
  driverEvent,
  member,
  message,
  note,
  payment,
  quickReply,
  tag,
  team,
  teamMember,
  automationRun,
} from "../src/db/schema";
import {
  CONTACT_FIELDS,
  MEMBERS,
  DEPARTMENTS,
  TAGS,
  QUICK_REPLIES,
} from "../prisma/seed-data";

async function main() {
  const { db, sql } = scriptDb();
  console.log("Seeding Houzs Connect demo data…");

  // Wipe (dev only). No FK constraints in the schema, so order is not required,
  // but keep a sensible teardown.
  for (const t of [
    message,
    note,
    conversationTag,
    contactTag,
    payment,
    driverEvent,
    conversation,
    contact,
    contactField,
    automationRun,
    automation,
    quickReply,
    tag,
    teamMember,
    team,
    channel,
    member,
    department,
    company,
  ]) {
    await db.delete(t);
  }

  const [companyRow] = await db
    .insert(company)
    .values({ name: "Houzs Century Sdn Bhd", slug: "houzs-century" })
    .returning();

  // Departments
  const deptByName = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const [d] = await db
      .insert(department)
      .values({ companyId: companyRow.id, name })
      .returning();
    deptByName.set(name, d.id);
  }

  // Members (two passes so managers exist before reports link to them)
  const memberByKey = new Map<string, string>();
  for (const m of MEMBERS) {
    const [created] = await db
      .insert(member)
      .values({
        companyId: companyRow.id,
        name: m.name,
        email: m.email,
        role: m.role as typeof member.$inferInsert["role"],
        title: m.title,
        departmentId: deptByName.get(m.department) ?? null,
      })
      .returning();
    memberByKey.set(m.key, created.id);
  }
  for (const m of MEMBERS) {
    if (m.manager) {
      await db
        .update(member)
        .set({ managerId: memberByKey.get(m.manager)! })
        .where(eq(member.id, memberByKey.get(m.key)!));
    }
  }

  // Channel (demo WhatsApp number)
  const [channelRow] = await db
    .insert(channel)
    .values({
      companyId: companyRow.id,
      displayName: "Houzs Century Sdn Bhd",
      phone: "601161556133",
      mode: "DEMO",
      isDefault: true,
    })
    .returning();

  // Contact fields (63)
  for (const f of CONTACT_FIELDS) {
    await db.insert(contactField).values({
      companyId: companyRow.id,
      key: f.key,
      name: f.name,
      type: f.type,
    });
  }

  // Tags
  const tagByName = new Map<string, string>();
  for (const t of TAGS) {
    const [tagRow] = await db
      .insert(tag)
      .values({ companyId: companyRow.id, name: t.name, color: t.color })
      .returning();
    tagByName.set(t.name, tagRow.id);
  }

  // Quick replies
  for (const q of QUICK_REPLIES) {
    await db.insert(quickReply).values({
      companyId: companyRow.id,
      shortcut: q.shortcut,
      body: q.body,
    });
  }

  // Sample contacts + conversations
  const sampleContacts = [
    { name: "Wong", phone: "60124055395", agent: "syu", tags: ["scheduling"], attrs: { ref_1: "znt5961", sales_person: "WEIPIN", delivery_date_1: "2026/07/31", house_type: "Condo", disposal: "sofa", address_state: "Penang", brand_1: "ZANOTTI", amount: "1200" } },
    { name: "Esther Lee", phone: "60122959833", agent: "sya", tags: ["balance collection"], attrs: { ref_1: "znt6012", sales_person: "Peter", amount: "850" } },
    { name: "Janice", phone: "60178192899", agent: "azza", tags: [], attrs: { ref_1: "znt6033", delivery_date_1: "2026/08/02" } },
    { name: "TEOH CHOON KHIM", phone: "60124015732", agent: "syu", tags: ["scheduling", "vip"], attrs: { ref_1: "znt6041" } },
  ];

  for (const c of sampleContacts) {
    const [contactRow] = await db
      .insert(contact)
      .values({
        companyId: companyRow.id,
        name: c.name,
        phone: c.phone,
        attributes: c.attrs,
      })
      .returning();
    for (const tname of c.tags) {
      await db
        .insert(contactTag)
        .values({ contactId: contactRow.id, tagId: tagByName.get(tname)! });
    }
    const [convo] = await db
      .insert(conversation)
      .values({
        channelId: channelRow.id,
        contactId: contactRow.id,
        status: "OPEN",
        assignedAgentId: memberByKey.get(c.agent) ?? null,
        assignedDepartmentId: deptByName.get("Support") ?? null,
        lastMessageAt: new Date(),
        unreadCount: 1,
      })
      .returning();
    await db.insert(message).values([
      {
        conversationId: convo.id,
        direction: "IN",
        type: "TEXT",
        body: "Hi, I would like to arrange my delivery date.",
        status: "READ",
      },
      {
        conversationId: convo.id,
        direction: "OUT",
        type: "TEXT",
        body: `Hi ${c.name}, sure! Please choose your preferred delivery date.`,
        isBot: true,
        status: "DELIVERED",
      },
    ]);
    for (const tname of c.tags) {
      await db
        .insert(conversationTag)
        .values({ conversationId: convo.id, tagId: tagByName.get(tname)! });
    }
  }

  const supportDeptId = deptByName.get("Support") ?? null;

  // Sample automation: delivery follow-up (ERP webhook -> ask confirm/amend).
  await db.insert(automation).values({
    companyId: companyRow.id,
    channelId: channelRow.id,
    name: "New Delivery Follow-up",
    description:
      "ERP order-ready -> ask the customer to confirm the delivery date; confirm syncs to ERP + tags, amend collects a reason.",
    triggerType: "WEBHOOK",
    status: "PUBLISHED",
    enabled: true,
    triggerConfig: { source: "erp", event: "order_ready" },
    graph: {
      nodes: [
        { id: "n_trigger", type: "trigger", data: {}, x: 40, y: 200 },
        {
          id: "n_ask",
          type: "ask_buttons",
          x: 260,
          y: 200,
          data: {
            message:
              "Hi {full_name}! Your order {ref_1} is ready. Is {delivery_date_1} a good delivery date?",
            buttons: [
              { id: "confirm", label: "Confirm Date" },
              { id: "amend", label: "Change Date" },
            ],
          },
        },
        { id: "n_set_confirm", type: "set_attribute", x: 520, y: 90, data: { key: "delivery_message_status_1", value: "Done Scheduling" } },
        { id: "n_tag_sched", type: "add_tag", x: 740, y: 90, data: { tag: "scheduling" } },
        { id: "n_sync", type: "call_rest_api", x: 960, y: 90, data: { method: "POST", url: "{{ERP_WEBHOOK_URL}}" } },
        { id: "n_confirm_msg", type: "send_text", x: 1180, y: 90, data: { message: "Thank you for confirming! We'll contact you a few days before {delivery_date_1} to confirm the exact time." } },
        { id: "n_collect_reason", type: "collect_input", x: 520, y: 320, data: { message: "No problem! May we know the reason for changing the date?", saveTo: "amend_date_reason" } },
        { id: "n_set_amend", type: "set_attribute", x: 740, y: 320, data: { key: "delivery_message_status_1", value: "Pending Reschedule" } },
        { id: "n_tag_resched", type: "add_tag", x: 960, y: 320, data: { tag: "pending reschedule" } },
        { id: "n_amend_msg", type: "send_text", x: 1180, y: 320, data: { message: "Got it - we'll reschedule and follow up shortly. Thank you, {full_name}." } },
      ],
      edges: [
        { from: "n_trigger", to: "n_ask" },
        { from: "n_ask", to: "n_set_confirm", branch: "confirm" },
        { from: "n_set_confirm", to: "n_tag_sched" },
        { from: "n_tag_sched", to: "n_sync" },
        { from: "n_sync", to: "n_confirm_msg" },
        { from: "n_ask", to: "n_collect_reason", branch: "amend" },
        { from: "n_collect_reason", to: "n_set_amend" },
        { from: "n_set_amend", to: "n_tag_resched" },
        { from: "n_tag_resched", to: "n_amend_msg" },
      ],
    },
  });

  // Driver / TMS automation.
  await db.insert(automation).values({
    companyId: companyRow.id,
    channelId: channelRow.id,
    name: "Driver Dispatch Update",
    description:
      "Driver event -> notify the customer; on delivery confirmation bump TMS status + write back to ERP.",
    triggerType: "DRIVER_EVENT",
    status: "PUBLISHED",
    enabled: true,
    triggerConfig: { source: "driver-app" },
    graph: {
      nodes: [
        { id: "d_trigger", type: "trigger", data: {}, x: 40, y: 220 },
        {
          id: "d_router",
          type: "criteria_router",
          x: 240,
          y: 220,
          data: {
            rules: [
              { branch: "enroute", field: "driver_event", op: "eq", value: "EN_ROUTE" },
              { branch: "arrived", field: "driver_event", op: "eq", value: "ARRIVED" },
              { branch: "delivered", field: "driver_event", op: "eq", value: "DELIVERED" },
            ],
          },
        },
        { id: "d_enroute", type: "send_text", x: 480, y: 40, data: { message: "Your order {ref_1} is on the way! Driver {drivers_name} ({car_plate}), ETA {delivery_time}." } },
        { id: "d_arrived", type: "send_text", x: 480, y: 160, data: { message: "Our driver {drivers_name} has arrived for order {ref_1}. Please be ready to receive it." } },
        {
          id: "d_ask",
          type: "ask_buttons",
          x: 480,
          y: 300,
          data: {
            message: "Has your order {ref_1} been delivered successfully?",
            buttons: [
              { id: "received", label: "Received" },
              { id: "issue", label: "Report an issue" },
            ],
          },
        },
        { id: "d_set_delivered", type: "set_attribute", x: 720, y: 220, data: { key: "tms_status", value: "Delivered" } },
        { id: "d_tms_sync", type: "call_rest_api", x: 940, y: 220, data: { method: "POST", url: "{{TMS_STATUS_WEBHOOK_URL}}" } },
        { id: "d_tag_done", type: "add_tag", x: 1160, y: 220, data: { tag: "delivered" } },
        { id: "d_thanks", type: "send_text", x: 1380, y: 220, data: { message: "Thank you, {full_name}! Your delivery is complete. We hope you love your new furniture." } },
        { id: "d_issue_attr", type: "set_attribute", x: 720, y: 420, data: { key: "delivery_confirmation", value: "Issue reported" } },
        { id: "d_issue_assign", type: "assign", x: 940, y: 420, data: { departmentId: supportDeptId } },
        { id: "d_issue_tag", type: "add_tag", x: 1160, y: 420, data: { tag: "delivery issue" } },
        { id: "d_issue_msg", type: "send_text", x: 1380, y: 420, data: { message: "Sorry to hear that. An agent will assist you with order {ref_1} shortly." } },
      ],
      edges: [
        { from: "d_trigger", to: "d_router" },
        { from: "d_router", to: "d_enroute", branch: "enroute" },
        { from: "d_router", to: "d_arrived", branch: "arrived" },
        { from: "d_router", to: "d_ask", branch: "delivered" },
        { from: "d_ask", to: "d_set_delivered", branch: "received" },
        { from: "d_set_delivered", to: "d_tms_sync" },
        { from: "d_tms_sync", to: "d_tag_done" },
        { from: "d_tag_done", to: "d_thanks" },
        { from: "d_ask", to: "d_issue_attr", branch: "issue" },
        { from: "d_issue_attr", to: "d_issue_assign" },
        { from: "d_issue_assign", to: "d_issue_tag" },
        { from: "d_issue_tag", to: "d_issue_msg" },
      ],
    },
  });

  const counts = {
    members: await db.$count(member),
    departments: await db.$count(department),
    contactFields: await db.$count(contactField),
    contacts: await db.$count(contact),
    conversations: await db.$count(conversation),
    tags: await db.$count(tag),
    automations: await db.$count(automation),
  };
  console.log("Seed complete:", counts);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
