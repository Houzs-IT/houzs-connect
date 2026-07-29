import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { asGraph, type FlowGraph, type FlowNode } from "./types";
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
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c) return;
  const merged = { ...attrs(c.attributes), [key]: value };
  await db.contact.update({
    where: { id: contactId },
    data: { attributes: merged },
  });
}

async function ensureTag(companyId: string, name: string) {
  return db.tag.upsert({
    where: { companyId_name: { companyId, name } },
    update: {},
    create: { companyId, name },
  });
}

interface RunCtx {
  runId: string;
  graph: FlowGraph;
  companyId: string;
  contactId: string;
  conversationId: string;
  contactName: string | null;
  contactPhone: string;
}

async function logStep(runId: string, entry: Record<string, unknown>) {
  const run = await db.automationRun.findUnique({ where: { id: runId } });
  const log = Array.isArray(run?.log) ? (run!.log as unknown[]) : [];
  log.push({ ...entry, at: new Date().toISOString() });
  await db.automationRun.update({
    where: { id: runId },
    data: { log: log as Prisma.InputJsonValue },
  });
}

/** Execute one node; returns { next } to continue, or { pause } to stop and wait. */
async function execNode(
  node: FlowNode,
  ctx: RunCtx
): Promise<{ next?: string } | { pause: "button" | "text" | "delay"; branch?: never }> {
  const d = node.data ?? {};
  const varCtx = {
    full_name: ctx.contactName,
    phone: ctx.contactPhone,
    attributes: (await db.contact.findUnique({ where: { id: ctx.contactId } }))
      ?.attributes,
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
      const lastIn = await db.message.findFirst({
        where: { conversationId: ctx.conversationId, direction: "IN" },
        orderBy: { createdAt: "desc" },
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
        await db.contactTag.upsert({
          where: { contactId_tagId: { contactId: ctx.contactId, tagId: tag.id } },
          update: {},
          create: { contactId: ctx.contactId, tagId: tag.id },
        });
        await db.conversationTag.upsert({
          where: { conversationId_tagId: { conversationId: ctx.conversationId, tagId: tag.id } },
          update: {},
          create: { conversationId: ctx.conversationId, tagId: tag.id },
        });
      }
      await logStep(ctx.runId, { node: node.id, type: node.type, tag: d.tag });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "remove_tag": {
      if (d.tag) {
        const tag = await db.tag.findUnique({
          where: { companyId_name: { companyId: ctx.companyId, name: d.tag } },
        });
        if (tag) {
          await db.contactTag.deleteMany({ where: { contactId: ctx.contactId, tagId: tag.id } });
          await db.conversationTag.deleteMany({ where: { conversationId: ctx.conversationId, tagId: tag.id } });
        }
      }
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "assign": {
      await db.conversation.update({
        where: { id: ctx.conversationId },
        data: {
          assignedAgentId: d.memberId ?? undefined,
          assignedDepartmentId: d.departmentId ?? undefined,
        },
      });
      await logStep(ctx.runId, { node: node.id, type: node.type });
      return { next: nextNodeId(ctx.graph, node.id) };
    }

    case "set_status": {
      const status = (d.status ?? "OPEN").toUpperCase();
      if (["OPEN", "CLOSED", "QUEUE", "PENDING"].includes(status)) {
        await db.conversation.update({
          where: { id: ctx.conversationId },
          data: { status: status as "OPEN" | "CLOSED" | "QUEUE" | "PENDING" },
        });
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
      // DEMO: record intent, don't call out. LIVE: fetch(d.url, ...).
      await logStep(ctx.runId, {
        node: node.id,
        type: node.type,
        method: d.method ?? "POST",
        url: d.url,
        demo: true,
      });
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
  let nodeId = startNodeId;
  let steps = 0;
  while (nodeId && steps++ < MAX_STEPS) {
    const node = findNode(ctx.graph, nodeId);
    if (!node) break;
    const res = await execNode(node, ctx);
    if ("pause" in res) {
      await db.automationRun.update({
        where: { id: ctx.runId },
        data: {
          status: "waiting",
          cursorNodeId: node.id,
          context: {
            conversationId: ctx.conversationId,
            waitingFor: res.pause,
            saveTo: node.data?.saveTo ?? null,
          },
        },
      });
      return;
    }
    nodeId = res.next;
  }
  await db.automationRun.update({
    where: { id: ctx.runId },
    data: { status: "completed", cursorNodeId: null },
  });
}

async function buildCtx(runId: string): Promise<RunCtx | null> {
  const run = await db.automationRun.findUnique({ where: { id: runId } });
  if (!run) return null;
  const automation = await db.automation.findUnique({ where: { id: run.automationId } });
  if (!automation || !run.contactId) return null;
  const contact = await db.contact.findUnique({ where: { id: run.contactId } });
  if (!contact) return null;
  const conversation = await getOrCreateConversation(automation.channelId, contact.id);
  return {
    runId,
    graph: asGraph(automation.graph),
    companyId: automation.companyId,
    contactId: contact.id,
    conversationId: conversation.id,
    contactName: contact.name,
    contactPhone: contact.phone,
  };
}

/** Start a fresh run of an automation for a contact (from a trigger). */
export async function startRun(automationId: string, contactId: string) {
  const automation = await db.automation.findUnique({ where: { id: automationId } });
  if (!automation) return null;
  const graph = asGraph(automation.graph);
  const trigger = graph.nodes.find((n) => n.type === "trigger") ?? graph.nodes[0];
  if (!trigger) return null;

  const run = await db.automationRun.create({
    data: { automationId, contactId, status: "running", log: [] },
  });
  const ctx = await buildCtx(run.id);
  if (!ctx) return run;
  await advance(ctx, trigger.id);
  return run;
}

/** Resume a waiting run with the customer's reply (button id or free text). */
export async function resumeRun(runId: string, input: { buttonId?: string; text?: string }) {
  const run = await db.automationRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "waiting" || !run.cursorNodeId) return;
  const ctx = await buildCtx(runId);
  if (!ctx) return;

  const context = (run.context as { waitingFor?: string; saveTo?: string } | null) ?? {};
  const cursor = run.cursorNodeId;

  if (context.waitingFor === "button" && input.buttonId != null) {
    await advance(ctx, nextNodeId(ctx.graph, cursor, input.buttonId));
  } else if (context.waitingFor === "text" && input.text != null) {
    if (context.saveTo) await setContactAttr(ctx.contactId, context.saveTo, input.text);
    await advance(ctx, nextNodeId(ctx.graph, cursor));
  }
}
