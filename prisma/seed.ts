import { PrismaClient } from "@prisma/client";
import {
  CONTACT_FIELDS,
  MEMBERS,
  DEPARTMENTS,
  TAGS,
  QUICK_REPLIES,
} from "./seed-data";

const db = new PrismaClient();

async function main() {
  console.log("Seeding Houzs Connect demo data…");

  // Wipe (dev only) in FK-safe order.
  await db.message.deleteMany();
  await db.note.deleteMany();
  await db.conversationTag.deleteMany();
  await db.contactTag.deleteMany();
  await db.payment.deleteMany();
  await db.driverEvent.deleteMany();
  await db.conversation.deleteMany();
  await db.contact.deleteMany();
  await db.contactField.deleteMany();
  await db.automationRun.deleteMany();
  await db.automation.deleteMany();
  await db.campaign.deleteMany();
  await db.quickReply.deleteMany();
  await db.tag.deleteMany();
  await db.teamMember.deleteMany();
  await db.team.deleteMany();
  await db.channel.deleteMany();
  await db.member.deleteMany();
  await db.department.deleteMany();
  await db.company.deleteMany();

  const company = await db.company.create({
    data: { name: "Houzs Century Sdn Bhd", slug: "houzs-century" },
  });

  // Departments
  const deptByName = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    const d = await db.department.create({
      data: { companyId: company.id, name },
    });
    deptByName.set(name, d.id);
  }

  // Members (two passes so managers exist before reports link to them)
  const memberByKey = new Map<string, string>();
  for (const m of MEMBERS) {
    const created = await db.member.create({
      data: {
        companyId: company.id,
        name: m.name,
        email: m.email,
        role: m.role,
        title: m.title,
        departmentId: deptByName.get(m.department) ?? null,
      },
    });
    memberByKey.set(m.key, created.id);
  }
  for (const m of MEMBERS) {
    if (m.manager) {
      await db.member.update({
        where: { id: memberByKey.get(m.key)! },
        data: { managerId: memberByKey.get(m.manager)! },
      });
    }
  }

  // Channel (demo WhatsApp number)
  const channel = await db.channel.create({
    data: {
      companyId: company.id,
      displayName: "Houzs Century Sdn Bhd",
      phone: "601161556133",
      mode: "DEMO",
      isDefault: true,
    },
  });

  // Contact fields (63)
  for (const f of CONTACT_FIELDS) {
    await db.contactField.create({
      data: { companyId: company.id, key: f.key, name: f.name, type: f.type },
    });
  }

  // Tags
  const tagByName = new Map<string, string>();
  for (const t of TAGS) {
    const tag = await db.tag.create({
      data: { companyId: company.id, name: t.name, color: t.color },
    });
    tagByName.set(t.name, tag.id);
  }

  // Quick replies
  for (const q of QUICK_REPLIES) {
    await db.quickReply.create({
      data: { companyId: company.id, shortcut: q.shortcut, body: q.body },
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
    const contact = await db.contact.create({
      data: {
        companyId: company.id,
        name: c.name,
        phone: c.phone,
        attributes: c.attrs,
      },
    });
    for (const tname of c.tags) {
      await db.contactTag.create({
        data: { contactId: contact.id, tagId: tagByName.get(tname)! },
      });
    }
    const convo = await db.conversation.create({
      data: {
        channelId: channel.id,
        contactId: contact.id,
        status: "OPEN",
        assignedAgentId: memberByKey.get(c.agent) ?? null,
        assignedDepartmentId: deptByName.get("Support") ?? null,
        lastMessageAt: new Date(),
        unreadCount: 1,
      },
    });
    await db.message.createMany({
      data: [
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
      ],
    });
    for (const tname of c.tags) {
      await db.conversationTag.create({
        data: { conversationId: convo.id, tagId: tagByName.get(tname)! },
      });
    }
  }

  // Sample automation: delivery follow-up. Fired by an ERP webhook; sends the first
  // interactive message, then branches on the customer's button tap (confirm / amend).
  await db.automation.create({
    data: {
      companyId: company.id,
      channelId: channel.id,
      name: "New Delivery Follow-up",
      description:
        "ERP order-ready → ask the customer to confirm the delivery date; confirm syncs to ERP + tags, amend collects a reason.",
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
                "Hi {full_name}! 👋 Your order {ref_1} is ready. Is {delivery_date_1} a good delivery date?",
              buttons: [
                { id: "confirm", label: "Confirm Date" },
                { id: "amend", label: "Change Date" },
              ],
            },
          },
          // confirm branch
          { id: "n_set_confirm", type: "set_attribute", x: 520, y: 90, data: { key: "delivery_message_status_1", value: "Done Scheduling" } },
          { id: "n_tag_sched", type: "add_tag", x: 740, y: 90, data: { tag: "scheduling" } },
          { id: "n_sync", type: "call_rest_api", x: 960, y: 90, data: { method: "POST", url: "{{ERP_WEBHOOK_URL}}" } },
          { id: "n_confirm_msg", type: "send_text", x: 1180, y: 90, data: { message: "Thank you for confirming! ✅ We'll contact you a few days before {delivery_date_1} to confirm the exact time." } },
          // amend branch
          { id: "n_collect_reason", type: "collect_input", x: 520, y: 320, data: { message: "No problem! 🙏 May we know the reason for changing the date?", saveTo: "amend_date_reason" } },
          { id: "n_set_amend", type: "set_attribute", x: 740, y: 320, data: { key: "delivery_message_status_1", value: "Pending Reschedule" } },
          { id: "n_tag_resched", type: "add_tag", x: 960, y: 320, data: { tag: "pending reschedule" } },
          { id: "n_amend_msg", type: "send_text", x: 1180, y: 320, data: { message: "Got it — we'll reschedule and follow up shortly. Thank you, {full_name}." } },
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
    },
  });

  // Driver / TMS automation: fired when a driver marks en-route / arrived / delivered.
  // Branches on driver_event; on DELIVERED it asks the customer to confirm, then bumps
  // the TMS status and writes it back to the ERP/TMS.
  const supportDeptId = deptByName.get("Support") ?? null;
  await db.automation.create({
    data: {
      companyId: company.id,
      channelId: channel.id,
      name: "Driver Dispatch Update",
      description:
        "Driver event → notify the customer; on delivery confirmation bump TMS status + write back to ERP.",
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
          { id: "d_enroute", type: "send_text", x: 480, y: 40, data: { message: "🚚 Your order {ref_1} is on the way! Driver {drivers_name} ({car_plate}), ETA {delivery_time}." } },
          { id: "d_arrived", type: "send_text", x: 480, y: 160, data: { message: "📍 Our driver {drivers_name} has arrived for order {ref_1}. Please be ready to receive it." } },
          {
            id: "d_ask",
            type: "ask_buttons",
            x: 480,
            y: 300,
            data: {
              message: "Has your order {ref_1} been delivered successfully?",
              buttons: [
                { id: "received", label: "Received ✅" },
                { id: "issue", label: "Report an issue" },
              ],
            },
          },
          // received branch → TMS jumps to Delivered
          { id: "d_set_delivered", type: "set_attribute", x: 720, y: 220, data: { key: "tms_status", value: "Delivered" } },
          { id: "d_tms_sync", type: "call_rest_api", x: 940, y: 220, data: { method: "POST", url: "{{TMS_STATUS_WEBHOOK_URL}}" } },
          { id: "d_tag_done", type: "add_tag", x: 1160, y: 220, data: { tag: "delivered" } },
          { id: "d_thanks", type: "send_text", x: 1380, y: 220, data: { message: "Thank you, {full_name}! Your delivery is complete. 🎉 We hope you love your new furniture." } },
          // issue branch → assign to Support
          { id: "d_issue_attr", type: "set_attribute", x: 720, y: 420, data: { key: "delivery_confirmation", value: "Issue reported" } },
          { id: "d_issue_assign", type: "assign", x: 940, y: 420, data: { departmentId: supportDeptId } },
          { id: "d_issue_tag", type: "add_tag", x: 1160, y: 420, data: { tag: "delivery issue" } },
          { id: "d_issue_msg", type: "send_text", x: 1380, y: 420, data: { message: "Sorry to hear that 🙏 An agent will assist you with order {ref_1} shortly." } },
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
    },
  });

  const counts = {
    members: await db.member.count(),
    departments: await db.department.count(),
    contactFields: await db.contactField.count(),
    contacts: await db.contact.count(),
    conversations: await db.conversation.count(),
    tags: await db.tag.count(),
    automations: await db.automation.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
