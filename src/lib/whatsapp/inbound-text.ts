// What the inbox stores for an inbound WhatsApp message that is not plain text.
// Kept out of the webhook route: a Next route file may only export handlers.

export type InboundNonText = {
  type: string;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: Array<{ name?: { formatted_name?: string }; phones?: Array<{ phone?: string; wa_id?: string }> }>;
  reaction?: { message_id?: string; emoji?: string };
};

export const MEDIA_TYPE: Record<string, "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO"> = {
  image: "IMAGE",
  sticker: "IMAGE",
  document: "DOCUMENT",
  audio: "AUDIO",
  video: "VIDEO",
};

/**
 * Words for a message that carries no text of its own. A voice note, sticker,
 * location or reaction used to be stored as "" — an empty bubble in the inbox
 * that nobody could read or answer (HC-0169).
 */
export function describeNonText(m: InboundNonText): string {
  switch (m.type) {
    case "image":
    case "document":
      return "[attachment]";
    case "audio":
      return "[voice message]";
    case "video":
      return "[video]";
    case "sticker":
      return "[sticker]";
    case "location": {
      const l = m.location ?? {};
      const map = l.latitude != null && l.longitude != null ? `https://maps.google.com/?q=${l.latitude},${l.longitude}` : null;
      return ["[location]", l.name, l.address, map].filter(Boolean).join("\n");
    }
    case "contacts":
      return [
        "[contact]",
        ...(m.contacts ?? []).map((c) =>
          [c.name?.formatted_name, ...(c.phones ?? []).map((p) => p.phone ?? p.wa_id)].filter(Boolean).join(" ")
        ),
      ].join("\n");
    case "reaction":
      return m.reaction?.emoji ? `[reaction] ${m.reaction.emoji}` : "[reaction removed]";
    default:
      return `[${m.type || "unknown"} message - open WhatsApp on the phone to see it]`;
  }
}
