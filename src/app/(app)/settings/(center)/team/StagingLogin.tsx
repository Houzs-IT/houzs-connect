"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useShell } from "@/components/shell/ShellProvider";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fmt } from "@/lib/i18n/dict";
import { STAGING_ROLE_NAMES } from "@/lib/staging-logins";
import { createStagingLogin, type StagingLoginResult } from "./staging-login-actions";

const ROLES = Object.keys(STAGING_ROLE_NAMES);
const field =
  "h-[34px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 text-[12.5px] text-[var(--color-ink)] outline-none";

/** "Create staging login": rendered by the Team page only on the staging Worker. */
export function StagingLogin() {
  const { t } = useShell();
  const L = t.set;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("AGENT");
  const [result, setResult] = useState<StagingLoginResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function reset() {
    setEmail("");
    setName("");
    setRole("AGENT");
    setResult(null);
    setCopied(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => setResult(await createStagingLogin({ email, name, role })));
  }

  async function copy(password: string) {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {}
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          // The password is shown once: closing the panel forgets it.
          if (open) reset();
          setOpen((v) => !v);
        }}
        className="flex h-[34px] items-center gap-1.5 rounded-[8px] border border-amber-400 bg-amber-50 px-3.5 text-[13px] font-semibold text-amber-900 hover:bg-amber-100"
      >
        + {L.stagingLogin}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-[320px] rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 shadow-[var(--shadow-popover)]">
          {result?.ok ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[12.5px] leading-snug text-[var(--color-muted)]">
                {fmt(result.reset ? L.stagingReset : L.stagingDone, { email: result.email })}
              </p>
              <input readOnly value={result.password} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono`} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => copy(result.password)}
                  className="h-[34px] flex-1 rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white hover:bg-[var(--color-accent-hi)]"
                >
                  {copied ? L.inviteCopied : L.stagingCopy}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                >
                  {L.stagingAnother}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-2.5">
              <p className="text-[12.5px] leading-snug text-[var(--color-muted)]">{L.stagingLoginBody}</p>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.stagingEmail}
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.stagingName}
                <input value={name} onChange={(e) => setName(e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] font-semibold text-[var(--color-ink)]">
                {L.stagingRole}
                <SearchableSelect
                  value={role}
                  onChange={(v) => setRole(v)}
                  aria-label={L.stagingRole}
                  className={field}
                  options={ROLES.map((r) => ({ value: r, label: t.role[r] ?? r }))}
                />
              </label>
              {result && !result.ok ? <p className="text-[12px] text-red-600">{result.error}</p> : null}
              <button
                type="submit"
                disabled={pending}
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white hover:bg-[var(--color-accent-hi)] disabled:opacity-60"
              >
                {pending ? L.stagingCreating : L.stagingCreate}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
