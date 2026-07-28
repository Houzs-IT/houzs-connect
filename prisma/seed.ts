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

  // A sample automation (delivery follow-up) — graph is a trimmed version of the real flow.
  await db.automation.create({
    data: {
      companyId: company.id,
      channelId: channel.id,
      name: "New Delivery Follow-up",
      description: "Ask the customer for a delivery date, collect details, sync to ERP.",
      triggerType: "WEBHOOK",
      status: "PUBLISHED",
      enabled: true,
      triggerConfig: { source: "erp", event: "order_ready" },
      graph: {
        nodes: [
          { id: "trigger", type: "trigger", data: { event: "WEBHOOK" } },
          { id: "ask_date", type: "ask_buttons", data: { message: "Please choose your delivery date.", buttons: ["Confirm Date", "Change Date"] } },
          { id: "set_status", type: "set_attribute", data: { key: "delivery_message_status_1", value: "Done Scheduling" } },
          { id: "sync_erp", type: "call_rest_api", data: { method: "POST", url: "{{ERP_WEBHOOK_URL}}" } },
          { id: "tag", type: "add_tag", data: { tag: "scheduling" } },
        ],
        edges: [
          { from: "trigger", to: "ask_date" },
          { from: "ask_date", to: "set_status" },
          { from: "set_status", to: "sync_erp" },
          { from: "sync_erp", to: "tag" },
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
