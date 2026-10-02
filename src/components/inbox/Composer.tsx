"use client";

// The reply composer. Reply / Private note on top; quick replies, templates,
// attachments, emoji, voice notes and contact cards sit on the toolbar under
// the text instead of behind a "+" menu. "Send buttons / Flows" is not offered:
// Connect has no Flow builder, so there is nothing to send.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sendMessage, sendTemplateMessage, listQuickReplies, listSendableTemplates } from "@/app/actions";
import {
  listInboxContacts,
  sendAttachment,
  sendContactCard,
  sendVoiceNote,
} from "@/app/(app)/inbox/media-actions";
import { IconBolt, IconContacts, IconForm, IconPaperclip, IconSend } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";
import { EmojiPicker } from "@/components/inbox/EmojiPicker";
import {
  ATTACHMENT_ACCEPT,
  checkAttachment,
  formatBytes,
  MAX_CAPTION_CHARS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  resolveMimeType,
} from "@/lib/whatsapp/media-limits";
import {
  detectVoiceSupport,
  formatDuration,
  MAX_VOICE_SECONDS,
  micErrorMessage,
  VOICE_SUPPORT_UNKNOWN,
  VOICE_UPLOAD_MIME,
  type VoiceSupport,
} from "@/lib/whatsapp/voice";

interface QuickReply {
  shortcut: string;
  body: string;
}
interface Template {
  name: string;
  language: string;
  body: string;
  placeholders: number;
}
interface ContactOption {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
}

/** What the composer will accept, spelled out for the operator up front. */
const LIMITS_HINT = `JPEG or PNG up to ${formatBytes(
  MAX_IMAGE_BYTES
)} · PDF, Word, Excel, PowerPoint or text up to ${formatBytes(MAX_DOCUMENT_BYTES)}`;

/**
 * Whether THIS browser can record a WhatsApp voice note — read without tripping
 * over server rendering.
 *
 * The answer exists only in the browser, and a client component is rendered on
 * the server first. That rules out a useState initialiser (server and client
 * would disagree and hydration would tear) and it must not be pushed in with a
 * setState inside an effect. useSyncExternalStore is the one hook that takes a
 * deliberately different server answer: the server renders "not known yet", and
 * React re-renders with the real answer the moment it hydrates.
 */
let cachedVoiceSupport: VoiceSupport | null = null;
function readVoiceSupport(): VoiceSupport {
  // Memoised: useSyncExternalStore compares snapshots by reference, so a fresh
  // object per call would re-render forever.
  cachedVoiceSupport ??= detectVoiceSupport();
  return cachedVoiceSupport;
}
const serverVoiceSupport = () => VOICE_SUPPORT_UNKNOWN;
/** Nothing to subscribe to — the answer cannot change while the page is open. */
const subscribeVoiceSupport = () => () => {};

/** Fill {{1}}, {{2}}, … so the operator sees what the customer will read. */
function renderPreview(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] || `{{${n}}}`);
}

export function Composer({
  conversationId,
  windowExpiresAt = null,
}: {
  conversationId: string;
  /**
   * When Meta's 24-hour customer-service window shuts, ISO, or null if the
   * customer has never written to us.
   *
   * Outside that window WhatsApp refuses every free-form message — the send
   * looks fine in our UI and the customer receives nothing. The operator has to
   * be told before they type, not after, so the reply box says so and only the
   * template path stays available.
   */
  windowExpiresAt?: string | null;
}) {
  // Re-checked on a timer rather than read once: a composer sitting open across
  // the deadline must stop inviting a reply the moment it passes.
  const [windowOpen, setWindowOpen] = useState(
    () => !!windowExpiresAt && new Date(windowExpiresAt).getTime() > Date.now()
  );
  useEffect(() => {
    const id = setInterval(
      () => setWindowOpen(!!windowExpiresAt && new Date(windowExpiresAt).getTime() > Date.now()),
      15_000
    );
    return () => clearInterval(id);
  }, [windowExpiresAt]);
  const [kind, setKind] = useState<"reply" | "note">("reply");
  const [panel, setPanel] = useState<
    null | "quick" | "template" | "emoji" | "attach" | "contact" | "voice"
  >(null);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // Attachment + contact-card state. `busy` covers both — only one panel is
  // ever open, and both hold the operator until Meta answers.
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const note = kind === "note";
  const { t } = useShell();
  const s = t.service;

  // ── Voice notes ────────────────────────────────────────────────────────────
  const voiceSupport = useSyncExternalStore(
    subscribeVoiceSupport,
    readVoiceSupport,
    serverVoiceSupport
  );
  const [voiceState, setVoiceState] = useState<"idle" | "starting" | "recording" | "ready">("idle");
  /** Ticked by an interval, never computed in render — a clock read while
   *  rendering makes the output depend on when React happened to run. */
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string; ms: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  /** Set by Cancel so onstop throws the audio away instead of offering it. */
  const discardRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const clipUrlRef = useRef<string | null>(null);

  async function openQuick() {
    setPanel("quick");
    if (quickReplies.length === 0) {
      setLoading(true);
      setQuickReplies(await listQuickReplies());
      setLoading(false);
    }
  }

  async function openTemplates() {
    setPanel("template");
    if (templates.length === 0) {
      setLoading(true);
      setTemplates(await listSendableTemplates());
      setLoading(false);
    }
  }

  // ── Attachments ────────────────────────────────────────────────────────────

  function openAttachment() {
    setError(null);
    setFile(null);
    setCaption("");
    fileRef.current?.click();
  }

  /**
   * Check the file HERE, before a byte moves. Meta answers an unsupported or
   * oversized upload with "(#100) Invalid parameter", which tells the operator
   * nothing; the server re-runs the identical check because this one is only a
   * courtesy.
   */
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    // Clear the input so picking the SAME file again still fires onChange.
    e.target.value = "";
    if (!picked) return;
    setCaption("");
    setPanel("attach");
    const check = checkAttachment({
      name: picked.name,
      type: resolveMimeType(picked.name, picked.type),
      size: picked.size,
    });
    if (!check.ok) {
      setFile(null);
      setError(check.error);
      return;
    }
    setError(null);
    setFile(picked);
  }

  async function submitAttachment() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("caption", caption);
    fd.set("file", file);
    const res = await sendAttachment(fd);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "The attachment could not be sent.");
      return;
    }
    setFile(null);
    setCaption("");
    setPanel(null);
  }

  // ── Voice notes ────────────────────────────────────────────────────────────
  //
  // Record → review → send. The review step is not politeness: this composer
  // talks to real customers, and a recording cannot be unsent once Meta has it.

  /** Let go of the microphone and the timer. Safe to call twice. */
  function releaseRecorder() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  /** Throw away the pending recording and the blob URL holding it in memory. */
  function dropClip() {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
    setClip(null);
  }

  function stopVoice() {
    const rec = recorderRef.current;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    // onstop assembles the blob; releasing the mic there keeps one owner of it.
    if (rec && rec.state !== "inactive") rec.stop();
    else releaseRecorder();
  }

  function cancelVoice() {
    discardRef.current = true;
    stopVoice();
    dropClip();
    setVoiceState("idle");
    setElapsedMs(0);
    setError(null);
    setPanel(null);
  }

  async function startVoice() {
    // "starting" is a real state: getUserMedia can sit on the browser's own
    // permission prompt for as long as the operator ignores it, and a second
    // click during that must not open a second microphone.
    if (busy || voiceState === "starting" || voiceState === "recording") return;
    setPanel("voice");
    setError(null);
    dropClip();

    // Nothing is recorded when the result could not be a voice note — a wrong
    // container still "sends", it just arrives as a file to download.
    if (!voiceSupport.ok) {
      setVoiceState("idle");
      setError(voiceSupport.reason);
      return;
    }

    setVoiceState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      // A denied microphone is remembered by the browser, so this is the only
      // place the operator will ever be told why the button stopped working.
      setVoiceState("idle");
      setError(micErrorMessage(e));
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: voiceSupport.recorderMime });
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      setVoiceState("idle");
      setError(
        `This browser reported that it supports ${voiceSupport.recorderMime} but would not start a recorder for it: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return;
    }

    chunksRef.current = [];
    discardRef.current = false;

    recorder.ondataavailable = (ev: BlobEvent) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    recorder.onerror = () => {
      releaseRecorder();
      setVoiceState("idle");
      setError("The browser stopped the recording with an error. Nothing was sent.");
    };
    recorder.onstop = () => {
      const parts = chunksRef.current;
      chunksRef.current = [];
      const ms = Date.now() - startedAtRef.current;
      releaseRecorder();
      if (discardRef.current) {
        setVoiceState("idle");
        return;
      }
      const blob = new Blob(parts, { type: VOICE_UPLOAD_MIME });
      if (blob.size === 0) {
        setVoiceState("idle");
        setError("Nothing was captured from the microphone, so there is nothing to send.");
        return;
      }
      const url = URL.createObjectURL(blob);
      clipUrlRef.current = url;
      setClip({ blob, url, ms });
      setVoiceState("ready");
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start();
    setVoiceState("recording");
    tickRef.current = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsedMs(ms);
      // A mic left open by a distracted operator ends by itself.
      if (ms >= MAX_VOICE_SECONDS * 1000) stopVoice();
    }, 250);
  }

  async function submitVoice() {
    if (!clip || busy) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("durationMs", String(clip.ms));
    fd.set("audio", clip.blob, "voice-note.ogg");
    const res = await sendVoiceNote(fd);
    setBusy(false);
    if (!res.ok) {
      // Keep the recording: the failure may be temporary and re-recording it
      // from memory is not the same message.
      setError(res.error ?? "The voice note could not be sent.");
      return;
    }
    dropClip();
    setVoiceState("idle");
    setElapsedMs(0);
    setPanel(null);
  }

  /**
   * Leaving the thread mid-recording must not leave the microphone open — the
   * browser's recording indicator would stay lit with nothing behind it.
   */
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    };
  }, []);

  /** Why the microphone is unavailable right now, or null when it is not. */
  const voiceBlocked = note
    ? "A private note stays inside Connect and is never sent, and there is nowhere here to store audio. Switch to Reply to record a voice note."
    : !windowOpen
      ? "The 24-hour reply window is closed. WhatsApp refuses a voice note exactly as it refuses a typed message — send an approved template instead."
      : voiceSupport.ok
        ? null
        : voiceSupport.reason;

  // ── Emoji ──────────────────────────────────────────────────────────────────

  /** Drop the character at the caret, not at the end of the draft. */
  function insertEmoji(emoji: string) {
    const el = textRef.current;
    if (!el) {
      setDraft((d) => d + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? start;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    const caret = start + emoji.length;
    // After React has re-rendered the controlled textarea, put the caret back
    // where the operator was typing.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  // ── Contact cards ──────────────────────────────────────────────────────────

  async function loadContacts(q: string) {
    setLoading(true);
    setContacts(await listInboxContacts(q));
    setLoading(false);
  }

  async function openContacts() {
    setPanel("contact");
    setError(null);
    if (contacts.length === 0 && !contactQuery) await loadContacts("");
  }

  /** Debounced so a typed name is one query, not one per keystroke. */
  function onContactQuery(q: string) {
    setContactQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void loadContacts(q), 250);
  }

  async function submitContact(contactId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("contactId", contactId);
    const res = await sendContactCard(fd);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "The contact could not be sent.");
      return;
    }
    setPanel(null);
  }

  return (
    <div className="relative shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 pb-3.5 pt-2.5 md:px-4">
      {/* ── Quick replies ── */}
      {panel === "quick" && (
        <Panel title="Quick replies" onClose={() => setPanel(null)}>
          {loading && <Empty>Loading…</Empty>}
          {!loading && quickReplies.length === 0 && (
            <Empty>No quick replies yet — add them in Settings.</Empty>
          )}
          {quickReplies.map((q) => (
            <button
              key={q.shortcut}
              type="button"
              onClick={() => {
                setDraft(q.body);
                setPanel(null);
              }}
              className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-surface-2)]"
            >
              <span className="mt-0.5 flex-none rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-accent-ink)]">
                /{q.shortcut}
              </span>
              <span className="line-clamp-2 text-[12.5px] text-[var(--color-muted)]">{q.body}</span>
            </button>
          ))}
        </Panel>
      )}

      {/* ── Templates ── */}
      {panel === "template" && (
        <Panel
          title={chosen ? chosen.name : "Send a template"}
          onClose={() => {
            setPanel(null);
            setChosen(null);
          }}
        >
          {loading && <Empty>Loading approved templates…</Empty>}
          {!loading && !chosen && templates.length === 0 && (
            <Empty>
              No approved templates yet. Submit them on the Templates page — Meta review takes
              about 24 hours.
            </Empty>
          )}

          {!chosen &&
            templates.map((t) => (
              <button
                key={`${t.name}-${t.language}`}
                type="button"
                onClick={() => {
                  setChosen(t);
                  setParams(Array.from({ length: t.placeholders }, () => ""));
                }}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-surface-2)]"
              >
                <span className="font-mono text-[12px] text-[var(--color-ink)]">{t.name}</span>
                <span className="line-clamp-2 text-[12px] text-[var(--color-muted)]">{t.body}</span>
              </button>
            ))}

          {chosen && (
            <form action={sendTemplateMessage} className="px-1 pb-1">
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="templateName" value={chosen.name} />
              <input type="hidden" name="language" value={chosen.language} />
              <input type="hidden" name="params" value={params.join("\n")} />
              <input type="hidden" name="preview" value={renderPreview(chosen.body, params)} />

              {chosen.placeholders > 0 && (
                <div className="mb-2 space-y-1.5">
                  {params.map((v, i) => (
                    <input
                      key={i}
                      value={v}
                      onChange={(e) => {
                        const next = [...params];
                        next[i] = e.target.value;
                        setParams(next);
                      }}
                      placeholder={`Value for {{${i + 1}}}`}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
                    />
                  ))}
                </div>
              )}

              <div className="mb-2 whitespace-pre-wrap rounded-lg bg-[var(--color-surface-2)] p-2.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                {renderPreview(chosen.body, params)}
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setChosen(null)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-muted)]"
                >
                  Back
                </button>
                <button
                  type="submit"
                  onClick={() => setTimeout(() => setPanel(null), 0)}
                  className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white"
                >
                  Send template
                </button>
              </div>
            </form>
          )}
        </Panel>
      )}

      {/* ── Attachment ── */}
      {panel === "attach" && (
        <Panel
          title="Send an attachment"
          onClose={() => {
            setPanel(null);
            setFile(null);
            setError(null);
          }}
        >
          {file ? (
            <div className="px-1 pb-1">
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-ink)]">
                  {file.name}
                </span>
                <span className="flex-none text-[11px] text-[var(--color-faint)]">
                  {formatBytes(file.size)}
                </span>
              </div>
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={MAX_CAPTION_CHARS}
                placeholder="Caption (optional)"
                className="mb-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
              />
              {error && <Problem>{error}</Problem>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  title={busy ? "Waiting for WhatsApp to accept the upload." : undefined}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={() => void submitAttachment()}
                  disabled={busy}
                  title={busy ? "Waiting for WhatsApp to accept the upload." : undefined}
                  className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Uploading to WhatsApp…" : "Send attachment"}
                </button>
              </div>
            </div>
          ) : (
            <div className="px-1 pb-1">
              {error && <Problem>{error}</Problem>}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-[12.5px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
              >
                Choose a file
              </button>
            </div>
          )}
          <p className="px-1.5 pb-1 pt-2 text-[10.5px] text-[var(--color-faint)]">{LIMITS_HINT}</p>
        </Panel>
      )}

      {/* ── Voice note ── */}
      {panel === "voice" && (
        <Panel title="Voice note" onClose={cancelVoice}>
          <div className="px-1 pb-1">
            {error && <Problem>{error}</Problem>}

            {voiceState === "starting" && (
              <Empty>Waiting for the browser to hand over the microphone…</Empty>
            )}

            {voiceState === "recording" && (
              <div className="flex items-center gap-2.5 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2">
                <span className="h-2.5 w-2.5 flex-none animate-pulse rounded-full bg-[var(--color-danger)]" />
                <span className="flex-1 text-[12.5px] text-[var(--color-ink)]">
                  Recording <span className="font-mono">{formatDuration(elapsedMs)}</span>
                </span>
                <button
                  type="button"
                  onClick={cancelVoice}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={stopVoice}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white"
                >
                  Stop
                </button>
              </div>
            )}

            {voiceState === "ready" && clip && (
              <>
                <div className="mb-2 flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-ink)]">
                    Voice note <span className="font-mono">{formatDuration(clip.ms)}</span>
                  </span>
                  <span className="flex-none text-[11px] text-[var(--color-faint)]">
                    {formatBytes(clip.blob.size)}
                  </span>
                </div>
                {/* Listen before it goes out. Nothing here is sent until Send is
                    pressed, and a sent voice note cannot be recalled. */}
                <audio src={clip.url} controls className="mb-2 w-full" />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelVoice}
                    disabled={busy}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12.5px] text-[var(--color-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Discard
                  </button>
                  {/* Blocked for the same reasons the microphone is: the reply
                      window can shut while a recording is sitting here, and
                      sending then means an upload Meta will refuse. */}
                  <button
                    type="button"
                    onClick={() => void submitVoice()}
                    disabled={busy || !!voiceBlocked}
                    title={
                      voiceBlocked ??
                      (busy ? "Waiting for WhatsApp to accept the recording." : undefined)
                    }
                    className="flex-1 rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "Uploading to WhatsApp…" : "Send voice note"}
                  </button>
                </div>
              </>
            )}

            {voiceState === "idle" && !error && (
              <Empty>The microphone is closed. Press the microphone again to record.</Empty>
            )}

            <p className="px-0.5 pb-1 pt-2 text-[10.5px] leading-relaxed text-[var(--color-faint)]">
              Recorded as Ogg/Opus — the only audio WhatsApp plays as a voice note — and stopped
              automatically after {MAX_VOICE_SECONDS / 60} minutes.
            </p>
          </div>
        </Panel>
      )}

      {/* ── Emoji ── */}
      {panel === "emoji" && (
        <Panel title="Emoji" onClose={() => setPanel(null)}>
          <EmojiPicker onPick={insertEmoji} />
        </Panel>
      )}

      {/* ── Contact card ── */}
      {panel === "contact" && (
        <Panel
          title="Send a contact"
          onClose={() => {
            setPanel(null);
            setError(null);
          }}
        >
          <input
            value={contactQuery}
            onChange={(e) => onContactQuery(e.target.value)}
            placeholder="Search by name or number…"
            className="mb-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent)]"
          />
          {error && <Problem>{error}</Problem>}
          {busy && <Empty>Sending the contact card…</Empty>}
          {loading && <Empty>Loading contacts…</Empty>}
          {!loading && contacts.length === 0 && (
            <Empty>
              {contactQuery ? "No contact matches that." : "No contacts in this company yet."}
            </Empty>
          )}
          {!loading &&
            contacts.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                title={busy ? "Sending the contact card — one at a time." : undefined}
                onClick={() => void submitContact(c.id)}
                className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-[12.5px] text-[var(--color-ink)]">
                  {c.name ?? c.phone}
                </span>
                <span className="text-[11.5px] text-[var(--color-muted)]">{c.phone}</span>
              </button>
            ))}
        </Panel>
      )}

      {/* The picker itself: kept out of the message form so it is never
          serialised with a reply. */}
      <input
        ref={fileRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        onChange={onFilePicked}
        className="hidden"
      />

      {/* An internal note is ours, so the window never applies to it. */}
      {!windowOpen && !note && (
        <div className="mb-2 rounded-[8px] border border-[rgba(110,77,18,0.35)] bg-[var(--color-warning-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-ink)]">
          {s.closedBanner}
        </div>
      )}

      <form
        ref={formRef}
        action={async (fd) => {
          await sendMessage(fd);
          setDraft("");
          formRef.current?.reset();
        }}
        className={`flex flex-col rounded-[12px] border shadow-card ${
          note
            ? "border-[rgba(110,77,18,0.4)] bg-[color-mix(in_srgb,var(--color-warning-soft)_55%,white)]"
            : "border-[var(--color-border-strong)] bg-[var(--color-surface)]"
        }`}
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="kind" value={kind} />

        {/* type="button" is load-bearing: inside a form an untyped button
            defaults to submit. */}
        <div className="flex items-center gap-4 px-3 pt-2 text-[12px] font-semibold">
          {(["reply", "note"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`border-b-2 pb-[5px] transition-colors ${
                kind === k
                  ? `${k === "note" ? "border-[var(--color-warning)]" : "border-[var(--color-accent)]"} text-[var(--color-ink)]`
                  : "border-transparent text-[var(--color-faint)] hover:text-[var(--color-ink)]"
              }`}
            >
              {k === "reply" ? s.reply : s.note}
            </button>
          ))}
        </div>

        <textarea
          ref={textRef}
          name="body"
          rows={2}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            // "/" on an empty composer opens quick replies.
            if (v === "/") {
              setDraft("");
              void openQuick();
              return;
            }
            setDraft(v);
          }}
          disabled={!windowOpen && !note}
          placeholder={note ? s.noteMsg : windowOpen ? s.typeMsg : s.closedMsg}
          className="max-h-40 min-h-[42px] resize-none bg-transparent px-3 pb-1 pt-2 text-[13.5px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] disabled:cursor-not-allowed"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />

        <div className="flex items-center gap-0.5 border-t border-[var(--color-border-subtle)] px-2 py-1.5">
          <Tool label={s.tQuick} onClick={() => void openQuick()} showText>
            <IconBolt width={15} height={15} />
          </Tool>
          <Tool label={s.tTpl} onClick={() => void openTemplates()} disabled={note} showText>
            <IconForm width={15} height={15} />
          </Tool>
          <Tool label={s.tAttach} onClick={openAttachment} disabled={note}>
            <IconPaperclip width={15} height={15} />
          </Tool>
          <Tool label={s.tEmoji} onClick={() => setPanel(panel === "emoji" ? null : "emoji")}>
            <IconSmile width={15} height={15} />
          </Tool>
          {/* Recording toggles in place; the review panel opens once stopped. */}
          <Tool
            label={s.tVoice}
            title={voiceBlocked ?? undefined}
            onClick={() => (voiceState === "recording" ? stopVoice() : void startVoice())}
            disabled={!!voiceBlocked || busy}
            danger={voiceState === "recording"}
          >
            <IconMic width={15} height={15} />
          </Tool>
          <Tool label={s.tContact} onClick={() => void openContacts()} disabled={note}>
            <IconContacts width={15} height={15} />
          </Tool>

          <button
            type="submit"
            disabled={!windowOpen && !note}
            title={!windowOpen && !note ? s.closedMsg : undefined}
            className="ml-auto flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] transition-colors hover:bg-[var(--color-accent-hi)] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <IconSend width={14} height={14} />
            {s.send}
          </button>
        </div>
      </form>
    </div>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute bottom-[calc(100%-8px)] left-4 right-4 z-20 max-h-80 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-card">
      <div className="mb-1 flex items-center justify-between px-1.5 py-1">
        <span className="text-[12px] font-semibold text-[var(--color-ink)]">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
        >
          Close
        </button>
      </div>
      {children}
    </div>
  );
}

/**
 * The microphone. Local rather than in components/icons.tsx — that file is a
 * shared surface and this is the only screen that records anything.
 */
function IconMic(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
      <path d="M8.5 21h7" />
    </svg>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-6 text-center text-[12px] text-[var(--color-faint)]">{children}</p>;
}

/** Whatever went wrong, in the operator's words — Meta's or ours. */
function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 rounded-lg bg-[color-mix(in_srgb,#dc2626_10%,transparent)] px-2.5 py-2 text-[12px] leading-relaxed text-[#b91c1c]">
      {children}
    </p>
  );
}

/** One toolbar control; `showText` adds the label beside the icon. */
function Tool({
  label,
  title,
  onClick,
  disabled = false,
  danger = false,
  showText = false,
  children,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  showText?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={`flex h-[30px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[6px] px-2 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "animate-pulse bg-[var(--color-danger)] text-white"
          : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
      {showText && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

function IconSmile(p: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </svg>
  );
}
