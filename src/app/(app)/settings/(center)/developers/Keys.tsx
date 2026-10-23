"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm, ActionDialog } from "@/components/ActionConfirm";
import { DataTable, type DataColumn, type DataRow } from "@/components/DataTable";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { newApiKey, revokeApiKey } from "./actions";

type Row = {
  id: string;
  name: string;
  prefix: string;
  created: string;
  /** Epoch ms, for sorting. */
  createdAt: number;
  lastUsed: string | null;
  /** Epoch ms, for sorting; null when never used. */
  lastUsedAt: number | null;
  revoked: boolean;
  createdBy: string | null;
};

/** The key list (search, sort, filter), "New API key" (shown once), and Revoke. */
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

  const columns: DataColumn[] = [
    { key: "name", label: L.keyName, filter: false },
    { key: "created", label: t.contacts.colCreated, filter: false },
    { key: "lastUsed", label: fmt(L.lastUsed, { when: "" }).trim() },
    { key: "status", label: t.logs.colStatus },
    ...(canManage ? [{ key: "actions", label: "", align: "right" as const, sort: false, filter: false }] : []),
  ];
  const table: DataRow[] = rows.map((r) => ({
    id: r.id,
    search: [r.prefix, r.createdBy].filter(Boolean).join(" "),
    // Never used sorts as the oldest use.
    sort: { name: r.name, created: r.createdAt, lastUsed: r.lastUsedAt ?? 0, status: r.revoked ? 1 : 0 },
    text: {
      name: r.name,
      created: r.created,
      lastUsed: r.lastUsed ?? L.neverUsed,
      status: r.revoked ? L.revokedL : t.tf.inUse,
    },
    cells: {
      name: (
        <div className="min-w-0">
          <div className={`truncate font-semibold ${r.revoked ? "text-[var(--color-faint)] line-through" : "text-[var(--color-ink)]"}`}>{r.name}</div>
          <div className="font-code text-[11.5px] text-[var(--color-faint)]">{r.prefix}…</div>
        </div>
      ),
      created: (
        <div className="whitespace-nowrap">
          <div className="text-[var(--color-ink)]">{r.created}</div>
          {r.createdBy && <div className="text-[11.5px] text-[var(--color-faint)]">{r.createdBy}</div>}
        </div>
      ),
      lastUsed: <span className="whitespace-nowrap text-[12.5px] text-[var(--color-muted)]">{r.lastUsed ?? L.neverUsed}</span>,
      status: r.revoked ? (
        <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--color-muted)]">{L.revokedL}</span>
      ) : (
        <span className="rounded-full bg-[var(--color-pastel-green)] px-2 py-0.5 text-[10.5px] font-semibold uppercase text-[var(--color-pastel-green-ink)]">{t.tf.inUse}</span>
      ),
      actions: r.revoked ? <span /> : (
        <button
          type="button"
          onClick={() => setRevoking(r)}
          className="h-[30px] rounded-[8px] bg-[var(--color-danger-soft)] px-3 text-[12.5px] font-semibold text-[var(--color-danger)]"
        >
          {L.revoke}
        </button>
      ),
    },
  }));

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-pastel-blue)] text-[12px] font-bold text-[var(--color-pastel-blue-ink)]">‹›</span>
        <h3 className="min-w-0 flex-1 text-[14px] font-semibold text-[var(--color-ink)]">API keys</h3>
      </div>
      {!canManage && <p className="text-[12px] text-[var(--color-faint)]">{L.devOnly}</p>}
      <DataTable
        columns={columns}
        rows={table}
        minWidth={640}
        stateKey="settings-api-keys"
        empty={L.noKeys}
        toolbar={
          canManage && (
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
          )
        }
      />

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
