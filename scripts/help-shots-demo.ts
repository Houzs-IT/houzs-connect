// Demo data for the show_me screenshots (AI Connector round 5). Run only by
// scripts/capture-help-shots.mjs against the throwaway local Postgres it starts
// — it refuses any non-localhost DATABASE_URL. Every name, phone, email and
// message below is invented ("(demo)", 60100000xxx, example.com): no real
// customer, staff member or message ever reaches a screenshot.
//   DATABASE_URL=postgres://postgres@localhost:<port>/postgres?sslmode=disable tsx scripts/help-shots-demo.ts
import { sql as dsql } from "drizzle-orm";
import { scriptDb } from "./_env";
import { ensureMcpTables } from "../src/db/ensure-mcp";
import { channel, company, contact, contactTag, conversation, conversationTag, department, member, message, note, quickReply, tag } from "../src/db/schema";

const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error("help-shots-demo: refusing — DATABASE_URL must be a localhost database.");
  process.exit(1);
}

const H = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms);

async function main() {
  const { db, sql } = scriptDb();
  const [co] = await db.insert(company).values({ name: "Houzs Century", slug: "houzs-century-demo" }).returning();
  const dept = new Map<string, string>();
  for (const name of ["Support", "Delivery", "Sales"]) {
    const [d] = await db.insert(department).values({ companyId: co.id, name }).returning();
    dept.set(name, d.id);
  }
  const people = [
    { key: "admin", name: "Demo Admin", role: "SUPER_ADMIN", dept: "Support" },
    { key: "mgr", name: "Mei (demo)", role: "MANAGER", dept: "Support" },
    { key: "a1", name: "Nurul (demo)", role: "AGENT", dept: "Support" },
    { key: "a2", name: "Ravi (demo)", role: "AGENT", dept: "Delivery" },
    { key: "s1", name: "Lim (demo)", role: "SALES", dept: "Sales" },
  ] as const;
  const mem = new Map<string, string>();
  for (const p of people) {
    const [m] = await db
      .insert(member)
      .values({ companyId: co.id, name: p.name, email: `demo-${p.key}@example.com`, role: p.role as typeof member.$inferInsert["role"], departmentId: dept.get(p.dept) ?? null })
      .returning();
    mem.set(p.key, m.id);
  }
  const [ch] = await db.insert(channel).values({ companyId: co.id, displayName: "Houzs Century (demo)", phone: "60100000000", mode: "DEMO", isDefault: true }).returning();
  const tags = new Map<string, string>();
  for (const [name, color] of [["VIP", "#7c3aed"], ["Delivery", "#0ea5e9"], ["Balance due", "#f59e0b"]] as const) {
    const [t] = await db.insert(tag).values({ companyId: co.id, name, color }).returning();
    tags.set(name, t.id);
  }
  for (const [shortcut, body] of [
    ["hours", "Our showroom is open 10am–7pm daily (demo)."],
    ["thanks", "Thank you! Let us know if there is anything else."],
  ]) await db.insert(quickReply).values({ companyId: co.id, shortcut, body });

  const chats = [
    { name: "Aisha (demo)", phone: "60100000101", agent: "a1", d: "Support", status: "OPEN", window: 20 * H, wait: 45 * 60_000, tags: ["VIP"], remarks: "Prefers WhatsApp to calls. Condo — lift booking needed (demo).",
      msgs: [["IN", "Hi, is my sofa delivery confirmed for Friday?"], ["OUT", "Hi Aisha, let me check with the delivery team."], ["IN", "Thanks, please let me know today."]] },
    { name: "Ben (demo)", phone: "60100000102", agent: null, d: "Support", status: "OPEN", window: 22 * H, wait: 50 * 60_000, tags: [], remarks: "",
      msgs: [["IN", "Hello, do you have the 3-seater in grey?"]] },
    { name: "Chong (demo)", phone: "60100000103", agent: "a2", d: "Delivery", status: "PENDING", window: null, wait: 0, tags: ["Delivery"], remarks: "",
      msgs: [["IN", "Can I change the delivery date?"], ["OUT", "Sure — would 12 Dec or 14 Dec suit you?"]] },
    { name: "Devi (demo)", phone: "60100000104", agent: "a1", d: "Support", status: "QUEUE", window: 5 * H, wait: 10 * 60_000, tags: ["Balance due"], remarks: "",
      msgs: [["IN", "I have sent the balance payment slip."]] },
    { name: "Eric (demo)", phone: "60100000105", agent: "s1", d: "Sales", status: "CLOSED", window: null, wait: 0, tags: [], remarks: "",
      msgs: [["IN", "Thanks for the quotation!"], ["OUT", "You're welcome, Eric."]] },
  ] as const;
  for (const c of chats) {
    const [ct] = await db
      .insert(contact)
      .values({ companyId: co.id, name: c.name, phone: c.phone, source: "manual", attributes: { ref_1: `SO-DEMO-${c.phone.slice(-3)}`, ...(c.remarks ? { remarks: c.remarks } : {}) } })
      .returning();
    const [cv] = await db
      .insert(conversation)
      .values({
        channelId: ch.id,
        contactId: ct.id,
        status: c.status,
        assignedAgentId: c.agent ? (mem.get(c.agent) ?? null) : null,
        assignedDepartmentId: dept.get(c.d) ?? null,
        lastMessageAt: ago(c.wait || 2 * H),
        windowExpiresAt: c.window ? new Date(Date.now() + c.window) : null,
        unreadCount: c.wait ? 1 : 0,
      })
      .returning();
    let i = c.msgs.length;
    for (const [direction, body] of c.msgs) {
      const at = ago((c.wait || 2 * H) + --i * 5 * 60_000);
      await db.insert(message).values({ conversationId: cv.id, direction, type: "TEXT", body, status: direction === "IN" ? "READ" : "DELIVERED", sentByMemberId: direction === "OUT" ? (c.agent ? mem.get(c.agent) : null) : null, createdAt: at });
    }
    for (const t of c.tags) {
      await db.insert(contactTag).values({ contactId: ct.id, tagId: tags.get(t)! });
      await db.insert(conversationTag).values({ conversationId: cv.id, tagId: tags.get(t)! });
    }
    if (c.name.startsWith("Aisha")) await db.insert(note).values({ conversationId: cv.id, memberId: mem.get("mgr")!, body: "Delivery team confirms Friday 10am–1pm (demo)." });
  }

  // The AI Connector page: one approved person and two questions on the gap log.
  await ensureMcpTables(db);
  await db.execute(dsql`insert into connect.mcp_access (email, approved_by_member_id) values ('demo-mgr@example.com', ${mem.get("admin")!}) on conflict do nothing`).catch(() => {});
  for (const q of ["how do I export a contact list to pdf", "change the showroom opening hours"]) {
    await db
      .execute(dsql`insert into connect.mcp_calls (id, member_id, email, company_id, client_id, tool, target, status, ok, note, ms) values (${`demo_gap_${q.length}`}, ${mem.get("a1")!}, 'demo-a1@example.com', ${co.id}, 'demo', 'how_to', ${q}, 200, true, 'no-guide', 3)`)
      .catch((e) => console.warn("help-shots-demo: gap-log row skipped:", e instanceof Error ? e.message : e));
  }
  console.log(JSON.stringify({ companyId: co.id, adminId: mem.get("admin"), conversationIds: "seeded" }));
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
