import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  automation as automationTable,
  automationRun,
  contact as contactTable,
  contactTag,
  conversation as conversationTable,
  conversationTag,
  message,
  tag as tagTable,
} from "@/db/schema";
import { asGraph, type FlowGraph, type FlowNode } from "./types";
import { callRestApi } from "./rest";
import { interpolate } from "./vars";
import { attrs } from "@/lib/format";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";
import { generateAgentReply } from "@/lib/ai";

/**
 * Automation runtime. Interprets a FlowGraph node-by-node, performing side
 * effects (send message, set attribute, tag, assign) and pausing on nodes that
 * await customer input (ask_buttons / collect_input) or time (delay). Progress
 * is persisted on AutomationRun so a run can resume on the next event.
 */

const MAX_STEPS = 100; // safety against cycles
const MAX_JUMP_DEPTH = 10; // safety against jump_to_automation chains forming a cycle

function nextNodeId(
  graph: FlowGraph,
  fromId: string,
  branch?: string
): string | undefined {
  const edges = graph.edges.filter((e) => e.from === fromId);
  if (branch) {
    const exact = edges.find((e) => e.branch === branch);
    if (exact) return exact.to;
  }
  const dflt = edges.find((e) => e.branch == null || e.branch === "default");
  return (dflt ?? edges[0])?.to;
}

function findNode(graph: FlowGraph, id: string): FlowNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

async function setContactAttr(contactId: string, key: string, value: string) {
  const db = getDb();
  const c = await db.query.contact.findFirst({
    where: eq(contactTable.id, contactId),
  });
  if (!c) return;
  const merged = { ...attrs(c.attributes), [key]: value };
  await db
    .update(contactTable)
    .set({ attributes: merged })
    .where(eq(contactTable.id, contactId));
}

async function ensureTag(companyId: string, name: string) {
  const db = getDb();
  const [row] = await db
    .insert(tagTable)
    .values({ companyId, name })
    .onConflictDoUpdate({
      target: [tagTable.companyId, tagTable.name],
      set: { name },
    })
    .returning();
  return row;
}

interface RunCtx {
  runId: string;
  automationId: string;
  graph: FlowGraph;
  companyId: string;
  contactId: string;
  conversationId: string;
  contactName: string | null;
  contactPhone: string;
  /** how many jump_to_automation handoffs led here; caps a jump cycle. */
  jumpDepth: number;
}

async function logStep(runId: string, entry: Record<string, unknown>) {
  const db = getDb();
  const run = await db.query.automationRun.findFirst({
    where: eq(automationRun.id, runId),
  });
  const log = Array.isArray(run?.log) ? (run!.log as unknown[]) : [];
  log.push({ ...entry, at: new Date().toISOString() });
  await db
    .update(automationRun)
    .set({ log })
    .where(eq(automationRun.id, runId));
}

/** Execute one node; returns { next } to continue, or { pause } to stop and wait. */
async function execNode(
  node: FlowNode,
  ctx: RunCtx
): Promise<{ next?: string } | { pause: "button" | "text" | "delay"; branch?: never }> {
  const db = getDb();
  const d = node.data ?? {};
  const varCtx = {
    full_name: ctx.contactName,
    phone: ctx.contactPhone,
    attributes: (
      await db.query.contact.findFirst({ where: eq(contactTable.id, ctx.contactId) })
    )?.attributes,
  };

  switch (node.type) {
    case "trigger":
      return { next: nextNodeId(ctx.graph, node.id) };

    case "send_text": {
      await sendOutbound(ctx.conversationId, interpolate(d.message ?? "", varCtx), {
        isBot: true,
      });
      await logStep(ctx.runId, { node: node.id, type: node.type });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "ask_buttons": {
      await sendOutbound(ctx.conversationId, interpolate(d.message ?? "", varCtx), {
        isBot: true,
        buttons: d.buttons ?? [],
      });
      await logStep(ctx.runId, { node: node.id, type: node.type, awaiting: "button" });
      return { pause: "button" };
    }

    case "collect_input": {
      await sendOutbound(ctx.conversationId, interpolate(d.message ?? "", varCtx), {
        isBot: true,
      });
      await logStep(ctx.runId, { node: node.id, type: node.type, awaiting: "text" });
      return { pause: "text" };
    }

    case "ai_agent_reply": {
      const lastIn = await db.query.message.findFirst({
        where: and(
          eq(message.conversationId, ctx.conversationId),
          eq(message.direction, "IN")
        ),
        orderBy: desc(message.createdAt),
      });
      const reply = await generateAgentReply({
        systemPrompt: d.message,
        lastCustomerMessage: lastIn?.body ?? "",
        contactName: ctx.contactName,
        attributes: attrs(varCtx.attributes),
      });
      await sendOutbound(ctx.conversationId, reply, { isBot: true });
      await logStep(ctx.runId, { node: node.id, type: node.type });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "set_attribute": {
      if (d.key) await setContactAttr(ctx.contactId, d.key, interpolate(String(d.value ?? ""), varCtx));
      await logStep(ctx.runId, { node: node.id, type: node.type, key: d.key, value: d.value });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "add_tag": {
      if (d.tag) {
        const tag = await ensureTag(ctx.companyId, d.tag);
        await db
          .insert(contactTag)
          .values({ contactId: ctx.contactId, tagId: tag.id })
          .onConflictDoNothing();
        await db
          .insert(conversationTag)
          .values({ conversationId: ctx.conversationId, tagId: tag.id })
          .onConflictDoNothing();
      }
      await logStep(ctx.runId, { node: node.id, type: node.type, tag: d.tag });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "remove_tag": {
      if (d.tag) {
        const tag = await db.query.tag.findFirst({
          where: and(eq(tagTable.companyId, ctx.companyId), eq(tagTable.name, d.tag)),
        });
        if (tag) {
          await db
            .delete(contactTag)
            .where(and(eq(contactTag.contactId, ctx.contactId), eq(contactTag.tagId, tag.id)));
          await db
            .delete(conversationTag)
            .where(
              and(
                eq(conversationTag.conversationId, ctx.conversationId),
                eq(conversationTag.tagId, tag.id)
              )
            );
        }
      }
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "assign": {
      const set: { assignedAgentId?: string; assignedDepartmentId?: string } = {};
      if (d.memberId != null) set.assignedAgentId = d.memberId;
      if (d.departmentId != null) set.assignedDepartmentId = d.departmentId;
      if (Object.keys(set).length) {
        await db
          .update(conversationTable)
          .set(set)
          .where(eq(conversationTable.id, ctx.conversationId));
      }
      await logStep(ctx.runId, { node: node.id, type: node.type });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "set_status": {
      const status = (d.status ?? "OPEN").toUpperCase();
      if (["OPEN", "CLOSED", "QUEUE", "PENDING"].includes(status)) {
        await db
          .update(conversationTable)
          .set({ status: status as "OPEN" | "CLOSED" | "QUEUE" | "PENDING" })
          .where(eq(conversationTable.id, ctx.conversationId));
      }
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "criteria_router": {
      const values = attrs(varCtx.attributes);
      const lookup: Record<string, string> = {
        ...values,
        full_name: ctx.contactName ?? "",
        phone: ctx.contactPhone,
      };
      for (const rule of d.rules ?? []) {
        const v = lookup[rule.field];
        const has = v != null && v !== "";
        let match = false;
        if (rule.op === "set") match = has;
        else if (rule.op === "unset") match = !has;
        else if (rule.op === "eq") match = has && v === rule.value;
        else if (rule.op === "neq") match = v !== rule.value;
        else if (rule.op === "contains") match = has && v.includes(rule.value ?? "");
        if (match) {
          await logStep(ctx.runId, { node: node.id, type: node.type, matched: rule.branch });
          return { next: nextNodeId(ctx.graph, node.id, rule.branch) };
        }
      }
      return { next: nextNodeId(ctx.graph, node.id, "default") };
    }

    case "call_rest_api": {
      // Real outbound HTTP (see lib/automation/rest.ts). callRestApi never
      // throws: a dead endpoint is logged and the flow carries on, because the
      // customer conversation must survive a failed ERP/Sheet write.
      const res = await callRestApi(d, varCtx);
      await logStep(ctx.runId, {
        node: node.id,
        type: node.type,
        method: res.method,
        url: res.url,
        ok: res.ok,
        status: res.status,
        response: res.snippet,
        ...(res.error ? { error: res.error } : {}),
      });
      // Only a successful call may overwrite an attribute — persisting an error
      // page would poison later criteria_router branches on that key.
      if (res.ok && d.saveResponseTo) {
        await setContactAttr(ctx.contactId, String(d.saveResponseTo), res.text);
      }
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "opt_in":
    case "opt_out": {
      await db
        .update(contactTable)
        .set({ marketingOptIn: node.type === "opt_in" })
        .where(eq(contactTable.id, ctx.contactId));
      await logStep(ctx.runId, { node: node.id, type: node.type });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "add_to_drip":
    case "remove_from_drip": {
      // STUB: record intent onto the contact so a flow can branch on it; a real
      // drip enrolment engine is future work.
      if (d.campaignName) {
        await setContactAttr(
          ctx.contactId,
          "drip_campaign",
          node.type === "add_to_drip" ? String(d.campaignName) : ""
        );
      }
      await logStep(ctx.runId, {
        node: node.id,
        type: node.type,
        campaign: d.campaignName,
        stub: true,
      });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "jump_to_automation": {
      // Hand the contact to the target automation (a fresh run from its trigger),
      // then END this run — the target takes over. A missing target, a self-jump,
      // or exceeding the depth cap is a no-op that just continues, so a mis-built
      // flow neither dead-ends nor loops forever.
      const target = typeof d.targetAutomationId === "string" ? d.targetAutomationId : "";
      const canJump = target !== "" && target !== ctx.automationId && ctx.jumpDepth < MAX_JUMP_DEPTH;
      await logStep(ctx.runId, { node: node.id, type: node.type, target, jumped: canJump });
      if (canJump) {
        await startRun(target, ctx.contactId, undefined, ctx.jumpDepth + 1);
        return { next: undefined };
      }
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "google_sheets":
    case "eval": {
      // STUB: config is captured + persisted in the graph and the run continues,
      // but the side effect is not executed yet. Kept as a pass-through so a flow
      // built around it does not dead-end.
      await logStep(ctx.runId, { node: node.id, type: node.type, stub: true });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "delay":
      await logStep(ctx.runId, { node: node.id, type: node.type, unit: d.unit, amount: d.amount });
      return { pause: "delay" };

    case "end":
    default:
      return { next: undefined };
  }
}

async function advance(ctx: RunCtx, startNodeId: string | undefined) {
  const db = getDb();
  let nodeId = startNodeId;
  let steps = 0;
  while (nodeId && steps++ < MAX_STEPS) {
    const node = findNode(ctx.graph, nodeId);
    if (!node) break;
    const res = await execNode(node, ctx);
    if ("pause" in res) {
      await db
        .update(automationRun)
        .set({
          status: "waiting",
          cursorNodeId: node.id,
          context: {
            conversationId: ctx.conversationId,
            waitingFor: res.pause,
            saveTo: node.data?.saveTo ?? null,
          },
        })
        .where(eq(automationRun.id, ctx.runId));
      return;
    }
    nodeId = res.next;
  }
  await db
    .update(automationRun)
    .set({ status: "completed", cursorNodeId: null })
    .where(eq(automationRun.id, ctx.runId));
}

async function buildCtx(runId: string, jumpDepth = 0): Promise<RunCtx | null> {
  const db = getDb();
  const run = await db.query.automationRun.findFirst({
    where: eq(automationRun.id, runId),
  });
  if (!run) return null;
  const automation = await db.query.automation.findFirst({
    where: eq(automationTable.id, run.automationId),
  });
  if (!automation || !run.contactId) return null;
  const contact = await db.query.contact.findFirst({
    where: eq(contactTable.id, run.contactId),
  });
  if (!contact) return null;
  const convo = await getOrCreateConversation(automation.channelId, contact.id);
  return {
    runId,
    automationId: automation.id,
    graph: asGraph(automation.graph),
    companyId: automation.companyId,
    contactId: contact.id,
    conversationId: convo.id,
    contactName: contact.name,
    contactPhone: contact.phone,
    jumpDepth,
  };
}

/**
 * Choose which trigger node to start from. A flow can have several trigger nodes
 * (Seampify packs multiple entry points — e.g. one per "Action Callback Id" — into
 * a single automation). When an entry hint is given, start from the trigger whose
 * configured callbackId / keywords matches it, so the correct branch runs; else the
 * first trigger.
 */
function pickEntryTrigger(
  graph: FlowGraph,
  entry?: { callbackId?: string; tag?: string }
): FlowNode | undefined {
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  const key = entry?.callbackId ?? entry?.tag;
  if (key != null && key !== "") {
    const matched = triggers.find((t) => {
      const d = t.data ?? {};
      if (d.callbackId && d.callbackId === key) return true;
      return Array.isArray(d.keywords) && (d.keywords as string[]).includes(key);
    });
    if (matched) return matched;
  }
  return triggers[0] ?? graph.nodes[0];
}

/** Start a fresh run of an automation for a contact (from a trigger). */
export async function startRun(
  automationId: string,
  contactId: string,
  entry?: { callbackId?: string; tag?: string },
  jumpDepth = 0
) {
  const db = getDb();
  const automation = await db.query.automation.findFirst({
    where: eq(automationTable.id, automationId),
  });
  if (!automation) return null;
  const graph = asGraph(automation.graph);
  const trigger = pickEntryTrigger(graph, entry);
  if (!trigger) return null;

  const [run] = await db
    .insert(automationRun)
    .values({ automationId, contactId, status: "running", log: [] })
    .returning();
  const ctx = await buildCtx(run.id, jumpDepth);
  if (!ctx) return run;
  await advance(ctx, trigger.id);
  return run;
}

/** Resume a waiting run with the customer's reply (button id or free text). */
/**
 * Feed a customer reply into one waiting run.
 *
 * Returns whether the run actually MOVED. That return value is load-bearing:
 * callers use it to decide whether the reply has been dealt with, and a run can
 * be `waiting` for something this reply cannot satisfy — most importantly
 * `waitingFor: "delay"`, which neither branch below matches and which nothing in
 * the app ever resumes. Reporting those as handled is what silently muted the
 * contact (see handleCustomerReply).
 */
export async function resumeRun(
  runId: string,
  input: { buttonId?: string; text?: string }
): Promise<boolean> {
  const db = getDb();
  const run = await db.query.automationRun.findFirst({
    where: eq(automationRun.id, runId),
  });
  if (!run || run.status !== "waiting" || !run.cursorNodeId) return false;
  const ctx = await buildCtx(runId);
  if (!ctx) return false;

  const context = (run.context as { waitingFor?: string; saveTo?: string } | null) ?? {};
  const cursor = run.cursorNodeId;

  if (context.waitingFor === "button" && input.buttonId != null) {
    await advance(ctx, nextNodeId(ctx.graph, cursor, input.buttonId));
    return true;
  }
  if (context.waitingFor === "text" && input.text != null) {
    if (context.saveTo) await setContactAttr(ctx.contactId, context.saveTo, input.text);
    await advance(ctx, nextNodeId(ctx.graph, cursor));
    return true;
  }
  return false;
}
