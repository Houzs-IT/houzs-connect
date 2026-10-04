"use client";

// The interactive half of the numbers page: adding a number end to end, and
// taking one out of service.
//
// Adding is a wizard rather than four buttons because it is one conversation
// with Meta and the steps are strictly ordered — the id that step 2 needs came
// back from step 1, and a number that skips step 4 looks finished everywhere
// except where it counts. Showing all four at once invites doing them out of
// order and then wondering why nothing sends.

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatPhone } from "@/lib/format";
import { ActionConfirm } from "@/components/ActionConfirm";
import {
  addPhoneNumber,
  assignNumberToCompany,
  confirmVerificationCode,
  registerForCloudApi,
  releaseFromCloudApi,
  sendVerificationCode,
  type ActionResult,
  type NumberAssignment,
} from "./actions";
import type { CodeMethod, WabaNumber } from "@/lib/whatsapp/numbers";
import { nextStep } from "@/lib/whatsapp/numbers";
import { ProfileEditor } from "./ProfileEditor";

const inputCls =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]";
const labelCls =
  "block text-[11px] font-semibold uppercase tracking-wide text-[var(--color-faint)]";
const btnCls =
  "rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";
const ghostBtnCls =
  "rounded-lg border border-[var(--color-border)] px-3 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40";

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

/** One numbered step in the add wizard. */
function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: "done" | "current" | "todo";
  children?: React.ReactNode;
}) {
  return (
    <div className={state === "todo" ? "opacity-45" : undefined}>
      <div className="flex items-center gap-2">
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
            state === "done"
              ? "bg-[var(--color-accent)] text-white"
              : state === "current"
                ? "border border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border border-[var(--color-border)] text-[var(--color-faint)]"
          }`}
        >
          {state === "done" ? "✓" : n}
        </span>
        <span className="text-[12.5px] font-semibold text-[var(--color-ink)]">{title}</span>
      </div>
      {state === "current" && children && <div className="mt-2 pl-7">{children}</div>}
    </div>
  );
}

/**
 * Add a number, all the way to sending.
 *
 * Stays on one screen and carries the phone number id between steps in state —
 * a page reload between "added" and "verified" would strand a half-onboarded
 * number that the person has no id for and no obvious way back to.
 */
function AddWizard({ onDone }: { onDone: () => void }) {
  const [cc, setCc] = useState("60");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [newId, setNewId] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [finished, setFinished] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<ActionResult>, onOk: (r: ActionResult) => string) {
    setResult(null);
    start(async () => {
      const r = await fn();
      setResult({
        ok: r.ok,
        text: r.ok ? onOk(r) : (r.error ?? "Meta refused and gave no reason."),
      });
    });
  }

  const stage = finished ? 4 : verified ? 3 : newId ? 2 : 1;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
      <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">Add a number</h3>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
        The number must not be in use on the WhatsApp Business app — a number lives on the app or
        on the Cloud API, never both. Delete it there first, or use a fresh SIM.
      </p>

      <div className="mt-4 space-y-4">
        <Step n={1} title="Add it to the account" state={stage > 1 ? "done" : "current"}>
          <div className="flex flex-wrap items-end gap-2">
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
              onClick={() =>
                run(
                  () => addPhoneNumber({ cc, phoneNumber: phone, verifiedName: name }),
                  (r) => {
                    setNewId(r.id ?? null);
                    return "Added. Now prove you own it.";
                  }
                )
              }
            >
              {pending ? "Adding…" : "Add"}
            </button>
          </div>
        </Step>

        <Step
          n={2}
          title="Prove you own it"
          state={stage > 2 ? "done" : stage === 2 ? "current" : "todo"}
        >
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className={labelCls}>Send the code</label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  disabled={pending || !newId}
                  className={ghostBtnCls}
                  onClick={() =>
                    run(
                      () => sendVerificationCode(newId!, "SMS" as CodeMethod),
                      () => {
                        setCodeSent(true);
                        return "Sent by SMS.";
                      }
                    )
                  }
                >
                  SMS
                </button>
                <button
                  type="button"
                  disabled={pending || !newId}
                  className={ghostBtnCls}
                  onClick={() =>
                    run(
                      () => sendVerificationCode(newId!, "VOICE" as CodeMethod),
                      () => {
                        setCodeSent(true);
                        return "Meta is calling the number.";
                      }
                    )
                  }
                >
                  Voice call
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
                  disabled={pending || !newId || !codeSent || !code.trim()}
                  className={btnCls}
                  onClick={() =>
                    run(
                      () => confirmVerificationCode(newId!, code),
                      () => {
                        setVerified(true);
                        return "Verified.";
                      }
                    )
                  }
                >
                  Verify
                </button>
              </div>
            </div>
          </div>
        </Step>

        <Step
          n={3}
          title="Register for Cloud API"
          state={stage > 3 ? "done" : stage === 3 ? "current" : "todo"}
        >
          <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
            Six-digit two-step PIN. If this number has never had one, what you type here becomes
            it — keep it somewhere safe. Meta asks for it again when changing or deleting the
            number and cannot tell you what it was.
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
              disabled={pending || !newId || pin.replace(/\D/g, "").length !== 6}
              className={btnCls}
              onClick={() =>
                run(
                  () => registerForCloudApi(newId!, pin),
                  (r) => {
                    setFinished(true);
                    return r.statusAfter === "CONNECTED"
                      ? "Registered. Meta now reports CONNECTED. Assign it to its company below so its messages have somewhere to go."
                      : `Meta accepted the registration, but the number still reads ${r.statusAfter ?? "unknown"}. Reload in a minute.`;
                  }
                )
              }
            >
              Register
            </button>
          </div>
        </Step>

        <Step n={4} title="Ready to send" state={stage === 4 ? "done" : "todo"} />
      </div>

      <Result r={result} />

      {finished && (
        <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
          <p className="text-[12px] text-[var(--color-muted)]">
            To send FROM this number, point{" "}
            <span className="font-mono">WHATSAPP_PHONE_NUMBER_ID</span> at{" "}
            <span className="font-mono">{newId}</span> on the Worker. Adding a number does not
            change which one the app sends from.
          </p>
          <button
            type="button"
            className={`${ghostBtnCls} mt-2`}
            onClick={() => {
              setPhone("");
              setName("");
              setCode("");
              setPin("");
              setNewId(null);
              setCodeSent(false);
              setVerified(false);
              setFinished(false);
              setResult(null);
              onDone();
            }}
          >
            Add another
          </button>
        </div>
      )}
    </div>
  );
}

/** Verify / register / take-out-of-service for a number already on the WABA. */
function NumberActions({ n, managerUrl }: { n: WabaNumber; managerUrl: string | null }) {
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<ActionResult>, okText: string | ((r: ActionResult) => string)) {
    setResult(null);
    start(async () => {
      const r = await fn();
      setResult({
        ok: r.ok,
        text: r.ok
          ? typeof okText === "function"
            ? okText(r)
            : okText
          : (r.error ?? "Meta refused and gave no reason."),
      });
    });
  }

  /**
   * Say what Meta reports AFTER the step, not what we hoped. A registration Meta
   * accepted can still leave the number short of CONNECTED for a moment, and a
   * success line the next reload contradicts is how "I registered it and nothing
   * happened" gets reported.
   */
  const registeredText = (r: ActionResult) =>
    r.statusAfter === "CONNECTED"
      ? "Registered. Meta now reports CONNECTED — this number can send and receive."
      : `Meta accepted the registration, but the number still reads ${r.statusAfter ?? "unknown"}. Reload in a minute. Every attempt and Meta's answer is kept on System Logs.`;

  const verified = n.codeVerification === "VERIFIED";
  const connected = n.connection === "CONNECTED";
  // A connected number is registered and sending; re-running ownership
  // verification on it is at best pointless and at worst disruptive, so the
  // controls are not offered however its code_verification_status reads.
  const needsVerifying = !connected && !verified;

  return (
    <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
      {needsVerifying && (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={labelCls}>
              {n.codeVerification === "EXPIRED" ? "Send a new code" : "Verify ownership"}
            </label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                disabled={pending}
                className={ghostBtnCls}
                onClick={() =>
                  run(() => sendVerificationCode(n.id, "SMS" as CodeMethod), "Code sent by SMS.")
                }
              >
                SMS
              </button>
              <button
                type="button"
                disabled={pending}
                className={ghostBtnCls}
                onClick={() =>
                  run(
                    () => sendVerificationCode(n.id, "VOICE" as CodeMethod),
                    "Meta is calling the number."
                  )
                }
              >
                Voice call
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
                onClick={() =>
                  run(() => confirmVerificationCode(n.id, code), "Number verified.")
                }
              >
                Verify
              </button>
            </div>
          </div>
        </div>
      )}

      {verified && !connected && (
        <div>
          <label className={labelCls}>Register for Cloud API</label>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-faint)]">
            Six-digit two-step PIN. Sets the PIN if this number has never had one.
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
              onClick={() =>
                run(() => registerForCloudApi(n.id, pin), registeredText)
              }
            >
              Register
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {connected && !n.isActive && (
          <button
            type="button"
            disabled={pending}
            className={`${ghostBtnCls} text-[var(--color-danger)]`}
            onClick={() => setConfirmRelease(true)}
          >
            Take out of service
          </button>
        )}
        {managerUrl && (
          <a
            href={managerUrl}
            target="_blank"
            rel="noreferrer noopener"
            className={ghostBtnCls}
          >
            Delete in WhatsApp Manager ↗
          </a>
        )}
      </div>

      <Result r={result} />

      <ActionConfirm
        open={confirmRelease}
        title={`Take ${n.displayPhoneNumber} out of service?`}
        confirmLabel="Take out of service"
        busyLabel="Releasing…"
        busy={pending}
        danger
        onCancel={() => setConfirmRelease(false)}
        onConfirm={() => {
          setConfirmRelease(false);
          run(() => releaseFromCloudApi(n.id), "Released from Cloud API.");
        }}
      >
        <p>
          This deregisters the number from the Cloud API. It stops sending and receiving through
          Connect immediately, and any automation or campaign pointed at it stops with it.
        </p>
        <p className="mt-2">
          It is reversible: the number stays on the account with its message history, and
          registering it again with its PIN brings it back. It does <strong>not</strong> delete
          the number — that only happens in WhatsApp Manager, and cannot be undone.
        </p>
        <p className="mt-2">
          Meta allows 10 register/deregister calls per number per 72 hours, so this is not
          something to toggle repeatedly.
        </p>
      </ActionConfirm>
    </div>
  );
}

const NEW_COMPANY = "__new__";

/**
 * Which company this number serves. Without an assignment a second number has
 * nowhere to file its customers, so the webhook refuses them rather than guess —
 * this is where that stops being true.
 */
function CompanyAssignment({
  n,
  assignment,
  companies,
}: {
  n: WabaNumber;
  assignment: NumberAssignment | null;
  companies: { id: string; name: string }[];
}) {
  const nameMatch = companies.find(
    (c) => n.verifiedName && c.name.toLowerCase() === n.verifiedName.toLowerCase()
  );
  const [choice, setChoice] = useState(
    assignment?.companyId ?? nameMatch?.id ?? (n.verifiedName ? NEW_COMPANY : companies[0]?.id ?? NEW_COMPANY)
  );
  const [newName, setNewName] = useState(nameMatch ? "" : (n.verifiedName ?? ""));
  const [open, setOpen] = useState(!assignment);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function assign() {
    setResult(null);
    start(async () => {
      const r = await assignNumberToCompany(
        n.id,
        choice === NEW_COMPANY ? { newCompanyName: newName } : { companyId: choice }
      );
      setResult({
        ok: r.ok,
        text: r.ok
          ? `Assigned to ${r.companyName}. Messages to this number now go to ${r.companyName}'s inbox, and replies go out from this number.`
          : (r.error ?? "It could not be assigned."),
      });
    });
  }

  return (
    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
      <label className={labelCls}>Company</label>
      {assignment ? (
        <p className="mt-1 text-[12.5px] text-[var(--color-muted)]">
          Customers who message this number land in{" "}
          <strong className="text-[var(--color-ink)]">{assignment.companyName}</strong>&apos;s inbox,
          and replies go out from it.
          {assignment.legacy && (
            <>
              {" "}
              This comes from the default sender setting; assigning it here writes it down so it
              no longer depends on that setting.
            </>
          )}
        </p>
      ) : (
        <p className="mt-1 text-[12.5px] text-[var(--color-danger)]">
          Not assigned to a company. Messages to this number are kept on System Logs but not put in
          any inbox, and nothing can be sent from it, until it is assigned.
        </p>
      )}

      {!open ? (
        <button type="button" className={`${ghostBtnCls} mt-2`} onClick={() => setOpen(true)}>
          {assignment?.legacy ? "Assign explicitly" : "Change company"}
        </button>
      ) : (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <select
            className={inputCls}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Company for this number"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW_COMPANY}>New company…</option>
          </select>
          {choice === NEW_COMPANY && (
            <input
              className={`${inputCls} w-56`}
              placeholder="Company name, e.g. Hookka"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label="New company name"
            />
          )}
          <button
            type="button"
            className={btnCls}
            disabled={pending || (choice === NEW_COMPANY && newName.trim().length < 2)}
            onClick={assign}
          >
            {pending ? "Assigning…" : "Assign"}
          </button>
        </div>
      )}
      <Result r={result} />
    </div>
  );
}

function NumberCard({
  n,
  managerUrl,
  assignment,
  companies,
}: {
  n: WabaNumber;
  managerUrl: string | null;
  assignment: NumberAssignment | null;
  companies: { id: string; name: string }[];
}) {
  const advice = nextStep(n);
  const connected = n.connection === "CONNECTED";
  // Settings (company + verification + release) opens itself while there is
  // something to do; the business profile is open on a working number.
  const [settingsOpen, setSettingsOpen] = useState(!assignment);
  const [profileOpen, setProfileOpen] = useState(connected);
  const chip = (on: boolean, danger = false) =>
    `flex h-[34px] items-center gap-1.5 rounded-[8px] border px-3 text-[12.5px] font-semibold transition-colors ${
      danger
        ? "border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
        : on
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
          : "border-[var(--color-border)] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
    }`;
  const dot = (tone: string, glyph: string) => (
    <span
      className="grid h-5 w-5 place-items-center rounded-full text-[10px]"
      style={{ background: `var(--color-pastel-${tone})`, color: `var(--color-pastel-${tone}-ink)` }}
    >
      {glyph}
    </span>
  );
  const good = (ok: boolean, warn = false) => (ok ? "green" : warn ? "orange" : "pink");
  const tiles: [string, string, string, string][] = [
    ["Connection", n.connection ?? "unknown", good(n.connection === "CONNECTED", n.connection === "PENDING"), "⇄"],
    ["Verification", n.codeVerification ?? "unknown", n.codeVerification === "VERIFIED" ? "blue" : n.connection === "CONNECTED" ? "blue" : "orange", "✓"],
    ["Quality", n.qualityRating ?? "Not rated", n.qualityRating === "GREEN" ? "green" : n.qualityRating ? "orange" : "surface", "★"],
    ["Daily limit", (n.limitTier ?? "Unset").replace("TIER_", ""), n.limitTier ? "purple" : "orange", "↑"],
  ];
  return (
    <div
      className={`overflow-hidden rounded-[12px] border bg-[var(--color-surface)] ${
        assignment ? "border-[var(--color-border)]" : "border-[#f0c9c9]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3.5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[var(--color-border)] bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-hc-mark.png" alt="" className="h-5 w-5 object-contain" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[16px] font-semibold tabular-nums text-[var(--color-ink)]">{formatPhone(n.displayPhoneNumber)}</div>
          <div className="mt-0.5 truncate text-[12px] text-[var(--color-faint)]">
            {n.verifiedName ?? "—"} · assigned to{" "}
            <b className="font-semibold text-[var(--color-ink)]">{assignment ? assignment.companyName : "Not assigned"}</b>
          </div>
        </div>
        {n.isActive && (
          <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-accent-ink)]">
            ✓ Default
          </span>
        )}
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
            n.connection === "CONNECTED"
              ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
              : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
          }`}
        >
          {n.connection ?? "unknown"}
        </span>
        <button
          type="button"
          aria-label="More"
          onClick={() => setSettingsOpen((v) => !v)}
          className="grid h-8 w-8 place-items-center rounded-[8px] border border-[var(--color-border)] text-[15px] leading-none text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]"
        >
          ⋯
        </button>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pt-3.5">
        {!assignment && (
          <button type="button" className={chip(false, true)} onClick={() => setSettingsOpen(true)}>
            {dot("pink", "⇄")}
            Assign company
          </button>
        )}
        <button type="button" className={chip(settingsOpen)} onClick={() => setSettingsOpen((v) => !v)}>
          {dot("blue", "⚙")}
          Settings
        </button>
        {assignment && (
          <>
            <Link href="/templates" className={chip(false)}>
              {dot("purple", "✎")}
              Manage templates
            </Link>
            <Link href="/settings/library" className={chip(false)}>
              {dot("orange", "▣")}
              Interactive messages
            </Link>
            <button
              type="button"
              className={`${chip(profileOpen)} disabled:cursor-not-allowed disabled:opacity-50`}
              disabled={!connected}
              title={connected ? undefined : "Meta keeps a business profile only for a registered, connected number."}
              onClick={() => setProfileOpen((v) => !v)}
            >
              {dot("pink", "☺")}
              Manage profile
            </button>
          </>
        )}
      </div>

      <div className="px-4 py-3.5">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {tiles.map(([k, v, tone, icon]) => (
            <div
              key={k}
              className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5"
              style={{ background: tone === "surface" ? "var(--color-surface-2)" : `var(--color-pastel-${tone})` }}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-full bg-white text-[12px] font-bold"
                style={{ color: tone === "surface" ? "var(--color-muted)" : `var(--color-pastel-${tone}-ink)` }}
              >
                {icon}
              </span>
              <div className="min-w-0 leading-tight">
                <div className="text-[11px] text-[var(--color-muted)]">{k}</div>
                <div
                  className="truncate text-[13px] font-semibold"
                  style={{ color: tone === "surface" ? "var(--color-ink)" : `var(--color-pastel-${tone}-ink)` }}
                >
                  {v}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-2 font-code text-[11px] text-[var(--color-faint)]">id {n.id}</p>

        {!assignment && (
          <p className="mt-2 rounded-[8px] bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
            This number is not assigned to a company, so messages sent to it do not reach any inbox. System Logs shows what was held back.
          </p>
        )}

        {advice && (
          <p className="mt-2 text-[12.5px] text-[var(--color-muted)]">
            <strong className="text-[var(--color-ink)]">Next:</strong> {advice}
          </p>
        )}

      {/* Meta only keeps a business profile for a registered number. */}
      {connected && profileOpen && <ProfileEditor n={n} />}

      {settingsOpen && (
        <>
          <CompanyAssignment n={n} assignment={assignment} companies={companies} />
          <NumberActions n={n} managerUrl={managerUrl} />
        </>
      )}
      </div>
    </div>
  );
}

export function NumbersClient({
  numbers,
  activeId,
  managerUrl,
  assignments,
  companies,
}: {
  numbers: WabaNumber[];
  activeId: string | null;
  managerUrl: string | null;
  assignments: Record<string, NumberAssignment | null>;
  companies: { id: string; name: string }[];
}) {
  // Bumping this remounts the wizard after "Add another", clearing its state
  // without a router refresh the person did not ask for.
  const [wizardKey, setWizardKey] = useState(0);

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
            is not on this WhatsApp Business Account. Every message will fail until{" "}
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
        numbers.map((n) => (
          <NumberCard
            key={n.id}
            n={n}
            managerUrl={managerUrl}
            assignment={assignments[n.id] ?? null}
            companies={companies}
          />
        ))
      )}

      <div id="add-number" className="scroll-mt-4">
        <AddWizard key={wizardKey} onDone={() => setWizardKey((k) => k + 1)} />
      </div>

      <p className="text-[11px] leading-relaxed text-[var(--color-faint)]">
        Deleting a number permanently is not possible through Meta&apos;s API — it only happens in
        WhatsApp Manager, which asks for your Meta password. Deletion also removes the number&apos;s
        message history, and Meta refuses it for any number that has sent paid messages in the last
        30 days.
      </p>
    </div>
  );
}
