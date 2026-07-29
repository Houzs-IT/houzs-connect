// AI agent reply. In DEMO this is a lightweight rule-based responder so flows can be
// tested without an LLM key; in LIVE, swap generateAgentReply for a call to an LLM
// (Claude / GPT) with the system prompt + conversation history. The interface stays
// the same so the automation node does not change.

export interface AgentContext {
  systemPrompt?: string;
  lastCustomerMessage: string;
  contactName?: string | null;
  attributes?: Record<string, string>;
}

/** Produce an agent reply for the customer's last message. */
export async function generateAgentReply(ctx: AgentContext): Promise<string> {
  const msg = (ctx.lastCustomerMessage ?? "").toLowerCase();
  const name = ctx.contactName ?? "there";
  const a = ctx.attributes ?? {};

  // Intent heuristics (DEMO). A real LLM handles open-ended language.
  if (/price|cost|how much|quote/.test(msg))
    return `Hi ${name}, happy to help with pricing. Could you tell me which item and quantity you're looking at?`;
  if (/deliver|delivery|when|arrive|eta/.test(msg))
    return a.delivery_date_1
      ? `Hi ${name}, your order ${a.ref_1 ?? ""} is scheduled for ${a.delivery_date_1}. We'll confirm the exact time a day before.`
      : `Hi ${name}, let me check the delivery schedule for you and get right back.`;
  if (/refund|cancel|return/.test(msg))
    return `I understand, ${name}. I've flagged this to our team and an agent will assist you shortly.`;
  if (/pay|payment|bank|transfer|slip/.test(msg))
    return `You can transfer to Maybank 5644 1861 0346 (Houzs Century Sdn Bhd) and send the slip here — we'll verify it right away.`;
  if (/hi|hello|hey/.test(msg))
    return `Hi ${name}! Thanks for reaching out to Houzs Century. How can we help today?`;
  return `Thanks ${name}, noted. An agent will follow up shortly to make sure this is handled.`;
}
