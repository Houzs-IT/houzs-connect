import type { SeedFlow } from "./types";

/**
 * Opt In / Opt Out — marketing-consent keyword handler (decision B).
 *
 * Fires on every inbound (NEW_INCOMING_MESSAGE) when nothing resumed; the router
 * reads `last_message` (the inbound text, lowercased by handleInboundMessage) and
 * routes on a keyword: "stop" → opt out, "start" → opt in, anything else → no-op.
 * The opt_in / opt_out nodes flip the contact's marketingOptIn; the ack is a
 * free-text reply (the customer's own message opened the 24h window).
 *
 * Copy + the keyword set are a sensible default — confirm/tweak against the
 * Seampify "Opt In/Opt Out" flow before enabling. Seeds DRAFT/disabled.
 */

const ACK_OUT = `You've been unsubscribed and won't receive further update messages from us. Reply *START* anytime to resume. Thank you!`;

const ACK_IN = `Welcome back! You'll receive our updates again. Thank you!`;

export const optInOutFlow: SeedFlow = {
  key: "opt_in_out",
  name: "Opt In Opt Out",
  description:
    "Keyword consent: an inbound containing 'stop' opts the contact out, 'start' opts them back in, each with a confirmation; other messages are a no-op.",
  triggerType: "NEW_INCOMING_MESSAGE",
  triggerConfig: { event: "new_message" },
  forms: [],
  build: () => ({
    nodes: [
      { id: "trigger", type: "trigger", data: {}, x: 40, y: 160 },
      {
        id: "router",
        type: "criteria_router",
        x: 240,
        y: 160,
        data: {
          rules: [
            { branch: "out", field: "last_message", op: "contains", value: "stop" },
            { branch: "in", field: "last_message", op: "contains", value: "start" },
          ],
        },
      },
      { id: "optout", type: "opt_out", x: 460, y: 80, data: {} },
      { id: "ack_out", type: "send_text", x: 680, y: 80, data: { message: ACK_OUT } },
      { id: "optin", type: "opt_in", x: 460, y: 240, data: {} },
      { id: "ack_in", type: "send_text", x: 680, y: 240, data: { message: ACK_IN } },
      { id: "stop", type: "end", x: 900, y: 160, data: {} },
    ],
    edges: [
      { from: "trigger", to: "router" },
      { from: "router", to: "optout", branch: "out" },
      { from: "router", to: "optin", branch: "in" },
      { from: "router", to: "stop", branch: "default" },
      { from: "optout", to: "ack_out" },
      { from: "ack_out", to: "stop" },
      { from: "optin", to: "ack_in" },
      { from: "ack_in", to: "stop" },
    ],
  }),
};
