"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { initials, tint } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import type { AccessRequest } from "@/lib/access-requests";
import { approveAsManager, approveFinal, rejectRequest } from "./access-actions";

const ROLES = ["AGENT", "SALES", "MANAGER", "ADMIN", "VIEWER", "DRIVER"];

/** The "Access requests" block at the top of Team: two steps, then access. */
export function AccessRequests({
  requests,
  companies,
  canDept,
  canFinal,
}: {
  requests: AccessRequest[];
  companies: { id: string; name: string }[];
  canDept: boolean;
  canFinal: boolean;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.set;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState<AccessRequest | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);
  const [role, setRole] = useState("AGENT");
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) return setError(res.error ?? "Could not do that.");
      done?.();
      router.refresh();
    });

  const chip = (state: "done" | "wait" | "later", label: string) => (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${
        state === "done"
          ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
          : state === "wait"
            ? "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]"
            : "bg-[var(--color-surface-2)] text-[var(--color-faint)]"
      }`}
    >
      {state === "done" ? "✓" : state === "wait" ? "◷" : "·"} {label}
    </span>
  );

  return (
    <section className="overflow-hidden rounded-[12px] border border-[#f0dcb4] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 bg-[linear-gradient(90deg,#ffffff,#fdf6ea)] px-4 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-pastel-orange)] text-[14px] font-bold text-[var(--color-pastel-orange-ink)]">+</span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[var(--color-ink)]">{fmt(L.reqTitle, { n: requests.length })}</div>
          <div className="text-[12px] text-[var(--color-faint)]">{L.reqSub}</div>
        </div>
      </div>
      {requests.map((r) => {
        const c = tint(r.email);
        const managerDone = r.status === "pending_final";
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold"
              style={{ background: `color-mix(in srgb, ${c} 14%, white)`, color: c }}
            >
              {initials(r.name)}
            </span>
            <div className="min-w-[180px] flex-1">
              <div className="text-[13.5px] font-semibold text-[var(--color-ink)]">{r.name}</div>
              <div className="truncate font-code text-[11.5px] text-[var(--color-faint)]">{r.email}</div>
            </div>
            <div className="min-w-[160px] flex-1">
              <div className="text-[13px] text-[var(--color-ink)]">{r.department ?? "—"}</div>
              <div className="truncate text-[11.5px] text-[var(--color-faint)]">{r.note ?? r.phone ?? ""}</div>
            </div>
            <div className="flex gap-1.5">
              {chip(managerDone ? "done" : "wait", r.managerName && managerDone ? `${L.deptManager} · ${r.managerName}` : L.deptManager)}
              {chip(managerDone ? "wait" : "later", L.superAdmin)}
            </div>
            <div className="ml-auto flex gap-2">
              {((r.status === "pending_manager" && canDept) || canFinal) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setRejecting(r)}
                  className="h-[32px] rounded-[8px] bg-[var(--color-danger-soft)] px-3 text-[12.5px] font-semibold text-[var(--color-danger)] disabled:opacity-40"
                >
                  {L.reject}
                </button>
              )}
              {r.status === "pending_manager" && canDept && !canFinal && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => approveAsManager(r.id))}
                  className="h-[32px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] disabled:opacity-40"
                >
                  {L.approveMgr}
                </button>
              )}
              {canFinal && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setSetting(r);
                    setRole("AGENT");
                    setPicked(companies[0] ? [companies[0].id] : []);
                  }}
                  className="h-[32px] rounded-[8px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-white shadow-[var(--shadow-primary)] disabled:opacity-40"
                >
                  {L.approveSet}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-4 py-2.5 text-[12px] text-[var(--color-faint)]">{L.reqFoot}</p>
      {error && <p className="px-4 pb-3 text-[12.5px] text-[var(--color-danger)]">{error}</p>}

      <ActionDialog open={!!setting} title={setting ? fmt(L.setAccess, { name: setting.name }) : ""} onClose={() => setSetting(null)}>
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink)]">{L.role}</div>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`h-[30px] rounded-full border px-3 text-[12px] font-semibold ${
                    role === r ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]" : "border-[var(--color-border)] text-[var(--color-ink)]"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink)]">{L.pickCompanies}</div>
            {companies.map((c) => (
              <label key={c.id} className="flex items-center gap-2 py-1 text-[13px] text-[var(--color-ink)]">
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {c.name}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setSetting(null)} className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold">
              {L.cancel}
            </button>
            <button
              type="button"
              disabled={pending || !picked.length}
              onClick={() => setting && run(() => approveFinal(setting.id, role, picked), () => setSetting(null))}
              className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {L.approveSet}
            </button>
          </div>
        </div>
      </ActionDialog>

      <ActionDialog open={!!rejecting} title={rejecting ? fmt(L.rejectTitle, { name: rejecting.name }) : ""} onClose={() => setRejecting(null)}>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={L.reason}
          className="mb-3 h-[36px] w-full rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setRejecting(null)} className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold">
            {L.cancel}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              rejecting &&
              run(
                () => rejectRequest(rejecting.id, reason),
                () => {
                  setRejecting(null);
                  setReason("");
                }
              )
            }
            className="h-[34px] rounded-[8px] bg-[var(--color-danger)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {L.reject}
          </button>
        </div>
      </ActionDialog>
    </section>
  );
}
