"use client";

// The interactive half of the numbers page: the add-a-number form and the
// per-number verify / register actions.
//
// It is one component rather than four because the steps are one conversation
// with Meta — you add a number and immediately need to send it a code, and the
// id you need for that came back from the previous call. Splitting them would
// mean threading that id through a page reload for no benefit.

import { useState, useTransition } from "react";
import {
  addPhoneNumber,
  confirmVerificationCode,
  registerForCloudApi,
  releaseFromCloudApi,
  sendVerificationCode,
  type ActionResult,
} from "./actions";
import type { CodeMethod, WabaNumber } from "@/lib/whatsapp/numbers";
import { nextStep } from "@/lib/whatsapp/numbers";

const inputCls =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]";
const btnCls =
  "rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";
const ghostBtnCls =
  "rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40";

function Badge({ text, tone }: { text: string; tone: "good" | "warn" | "bad" | "mute" }) {
  const cls =
    tone === "good"
      ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)]"
      : tone === "bad"
        ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
        : tone === "warn"
          ? "bg-[color-mix(in_srgb,#b45309_14%,transparent)] text-[#b45309]"
          : "bg-[var(--color-surface-2)] text-[var(--color-muted)]";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {text}
    </span>
  );
}

function connectionTone(s: string | null): "good" | "warn" | "bad" | "mute" {
  if (s === "CONNECTED") return "good";
  if (s === "PENDING") return "warn";
  if (s === "FLAGGED" || s === "RESTRICTED") return "warn";
  if (s === "BANNED" || s === "DELETED") return "bad";
  return "mute";
}

function verificationTone(s: string | null): "good" | "warn" | "bad" | "mute" {
  if (s === "VERIFIED") return "good";
  if (s === "EXPIRED") return "bad";
  if (s === "NOT_VERIFIED") return "warn";
  return "mute";
}

/** Shared result line so every action reports failure the same way. */
function Result({ r }: { r: { ok: boolean; text: string } | null }) {
  if (!r) return null;
  return (
    <p
      className={`mt-2 text-[12px] ${r.ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}
    >
      {r.text}
    </p>
  );
}

/** The verify → register controls for one number. */
function NumberActions({ n }: { n: WabaNumber }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<ActionResult>, okText: string) {
    setResult(null);
    start(async () => {
      const r = await fn();
      setResult({ ok: r.ok, text: r.ok ? okText : (r.error ?? "Meta refused and gave no reason.") });
    });
  }

  const verified = n.codeVerification === "VERIFIED";
  const connected = n.connection === "CONNECTED";

  return (
    <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
      {!verified && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={labelCls}>Step 1 · prove you own it</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled={pending}
                className={ghostBtnCls}
                onClick={() => run(() => sendVerificationCode(n.id, "SMS" as CodeMethod), "Code sent by SMS.")}
              >
                Send SMS code
              </button>
              <button
                type="button"
                disabled={pending}
                className={ghostBtnCls}
                onClick={() => run(() => sendVerificationCode(n.id, "VOICE" as CodeMethod), "Meta is calling the number.")}
              >
                Call instead
              </button>
            </div>
          </div>
          <div>
            <label className={labelCls}>Code received</label>
            <div className="mt-1 flex gap-2">
              <input
                className={`${inputCls} w-32`}
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                disabled={pending || !code.trim()}
                className={btnCls}
                onClick={() => run(() => confirmVerificationCode(n.id, code), "Number verified.")}
              >
                Verify
              </button>
            </div>
          </div>
        </div>
      )}

      {verified && !connected && (
        <div>
          <label className={labelCls}>Step 2 · register for Cloud API</label>
          <p className="mt-1 text-[11px] text-[var(--color-faint)]">
            Six-digit two-step PIN. If this number has never had one, what you type here becomes
            it — keep it somewhere safe, Meta will ask for it again and cannot tell you what it was.
          </p>
          <div className="mt-1 flex gap-2">
            <input
              className={`${inputCls} w-32`}
              inputMode="numeric"
              placeholder="000000"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <button
              type="button"
              disabled={pending || pin.replace(/\D/g, "").length !== 6}
              className={btnCls}
              onClick={() => run(() => registerForCloudApi(n.id, pin), "Registered. This number can send now.")}
            >
              Register
            </button>
          </div>
        </div>
      )}

      {connected && !n.isActive && (
        <button
          type="button"
          disabled={pending}
          className={`${ghostBtnCls} text-[var(--color-danger)]`}
          onClick={() => run(() => releaseFromCloudApi(n.id), "Released from Cloud API.")}
        >
          Release from Cloud API
        </button>
      )}

      <Result r={result} />
    </div>
  );
}

function NumberCard({ n }: { n: WabaNumber }) {
  const advice = nextStep(n);
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        n.isActive
          ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_4%,transparent)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[15px] font-semibold text-[var(--color-ink)]">
          {n.displayPhoneNumber}
        </span>
        {n.verifiedName && (
          <span className="text-[12.5px] text-[var(--color-muted)]">{n.verifiedName}</span>
        )}
        {n.isActive && <Badge text="SENDING FROM THIS" tone="good" />}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge text={n.connection ?? "unknown"} tone={connectionTone(n.connection)} />
        <Badge
          text={`verification: ${n.codeVerification ?? "unknown"}`}
          tone={verificationTone(n.codeVerification)}
        />
        {n.nameStatus && <Badge text={`name: ${n.nameStatus}`} tone="mute" />}
        <Badge text={`quality: ${n.qualityRating ?? "not rated"}`} tone="mute" />
        <Badge text={`limit: ${n.limitTier ?? "unset"}`} tone={n.limitTier ? "mute" : "warn"} />
      </div>

      <p className="mt-2 font-mono text-[11px] text-[var(--color-faint)]">id {n.id}</p>

      {advice && (
        <p className="mt-2 text-[12.5px] text-[var(--color-muted)]">
          <strong className="text-[var(--color-ink)]">Next:</strong> {advice}
        </p>
      )}

      <NumberActions n={n} />
    </div>
  );
}

function AddNumber() {
  const [cc, setCc] = useState("60");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">Add a number</h3>
      <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">
        The number must not be active on the WhatsApp Business app — a number lives on the app or
        on the Cloud API, never both. Delete it there first, or use a fresh SIM.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className={labelCls}>Country code</label>
          <input
            className={`${inputCls} mt-1 w-20`}
            inputMode="numeric"
            placeholder="60"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
          />
        </div>
        <div>
          <label className={labelCls}>Number (no leading 0)</label>
          <input
            className={`${inputCls} mt-1 w-44`}
            inputMode="numeric"
            placeholder="1111108822"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="min-w-52 flex-1">
          <label className={labelCls}>Display name</label>
          <input
            className={`${inputCls} mt-1 w-full`}
            placeholder="Houzs Century"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={pending || !phone.trim() || !name.trim()}
          className={btnCls}
          onClick={() => {
            setResult(null);
            start(async () => {
              const r = await addPhoneNumber({ cc, phoneNumber: phone, verifiedName: name });
              setResult({
                ok: r.ok,
                text: r.ok
                  ? `Added as ${r.id}. It appears above — send it a verification code next.`
                  : (r.error ?? "Meta refused and gave no reason."),
              });
              if (r.ok) setPhone("");
            });
          }}
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      <Result r={result} />
    </div>
  );
}

export function NumbersClient({
  numbers,
  activeId,
}: {
  numbers: WabaNumber[];
  activeId: string | null;
}) {
  // The active id not being on the WABA is the failure mode worth shouting
  // about: every send goes to that id, so if it is stale or belongs to another
  // WABA the app looks configured and delivers nothing.
  const activeMissing = !!activeId && !numbers.some((n) => n.id === activeId);
  return (
    <div className="space-y-4">
      {activeMissing && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_6%,transparent)] px-4 py-3">
          <p className="text-[12.5px] text-[var(--color-danger)]">
            This app sends from phone number id <span className="font-mono">{activeId}</span>, which
            is not on this WABA. Every message will fail until{" "}
            <span className="font-mono">WHATSAPP_PHONE_NUMBER_ID</span> points at one of the numbers
            below.
          </p>
        </div>
      )}
      {numbers.length === 0 ? (
        <p className="text-[13px] text-[var(--color-muted)]">
          No numbers on this WhatsApp Business Account yet.
        </p>
      ) : (
        numbers.map((n) => <NumberCard key={n.id} n={n} />)
      )}
      <AddNumber />
    </div>
  );
}
