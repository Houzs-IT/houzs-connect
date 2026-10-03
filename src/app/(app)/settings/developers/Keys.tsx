"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm, ActionDialog } from "@/components/ActionConfirm";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { newApiKey, revokeApiKey } from "./actions";

type Row = { id: string; name: string; prefix: string; created: string; lastUsed: string | null; revoked: boolean; createdBy: string | null };

/** The key list, "New API key" (shown once), and Revoke. */
export function Keys({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.set;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-pastel-blue)] text-[12px] font-bold text-[var(--color-pastel-blue-ink)]">‹›</span>
        <div className="min-w-0 flex-1 text-[14px] font-semibold text-[var(--color-ink)]">API keys</div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setKey(null);
              setName("");
              setError(null);
            }}
            className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)]"
          >
            + {L.devNew}
          </button>
        )}
      </div>
      {!canManage && <p className="border-t border-[var(--color-border-subtle)] px-4 py-2.5 text-[12px] text-[var(--color-faint)]">{L.devOnly}</p>}
      {rows.length === 0 && <p className="border-t border-[var(--color-border-subtle)] px-4 py-4 text-[12.5px] text-[var(--color-faint)]">{L.noKeys}</p>}
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border-subtle)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className={`text-[13.5px] font-semibold ${r.revoked ? "text-[var(--color-faint)] line-through" : "text-[var(--color-ink)]"}`}>{r.name}</div>
            <div className="text-[11.5px] text-[var(--color-faint)]">
              <span className="font-code">{r.prefix}…</span> · {r.created}
              {r.createdBy ? ` · ${r.createdBy}` : ""}
            </div>
          </div>
          <span className="text-[12px] text-[var(--color-muted)]">{r.lastUsed ? fmt(L.lastUsed, { when: r.lastUsed }) : L.neverUsed}</span>
          {r.revoked ? (
            <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--color-muted)]">{L.revokedL}</span>
          ) : (
            canManage && (
              <button
                type="button"
                onClick={() => setRevoking(r)}
                className="h-[30px] rounded-[8px] bg-[var(--color-danger-soft)] px-3 text-[12.5px] font-semibold text-[var(--color-danger)]"
              >
                {L.revoke}
              </button>
            )
          )}
        </div>
      ))}

      <ActionDialog open={open} title={L.devNew} onClose={() => setOpen(false)}>
        {key ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[var(--color-warning)]">{L.keyCreated}</p>
            <code className="block break-all rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2.5 font-code text-[12.5px] text-[var(--color-ink)]">{key}</code>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(key).then(() => setCopied(true));
                }}
                className="h-[34px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] font-semibold"
              >
                {copied ? L.copied : L.copy}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.refresh();
                }}
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white"
              >
                {L.done}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={L.keyNamePh}
              aria-label={L.keyName}
              className="h-[36px] rounded-[8px] border border-[var(--color-border)] px-3 text-[13px] outline-none focus:border-[var(--color-accent)]"
            />
            {error && <p className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() =>
                  start(async () => {
                    const res = await newApiKey(name);
                    if (!res.ok || !res.key) return setError(res.error ?? "Could not create the key.");
                    setKey(res.key);
                    setCopied(false);
                  })
                }
                className="h-[34px] rounded-[8px] bg-[var(--color-accent)] px-3.5 text-[13px] font-semibold text-white disabled:opacity-40"
              >
                {L.devNew}
              </button>
            </div>
          </div>
        )}
      </ActionDialog>

      <ActionConfirm
        open={!!revoking}
        title={revoking ? fmt(L.revokeTitle, { name: revoking.name }) : ""}
        confirmLabel={L.revoke}
        busy={pending}
        danger
        onCancel={() => setRevoking(null)}
        onConfirm={() =>
          start(async () => {
            if (revoking) await revokeApiKey(revoking.id);
            setRevoking(null);
            router.refresh();
          })
        }
      >
        <p>{L.revokeBody}</p>
      </ActionConfirm>
    </section>
  );
}
