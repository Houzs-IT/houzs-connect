/**
 * Voice notes: the one format WhatsApp will play, and how to know in advance
 * whether this browser can produce it.
 *
 * Imported by BOTH the composer (browser) and the server action, so — exactly
 * like media-limits.ts — nothing server-only may be imported here: no env, no
 * db, no drizzle.
 *
 * The format is not a preference. Meta's media reference lists
 *
 *     audio/ogg — OPUS codecs only; the base audio/ogg type is not supported
 *
 * and an audio message in any other container arrives in the customer's chat as
 * a file attachment with a download arrow rather than the playable bubble with a
 * waveform. It is still "delivered", so nothing anywhere reports a problem — the
 * operator simply sent something different from what they thought they sent.
 * That is why this module refuses to record at all rather than record MP4/AAC
 * and hope: a recording WhatsApp will not render as a voice note is a failure
 * that looks like a success, and this system has had enough of those.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 */

/**
 * What MediaRecorder is asked for. The `;codecs=opus` half is load-bearing —
 * `audio/ogg` on its own is Ogg/Vorbis, which Meta explicitly does not support.
 */
export const VOICE_RECORDER_MIME = "audio/ogg;codecs=opus";

/**
 * What we declare to Meta on the upload. The `type` field takes a plain media
 * type, not a codec parameter, so the container name is what goes on the wire —
 * the bytes inside are Opus because VOICE_RECORDER_MIME made them so.
 */
export const VOICE_UPLOAD_MIME = "audio/ogg";

/** Meta's cap for an audio message. */
export const MAX_VOICE_BYTES = 16 * 1024 * 1024;

/**
 * Hard stop for one recording. Nothing to do with bytes — Opus at this bitrate
 * would need hours to approach 16 MB. It is there so a mic left open by a
 * distracted operator ends by itself instead of growing until the send fails.
 */
export const MAX_VOICE_SECONDS = 300;

export type VoiceSupport =
  | { ok: true; recorderMime: string }
  | { ok: false; reason: string };

/**
 * What the composer shows before the browser has been asked.
 *
 * Client components are server-rendered first, and none of the APIs below exist
 * there, so the honest first answer is "not known yet" — not "unsupported".
 */
export const VOICE_SUPPORT_UNKNOWN: VoiceSupport = {
  ok: false,
  reason: "Checking whether this browser can record a WhatsApp voice note…",
};

/**
 * Can this browser record something WhatsApp will play?
 *
 * Browser-only: call it from the client, never during a server render.
 *
 * There is deliberately NO fallback to another container. Chrome, Edge and
 * Firefox support Ogg/Opus; Safari (and every browser on iOS, which is all of
 * them) records MP4/AAC and returns false here. Recording AAC and sending it
 * anyway would produce a file attachment in the customer's chat, so the button
 * goes dead with this sentence on it instead.
 */
export function detectVoiceSupport(): VoiceSupport {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return {
      ok: false,
      reason:
        "This browser has no MediaRecorder, so it cannot record audio at all. Chrome, Edge or Firefox on a computer can.",
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason:
        "This browser will not give a page access to the microphone here. That is usually because the page is not on https — microphone access is only offered on a secure connection.",
    };
  }
  if (typeof MediaRecorder.isTypeSupported !== "function" || !MediaRecorder.isTypeSupported(VOICE_RECORDER_MIME)) {
    return {
      ok: false,
      reason:
        "This browser cannot record Ogg/Opus, which is the only audio WhatsApp plays as a voice note. Anything else it can record — Safari and every iPhone browser produce MP4/AAC — would reach the customer as a file to download instead of a playable voice message, so recording is switched off here. Chrome, Edge or Firefox on a computer can send voice notes.",
    };
  }
  return { ok: true, recorderMime: VOICE_RECORDER_MIME };
}

/**
 * getUserMedia's rejection, as a sentence an operator can act on.
 *
 * A denied microphone must never be a silent no-op: the browser's own prompt is
 * remembered per site, so once someone clicks Block the button simply stops
 * working forever with no explanation anywhere.
 */
export function micErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  switch (err?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "The browser blocked the microphone. Click the padlock in the address bar, set Microphone to Allow for this site, then try again — the browser remembers a Block, so it will not ask a second time on its own.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found. Plug one in (or check the system sound settings) and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "The microphone is there but could not be opened — usually another app or tab already has it. Close whatever is using it and try again.";
    case "OverconstrainedError":
      return "No microphone on this machine matches what was asked for.";
    case "SecurityError":
      return "The browser refused microphone access for security reasons. This page has to be on https for the microphone to be offered.";
    case "AbortError":
      return "The browser gave up starting the microphone. Try again.";
    default:
      return `The microphone could not be started: ${err?.message ?? "no reason given"}.`;
  }
}

/** 7000 → "0:07", 64000 → "1:04". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export type VoiceCheck = { ok: true } | { ok: false; error: string };

/**
 * The server's own check on what arrived. The browser's checks are a courtesy —
 * anyone can POST a server action directly, and Meta answers a bad upload with
 * "(#100) Invalid parameter", which tells the operator nothing.
 */
export function checkVoiceNote(file: { type: string; size: number }): VoiceCheck {
  if (!file.size) {
    return {
      ok: false,
      error: "The recording is empty — nothing was captured from the microphone.",
    };
  }
  if (file.size > MAX_VOICE_BYTES) {
    return {
      ok: false,
      error: `That recording is ${(file.size / (1024 * 1024)).toFixed(1)} MB. WhatsApp caps audio at ${
        MAX_VOICE_BYTES / (1024 * 1024)
      } MB — record a shorter one.`,
    };
  }
  // Only the container is checked. Nothing on the server can look inside the
  // bytes and prove they are Opus; what makes them Opus is the recorder mime
  // the browser was held to.
  const type = file.type.trim().toLowerCase();
  if (type && !type.startsWith("audio/ogg")) {
    return {
      ok: false,
      error: `A voice note has to be Ogg/Opus audio; this arrived as “${file.type}”. WhatsApp would deliver it as a file attachment rather than a playable voice message.`,
    };
  }
  return { ok: true };
}
