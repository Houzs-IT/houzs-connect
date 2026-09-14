// Turn a raw webhook payload into a sentence an operator can read.
//
// The log page dumped the whole JSON body, which is unreadable to anyone who is
// not debugging the integration — and the people who live in this screen are
// customer service, not engineers. The raw payload is still available behind a
// disclosure, because when something IS being debugged it is the only thing
// that helps.

export interface WebhookSummary {
  /** One sentence: who did what. */
  headline: string;
  /** Short supporting facts, shown as chips. */
  details: string[];
  /** Plain-language version of what we did with it. */
  outcome: string;
  /** Whether the outcome is good, worth noticing, or bad. */
  tone: "ok" | "warn" | "bad";
}

interface WaMessage {
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { filename?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
}

interface WaValue {
  contacts?: { profile?: { name?: string; username?: string }; wa_id?: string; user_id?: string }[];
  messages?: WaMessage[];
  statuses?: { status?: string; recipient_id?: string }[];
  metadata?: { display_phone_number?: string };
}

function describeMessage(m: WaMessage): string {
  if (m.text?.body) return `“${m.text.body.slice(0, 120)}”`;
  const tapped = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
  if (tapped) return `tapped “${tapped}”`;
  if (m.type === "image") return m.image?.caption ? `sent an image — “${m.image.caption}”` : "sent an image";
  if (m.type === "document") return `sent a file${m.document?.filename ? ` (${m.document.filename})` : ""}`;
  if (m.type === "audio") return "sent a voice note";
  if (m.type === "video") return "sent a video";
  return `sent a ${m.type ?? "message"}`;
}

/** What our handler recorded it did — stored in eventType. */
function describeOutcome(eventType: string | null, processed: boolean): Pick<WebhookSummary, "outcome" | "tone"> {
  // The signature verdict rides after "|sig:"; the outcome is what comes before.
  const t = (eventType ?? "").split("|sig:")[0];
  if (t.startsWith("rejected:signature-")) {
    return {
      outcome: "Refused — it did not carry Meta's signature, so it was not from WhatsApp. Nothing was saved.",
      tone: "bad",
    };
  }
  if (t.startsWith("handled:")) {
    const n = t.match(/handled:(\d+)/)?.[1];
    if (t.includes("status-only")) {
      return { outcome: "Delivery status updated.", tone: "ok" };
    }
    return {
      outcome: n ? `Saved to the inbox (${n} message${n === "1" ? "" : "s"}).` : "Saved to the inbox.",
      tone: "ok",
    };
  }
  if (t.startsWith("dropped:number-not-assigned")) {
    return {
      outcome:
        "Not filed — the WhatsApp number this was sent to is not assigned to a company yet. Assign it on Settings → Phone numbers; the message itself is kept here.",
      tone: "bad",
    };
  }
  if (t === "failed:routing-table-unreadable") {
    return {
      outcome: "Not filed — we could not read which company owns the number, so WhatsApp was asked to send it again.",
      tone: "bad",
    };
  }
  if (t.startsWith("numbers:")) {
    const ok = t.endsWith(":ok");
    return {
      outcome: ok ? "Meta accepted it." : "Meta refused it — the reason is below.",
      tone: ok ? "ok" : "bad",
    };
  }
  if (t === "dropped:no-channel-for-company") {
    return {
      outcome: "Discarded — this company has no WhatsApp channel set up, so there was nowhere to file it.",
      tone: "bad",
    };
  }
  if (t === "dropped:no-company") {
    return { outcome: "Discarded — no company is configured.", tone: "bad" };
  }
  if (t === "ignored:no-entry") {
    return { outcome: "Ignored — the delivery carried nothing we act on.", tone: "warn" };
  }
  if (!processed) {
    return {
      outcome: "Received but not finished — the handler stopped before it could file this.",
      tone: "bad",
    };
  }
  return { outcome: "Processed.", tone: "ok" };
}

export function summarise(
  source: string,
  eventType: string | null,
  processed: boolean,
  payload: unknown
): WebhookSummary {
  const { outcome, tone } = describeOutcome(eventType, processed);

  if (source === "numbers") {
    // What an owner or admin did to a number on Settings → Phone numbers, and
    // what Meta answered. Kept so "I pressed Register and nothing happened" has
    // an answer that does not depend on a screenshot.
    const snap = (payload as { numbers?: { display?: string; name?: string | null; connection?: string | null }[] } | null)?.numbers;
    if (Array.isArray(snap)) {
      return {
        headline: "Phone number status, as Meta reported it when the Phone numbers page was opened",
        details: snap.map((n) => `${n.display ?? "?"}${n.name ? ` ${n.name}` : ""}: ${n.connection ?? "unknown"}`),
        outcome: "Read from Meta.",
        tone: "ok",
      };
    }
    const p = (payload ?? {}) as { action?: string; number?: string; error?: string; statusAfter?: string; company?: string };
    return {
      headline: `Phone number ${p.number ?? "unknown"}: ${p.action ?? "change"}`,
      details: [
        p.statusAfter ? `Meta now reports ${p.statusAfter}` : "",
        p.company ? `company: ${p.company}` : "",
        p.error ? `Meta said: ${p.error}` : "",
      ].filter(Boolean),
      outcome,
      tone,
    };
  }

  if (source !== "whatsapp") {
    // ERP / driver webhooks carry a flat payload with a phone and attributes.
    const p = (payload ?? {}) as { phone?: string; name?: string; automation?: string; event?: string };
    const who = p.name ? `${p.name} (${p.phone ?? "no number"})` : (p.phone ?? "unknown contact");
    return {
      headline: p.event
        ? `Driver update for ${who}: ${p.event.toLowerCase().replace(/_/g, " ")}`
        : `${source.toUpperCase()} sent an order update for ${who}`,
      details: [p.automation ? `flow: ${p.automation}` : ""].filter(Boolean),
      outcome,
      tone,
    };
  }

  const value = (
    (payload as { entry?: { changes?: { value?: WaValue }[] }[] } | null)?.entry?.[0]?.changes?.[0]
      ?.value ?? {}
  ) as WaValue;

  const sigState = (eventType ?? "").split("|sig:")[1];
  const sigChip = sigState ? `signature ${sigState === "valid" ? "verified" : sigState}` : "";

  const person =
    value.contacts?.[0]?.profile?.name ??
    value.contacts?.[0]?.profile?.username ??
    value.contacts?.[0]?.wa_id ??
    "A customer";

  if (value.statuses?.length) {
    const s = value.statuses[0];
    return {
      headline: `Delivery receipt from WhatsApp — a message was marked ${s.status ?? "updated"}`,
      details: [s.recipient_id ? `to ${s.recipient_id}` : "", sigChip].filter(Boolean),
      outcome,
      tone,
    };
  }

  if (value.messages?.length) {
    const first = value.messages[0];
    const extra = value.messages.length > 1 ? ` (+${value.messages.length - 1} more)` : "";
    return {
      headline: `${person} ${describeMessage(first)}${extra}`,
      details: [
        value.metadata?.display_phone_number ? `to +${value.metadata.display_phone_number}` : "",
        value.contacts?.[0]?.wa_id ? `from +${value.contacts[0].wa_id}` : "",
        sigChip,
      ].filter(Boolean),
      outcome,
      tone,
    };
  }

  return { headline: "WhatsApp sent an update", details: [], outcome, tone };
}
