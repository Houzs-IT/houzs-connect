"use client";

// The Broadcast picker: a scrollable address book on the left with search, a
// tag filter and a checkbox per contact; the message on the right — the number
// it leaves from, the approved template, and a live phone preview. The bottom
// bar says how many are picked and sends to all of them in one click.
//
// A broadcast is a campaign with a hand-picked audience: the Send button calls
// `sendBroadcast`, which builds a one-off campaign with `audience.kind === "ids"`
// and drives the same chunked sender the Campaigns wizard uses. Nothing about
// delivery is reimplemented here.

import { useMemo, useState } from "react";
import { ActionDialog } from "@/components/ActionConfirm";
import { IconSearch } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";
import { formatPhone, initials, tint } from "@/lib/format";
import type { VarBinding } from "@/lib/automation/vars";
import { sendBroadcast, type BroadcastContact } from "../campaigns/actions";
import { PhonePreview } from "../campaigns/PhonePreview";
import type { CampaignTemplate, SendResult } from "../campaigns/spec";

const card = "rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)]";
const inputCls =
  "h-[36px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";
const btn =
  "flex h-[34px] items-center rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-[13px] font-semibold text-[var(--color-ink)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)] disabled:opacity-40";
const btnPrimary =
  "flex h-[38px] items-center gap-2 rounded-[8px] bg-[var(--color-accent)] px-5 text-[13px] font-semibold text-white shadow-[var(--shadow-primary)] hover:bg-[var(--color-accent-hi)] disabled:opacity-40 disabled:shadow-none";

const COPY = {
  en: {
    title: "Broadcast",
    sub: "Pick the people, pick one approved message, send it to all of them.",
    searchPh: "Search name or number",
    allTags: "All tags",
    selectAll: "Select all",
    clear: "Clear",
    noContacts: "No contacts match.",
    blocked: "Blocked",
    sendingFrom: "Sending from",
    noNumber: "No WhatsApp number is set for this company yet.",
    message: "Message",
    pickTpl: "Pick an approved template",
    noTpl: "No approved templates yet. Add one on the Templates page first.",
    preview: "Preview",
    previewEmpty: "Pick a template to preview it.",
    varNote: "{{n}} fills in per contact from their saved fields.",
    selected: (n: number) => `${n} selected`,
    send: "Send Broadcast",
    notLive: "Test mode — messages are not actually delivered.",
    confirmTitle: "Send this broadcast?",
    willGet: (n: number) => `${n} ${n === 1 ? "contact" : "contacts"} will receive this message now.`,
    tpl: "Template",
    cancel: "Cancel",
    confirmSend: "Yes, send now",
    sending: "Sending…",
    doneOk: (sent: number, failed: number) =>
      failed > 0 ? `Sent to ${sent}, ${failed} failed.` : `Sent to ${sent}.`,
    pickSome: "Pick at least one contact and one template.",
  },
  zh: {
    title: "广播",
    sub: "选好联系人，选一条已批准的消息，一次发给全部。",
    searchPh: "搜索姓名或号码",
    allTags: "全部标签",
    selectAll: "全选",
    clear: "清除",
    noContacts: "没有符合的联系人。",
    blocked: "已拉黑",
    sendingFrom: "发送号码",
    noNumber: "这个公司还没有设置 WhatsApp 号码。",
    message: "消息",
    pickTpl: "选择已批准的模板",
    noTpl: "还没有已批准的模板，请先到「模板」页面添加。",
    preview: "预览",
    previewEmpty: "选择模板后在此预览。",
    varNote: "{{n}} 会按每位联系人的字段自动填入。",
    selected: (n: number) => `已选 ${n} 位`,
    send: "发送广播",
    notLive: "测试模式——消息不会真正发出。",
    confirmTitle: "确认发送这条广播？",
    willGet: (n: number) => `将立即向 ${n} 位联系人发送这条消息。`,
    tpl: "模板",
    cancel: "取消",
    confirmSend: "确认发送",
    sending: "发送中…",
    doneOk: (sent: number, failed: number) =>
      failed > 0 ? `已发送 ${sent} 位，${failed} 位失败。` : `已发送 ${sent} 位。`,
    pickSome: "请至少选择一位联系人和一个模板。",
  },
};

export function BroadcastClient({
  contacts,
  tags,
  templates,
  channelLabel,
  live,
}: {
  contacts: BroadcastContact[];
  tags: string[];
  templates: CampaignTemplate[];
  channelLabel: string;
  live: boolean;
}) {
  const { lang } = useShell();
  const T = COPY[lang];

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tplKey, setTplKey] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const chosen = useMemo(
    () => templates.find((t) => `${t.name}::${t.language}` === tplKey) ?? null,
    [templates, tplKey],
  );

  // Who the list shows: name/phone search plus the tag filter. Blocked contacts
  // still show — greyed and unselectable — so nobody wonders where they went.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (tagFilter && !c.tags.includes(tagFilter)) return false;
      if (!q) return true;
      return (c.name ?? "").toLowerCase().includes(q) || c.phone.toLowerCase().includes(q);
    });
  }, [contacts, query, tagFilter]);

  const selectableIds = useMemo(() => filtered.filter((c) => !c.blocked).map((c) => c.id), [filtered]);
  const allPicked = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPicked) selectableIds.forEach((id) => next.delete(id));
      else selectableIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const count = selected.size;
  const canSend = count > 0 && !!chosen && !!channelLabel;

  async function doSend() {
    if (!chosen) return;
    setSending(true);
    setResult(null);
    const bindings: VarBinding[] = chosen.bindings ?? [];
    const res = await sendBroadcast({
      contactIds: [...selected],
      templateName: chosen.name,
      templateLang: chosen.language,
      templateBody: chosen.body,
      bindings,
      confirm: "SEND",
    });
    setSending(false);
    setResult(res);
    if (res.ok) {
      setConfirmOpen(false);
      setSelected(new Set());
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-col gap-4 px-5 py-5">
      <header>
        <h1 className="text-[18px] font-semibold text-[var(--color-ink)]">{T.title}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-faint)]">{T.sub}</p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
        {/* ── Left: the address book ── */}
        <section className={`flex min-h-0 flex-col ${card}`}>
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] p-3">
            <div className="relative min-w-[200px] flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-faint)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={T.searchPh}
                className={inputCls}
              />
            </div>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="h-[36px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">{T.allTags}</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button type="button" className={btn} onClick={toggleAll} disabled={selectableIds.length === 0}>
              {T.selectAll}
            </button>
            {count > 0 && (
              <button type="button" className={btn} onClick={() => setSelected(new Set())}>
                {T.clear}
              </button>
            )}
          </div>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">{T.noContacts}</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {filtered.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <li key={c.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${
                          c.blocked ? "cursor-not-allowed opacity-45" : "hover:bg-[var(--color-surface-2)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={c.blocked}
                          onChange={() => toggle(c.id)}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                        <span
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                          style={{ background: tint(c.id) }}
                        >
                          {initials(c.name ?? c.phone)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--color-ink)]">
                            {c.name ?? formatPhone(c.phone)}
                          </span>
                          <span className="block truncate text-[12px] text-[var(--color-faint)]">
                            {formatPhone(c.phone)}
                            {c.tags.length > 0 && <span className="ml-2">· {c.tags.join(", ")}</span>}
                          </span>
                        </span>
                        {c.blocked && (
                          <span className="shrink-0 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-faint)]">
                            {T.blocked}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ── Right: the message ── */}
        <aside className="flex min-h-0 flex-col gap-4">
          <div className={`p-4 ${card}`}>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">
              {T.sendingFrom}
            </div>
            {channelLabel ? (
              <p className="text-[13px] font-medium text-[var(--color-ink)]">{channelLabel}</p>
            ) : (
              <p className="text-[13px] text-[var(--color-danger)]">{T.noNumber}</p>
            )}
            {channelLabel && !live && (
              <p className="mt-2 rounded-[8px] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12px] text-[var(--color-faint)]">
                {T.notLive}
              </p>
            )}
          </div>

          <div className={`flex min-h-0 flex-col p-4 ${card}`}>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">
              {T.message}
            </div>
            {templates.length === 0 ? (
              <p className="rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px] text-[var(--color-faint)]">
                {T.noTpl}
              </p>
            ) : (
              <select
                value={tplKey}
                onChange={(e) => setTplKey(e.target.value)}
                className="h-[36px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">{T.pickTpl}</option>
                {templates.map((t) => (
                  <option key={`${t.name}::${t.language}`} value={`${t.name}::${t.language}`}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
            )}

            <div className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-faint)]">
              {T.preview}
            </div>
            <PhonePreview
              className="min-h-[260px]"
              bizName="Houzs Century"
              text={chosen?.body ?? null}
              time="10:00"
              empty={T.previewEmpty}
            />
            {chosen && chosen.body.includes("{{") && (
              <p className="mt-2 text-[11.5px] text-[var(--color-faint)]">{T.varNote}</p>
            )}
          </div>
        </aside>
      </div>

      {/* ── Bottom bar ── */}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-primary)]">
        <div className="text-[13px] font-semibold text-[var(--color-ink)]">{T.selected(count)}</div>
        <div className="flex items-center gap-3">
          {result && !result.ok && (
            <span className="text-[12.5px] text-[var(--color-danger)]">{result.error}</span>
          )}
          {result && result.ok && (
            <span className="text-[12.5px] text-[var(--color-ink)]">
              {T.doneOk(result.sent ?? 0, result.failed ?? 0)}
            </span>
          )}
          <button
            type="button"
            className={btnPrimary}
            disabled={!canSend}
            onClick={() => {
              setResult(null);
              setConfirmOpen(true);
            }}
          >
            {T.send}
          </button>
        </div>
      </div>

      <ActionDialog open={confirmOpen} title={T.confirmTitle} onClose={() => !sending && setConfirmOpen(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-[var(--color-ink)]">{T.willGet(count)}</p>
          <dl className="rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 text-[12.5px]">
            <div className="flex justify-between">
              <dt className="text-[var(--color-faint)]">{T.tpl}</dt>
              <dd className="font-medium text-[var(--color-ink)]">
                {chosen ? `${chosen.name} (${chosen.language})` : "—"}
              </dd>
            </div>
            <div className="mt-1 flex justify-between">
              <dt className="text-[var(--color-faint)]">{T.sendingFrom}</dt>
              <dd className="font-medium text-[var(--color-ink)]">{channelLabel || "—"}</dd>
            </div>
          </dl>
          {result && !result.ok && (
            <p className="rounded-[8px] bg-[var(--color-danger-soft)] px-3 py-2 text-[12px] text-[var(--color-danger)]">
              {result.error}
            </p>
          )}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setConfirmOpen(false)} disabled={sending}>
              {T.cancel}
            </button>
            <button type="button" className={btnPrimary} onClick={() => void doSend()} disabled={sending}>
              {sending ? T.sending : T.confirmSend}
            </button>
          </div>
        </div>
      </ActionDialog>
    </div>
  );
}
