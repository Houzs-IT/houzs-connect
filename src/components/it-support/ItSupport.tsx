"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useShell } from "../shell/ShellProvider";
import { IconLifeBuoy, IconPaperclip } from "../icons";
import { stamp } from "@/lib/format";
import { agoLabel } from "@/lib/i18n/ago";
import { fmt } from "@/lib/i18n/dict";
import {
  IT_KINDS, IT_URGENCIES, isItStatus, itInTab,
  type ItDetail, type ItRequestRow, type ItStep, type ItTab,
} from "@/lib/it-support/shared";
import { CARD, FIELD, FilePicker, LABEL, PRIMARY, SECONDARY, StatusChip, UrgencyChip, itCall } from "./parts";
import { pageBeforeItSupport, refreshItUnread } from "./useItSupportShell";

/**
 * IT Support: report a problem with Connect to IT, follow it, reply, and confirm
 * the fix. Every member has it and sees only their own requests (the server reads
 * who is asking from the session; lib/it-support/hub.ts). One screen, three views
 * chosen by the address so a link can open any of them: the list, ?new=1, and
 * ?request=CONNECT-0001.
 *
 * A list that failed to load is shown as that, never as an empty list.
 */

const ERROR_BOX = "rounded-[8px] border border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2 text-[12.5px] text-[var(--color-ink)]";

function Empty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className={`${CARD} flex flex-col items-center px-6 py-12 text-center`}>
      <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
        <IconLifeBuoy width={22} height={22} />
      </span>
      <p className="text-[14px] font-semibold text-[var(--color-ink)]">{title}</p>
      {body && <p className="mt-1 max-w-md text-[12.5px] text-[var(--color-muted)]">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function RequestList({ onOpen, onNew }: { onOpen: (code: string) => void; onNew: () => void }) {
  const { t } = useShell();
  const [rows, setRows] = useState<ItRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ItTab>("active");

  const load = useCallback(async () => {
    try {
      setRows((await itCall<{ tickets: ItRequestRow[] }>("/tickets")).tickets);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.it.loadFailed);
    }
  }, [t.it.loadFailed]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load on mount
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!rows) {
    return error ? (
      <Empty title={t.it.loadFailed} body={error} action={<button type="button" className={SECONDARY} onClick={() => void load()}>{t.it.retry}</button>} />
    ) : (
      <div className={`${CARD} px-6 py-12 text-center text-[12.5px] text-[var(--color-muted)]`}>...</div>
    );
  }
  if (rows.length === 0) {
    return <Empty title={t.it.emptyTitle} body={t.it.emptyBody} action={<button type="button" className={PRIMARY} onClick={onNew}>{t.it.report}</button>} />;
  }

  const tabs: { key: ItTab; label: string }[] = [
    { key: "all", label: t.it.tabAll }, { key: "active", label: t.it.tabActive }, { key: "resolved", label: t.it.tabResolved },
  ];
  const shown = rows.filter((r) => itInTab(r.status, tab));

  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className={ERROR_BOX}>{t.it.stale} {error}</p>}
      <div role="tablist" className="flex gap-1 border-b border-[var(--color-border)]">
        {tabs.map((x) => {
          const n = rows.filter((r) => itInTab(r.status, x.key)).length;
          const on = tab === x.key;
          return (
            <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(x.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold ${
                on ? "border-[var(--color-accent)] text-[var(--color-ink)]" : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}>
              {x.label}
              <span className="rounded-full bg-[var(--color-surface-2)] px-1.5 text-[11px] tabular-nums text-[var(--color-muted)]">{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className={`${CARD} px-4 py-8 text-center text-[12.5px] text-[var(--color-muted)]`}>{t.it.emptyTab}</p>
      ) : (
        <>
          {/* Desktop: one table. */}
          <div className={`${CARD} hidden overflow-hidden md:block`}>
            <table className="w-full table-fixed text-[13px]">
              <thead className="bg-[var(--color-surface-2)] text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                <tr>
                  <th className="w-[130px] px-4 py-2.5">{t.it.colRequest}</th>
                  <th className="px-3 py-2.5">{t.it.colProblem}</th>
                  <th className="w-[170px] px-3 py-2.5">{t.it.colStatus}</th>
                  <th className="w-[100px] px-3 py-2.5">{t.it.colUrgency}</th>
                  <th className="w-[160px] px-3 py-2.5">{t.it.colHandledBy}</th>
                  <th className="w-[120px] px-4 py-2.5 text-right">{t.it.colUpdated}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code} onClick={() => onOpen(r.code)} className="cursor-pointer border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-2)]">
                    <td className="truncate px-4 py-2.5 font-code text-[12px] font-semibold text-[var(--color-brand)]">{r.code}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`truncate ${r.unread ? "font-bold" : ""} text-[var(--color-ink)]`}>{r.title}</span>
                        {r.unread && <span className="shrink-0 rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[10.5px] font-semibold text-white">{t.it.newReply}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><StatusChip status={r.status} /></td>
                    <td className="px-3 py-2.5"><UrgencyChip priority={r.priority} /></td>
                    <td className="truncate px-3 py-2.5 text-[var(--color-muted)]">{r.assignee_name ?? t.it.notPicked}</td>
                    <td className="px-4 py-2.5 text-right text-[12px] text-[var(--color-faint)]" title={stamp(r.updated_at)}>{agoLabel(t, r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Phone: one card per request. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {shown.map((r) => (
              <li key={r.code}>
                <button type="button" onClick={() => onOpen(r.code)} className={`${CARD} flex w-full flex-col gap-1.5 px-3.5 py-3 text-left`}>
                  <span className="flex w-full items-center gap-2">
                    <span className="font-code text-[11.5px] font-semibold text-[var(--color-brand)]">{r.code}</span>
                    {r.unread && <span className="rounded-full bg-[var(--color-accent)] px-2 py-0.5 text-[10.5px] font-semibold text-white">{t.it.newReply}</span>}
                    <span className="ml-auto"><StatusChip status={r.status} /></span>
                  </span>
                  <span className={`text-[14px] text-[var(--color-ink)] [overflow-wrap:anywhere] ${r.unread ? "font-bold" : "font-medium"}`}>{r.title}</span>
                  <span className="flex w-full items-center gap-2 text-[11.5px] text-[var(--color-faint)]">
                    <UrgencyChip priority={r.priority} />
                    <span className="truncate">{r.assignee_name ?? t.it.notPicked}</span>
                    <span className="ml-auto shrink-0">{agoLabel(t, r.updated_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function NewRequest({ onSent, onCancel }: { onSent: (code: string) => void; onCancel: () => void }) {
  const { t } = useShell();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<string>("bug");
  const [urgency, setUrgency] = useState<string>("medium");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError(t.it.needTitle);
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.set("title", title.trim());
    form.set("description", description.trim());
    form.set("type", kind);
    form.set("priority", urgency);
    form.set("occurred_at", new Date().toISOString());
    const page = pageBeforeItSupport();
    if (page) form.set("page_url", page);
    for (const f of files) form.append("files", f, f.name);
    try {
      const r = await itCall<{ code: string }>("/tickets", { method: "POST", body: form });
      onSent(r.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.it.sendFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} className={`${CARD} flex flex-col gap-4 p-4 sm:p-6`}>
      <label>
        <span className={LABEL}>{t.it.fTitle}</span>
        <input className={`${FIELD} h-[36px]`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t.it.fTitlePh} />
      </label>
      <label>
        <span className={LABEL}>{t.it.fDetails}</span>
        <textarea className={`${FIELD} min-h-32 resize-y py-2`} value={description} maxLength={10000}
          onChange={(e) => setDescription(e.target.value)} placeholder={t.it.fDetailsPh} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className={LABEL}>{t.it.fKind}</span>
          <select className={`${FIELD} h-[36px]`} value={kind} onChange={(e) => setKind(e.target.value)}>
            {IT_KINDS.map((k) => <option key={k} value={k}>{t.it.kind[k]}</option>)}
          </select>
        </label>
        <label>
          <span className={LABEL}>{t.it.fUrgency}</span>
          <select className={`${FIELD} h-[36px]`} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            {IT_URGENCIES.map((u) => <option key={u} value={u}>{t.it.urgency[u]}</option>)}
          </select>
        </label>
      </div>
      <div>
        <span className={LABEL}>{t.it.fShots}</span>
        <FilePicker files={files} onChange={setFiles} />
      </div>
      {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={SECONDARY} onClick={onCancel} disabled={busy}>{t.it.cancel}</button>
        <button type="submit" className={PRIMARY} disabled={busy}>{busy ? t.it.sending : t.it.send}</button>
      </div>
    </form>
  );
}

function OneRequest({ code }: { code: string }) {
  const { t } = useShell();
  const [detail, setDetail] = useState<ItDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"" | "reply" | "confirm">("");
  const [error, setError] = useState<string | null>(null);
  const path = `/tickets/${encodeURIComponent(code)}`;

  const load = useCallback(async () => {
    try {
      setDetail(await itCall<ItDetail>(path));
      setLoadError(null);
      refreshItUnread();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t.it.openFailed);
    }
  }, [path, t.it.openFailed]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load on mount
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!detail) {
    return loadError ? (
      <Empty title={t.it.openFailed} body={loadError} action={<button type="button" className={SECONDARY} onClick={() => void load()}>{t.it.retry}</button>} />
    ) : (
      <div className={`${CARD} px-6 py-12 text-center text-[12.5px] text-[var(--color-muted)]`}>...</div>
    );
  }

  const tk = detail.ticket;
  const closed = tk.status === "closed" || tk.status === "rejected";
  const stepText = (s: ItStep) => {
    if (s.kind === "created") return t.it.stepCreated;
    if (s.kind === "status") return fmt(t.it.stepStatus, { status: s.to_value && isItStatus(s.to_value) ? t.it.status[s.to_value] : s.to_value ?? "" });
    if (s.kind === "assign") return s.to_value ? fmt(t.it.stepAssign, { name: s.to_value }) : t.it.stepUnassign;
    return t.it.stepReply;
  };

  const sendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!reply.trim() && files.length === 0) return setError(t.it.needReply);
    setError(null);
    setBusy("reply");
    const form = new FormData();
    if (reply.trim()) form.set("body", reply.trim());
    for (const f of files) form.append("files", f, f.name);
    try {
      await itCall(`${path}/replies`, { method: "POST", body: form });
      setReply("");
      setFiles([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.it.replyFailed);
    } finally {
      setBusy("");
    }
  };
  const confirmFixed = async () => {
    if (busy) return;
    setError(null);
    setBusy("confirm");
    try {
      await itCall(`${path}/confirm`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.it.saveFailed);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {loadError && <p role="alert" className={ERROR_BOX}>{t.it.stale} {loadError}</p>}
      <section className={`${CARD} flex flex-col gap-2.5 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-code text-[12.5px] font-semibold text-[var(--color-brand)]">{tk.code}</span>
          <StatusChip status={tk.status} />
          <UrgencyChip priority={tk.priority} />
          <span className="text-[12px] text-[var(--color-muted)]">{tk.assignee_name ? fmt(t.it.handledBy, { name: tk.assignee_name }) : t.it.notPicked}</span>
        </div>
        <h2 className="text-[17px] font-bold text-[var(--color-ink)] [overflow-wrap:anywhere]">{tk.title}</h2>
        {tk.description && <p className="whitespace-pre-wrap text-[13px] text-[var(--color-muted)] [overflow-wrap:anywhere]">{tk.description}</p>}
        {tk.page_url && (
          <p className="text-[12px] text-[var(--color-faint)]">
            {t.it.page}: <a className="text-[var(--color-accent)] hover:underline [overflow-wrap:anywhere]" href={tk.page_url}>{tk.page_url}</a>
          </p>
        )}
        {tk.status === "resolved" && (
          <div className="mt-1 flex flex-wrap items-center gap-3 rounded-[8px] border border-[var(--color-success)]/30 bg-[var(--color-success-soft)] px-3 py-2.5">
            <span className="min-w-[220px] flex-1 text-[13px] text-[var(--color-ink)]">{t.it.doneNote}</span>
            <button type="button" className={PRIMARY} disabled={busy !== ""} onClick={() => void confirmFixed()}>
              {busy === "confirm" ? t.it.confirming : t.it.confirm}
            </button>
          </div>
        )}
      </section>

      <ul className={`${CARD} flex flex-col gap-4 p-4 sm:p-5`}>
        {detail.events.map((s) => (
          <li key={s.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-semibold text-[var(--color-ink)]">{s.author_kind === "reporter" ? t.it.you : s.author_name}</span>
              <span className="text-[var(--color-muted)]">{stepText(s)}</span>
              <span className="text-[11px] text-[var(--color-faint)]" title={stamp(s.created_at)}>{agoLabel(t, s.created_at)}</span>
            </div>
            {s.body && (
              <p className="whitespace-pre-wrap rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-[13px] text-[var(--color-ink)] [overflow-wrap:anywhere]">{s.body}</p>
            )}
            {s.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {s.attachments.map((a) => {
                  const href = `/api/it-support/attachments/${a.id}`;
                  return a.mime.startsWith("image/") ? (
                    <a key={a.id} href={href} target="_blank" rel="noreferrer" title={a.filename} className="block h-20 w-20 overflow-hidden rounded-[8px] border border-[var(--color-border)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={href} alt={a.filename} className="h-full w-full object-cover" />
                    </a>
                  ) : (
                    <a key={a.id} href={href} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] px-2.5 py-1.5 text-[12px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]">
                      <IconPaperclip width={13} height={13} /> {a.filename}
                    </a>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>

      {closed ? (
        <p className={`${CARD} px-4 py-3 text-[13px] text-[var(--color-muted)]`}>{t.it.closedNote}</p>
      ) : (
        <form onSubmit={sendReply} className={`${CARD} flex flex-col gap-3 p-4 sm:p-5`}>
          <textarea className={`${FIELD} min-h-24 resize-y py-2`} value={reply} maxLength={10000} aria-label={t.it.replyPh}
            placeholder={t.it.replyPh} onChange={(e) => setReply(e.target.value)} />
          <FilePicker files={files} onChange={setFiles} />
          <div className="flex justify-end">
            <button type="submit" className={PRIMARY} disabled={busy !== ""}>{busy === "reply" ? t.it.sending : t.it.sendReply}</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
    </div>
  );
}

export function ItSupport({ connected }: { connected: boolean }) {
  const { t } = useShell();
  const router = useRouter();
  const params = useSearchParams();
  const code = params.get("request") ?? "";
  const isNew = params.get("new") === "1";
  const go = (q: string) => router.push(`/it-support${q}`);

  const heading = isNew ? t.it.report : code ? t.it.requestTitle : t.nav.itSupport;
  const sub = isNew ? t.it.newSub : code ? "" : t.it.subtitle;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {(isNew || code) && (
            <Link href="/it-support" className="mb-1 inline-block text-[12.5px] font-semibold text-[var(--color-accent)] hover:underline">
              ‹ {t.it.back}
            </Link>
          )}
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">{heading}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{sub}</p>}
        </div>
        {connected && !isNew && !code && (
          <button type="button" className={PRIMARY} onClick={() => go("?new=1")}>{t.it.report}</button>
        )}
      </header>

      {!connected ? (
        <Empty title={t.it.notConnected} body={t.it.notConnectedBody} />
      ) : isNew ? (
        <NewRequest onCancel={() => go("")} onSent={(c) => go(`?request=${encodeURIComponent(c)}`)} />
      ) : code ? (
        <OneRequest key={code} code={code} />
      ) : (
        <RequestList onOpen={(c) => go(`?request=${encodeURIComponent(c)}`)} onNew={() => go("?new=1")} />
      )}
    </div>
  );
}
