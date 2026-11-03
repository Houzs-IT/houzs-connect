import Link from "next/link";
import { initials, tint, waIdentifier } from "@/lib/format";
import { fmt } from "@/lib/i18n/dict";
import { getDict } from "@/lib/i18n/server";
import { CopyButton } from "./CopyButton";
import { RemarksBox } from "./RemarksBox";
import { ProfileEditor } from "./ProfileEditor";
import { ConversationMenu } from "./ConversationMenu";
import { FieldList, PanelTabs } from "./PanelTabs";
import { SubmitSelect } from "./SubmitSelect";
import {
  addChatMember,
  removeChatMember,
  setAutomationRunPaused,
  setContactMarketingOptIn,
} from "@/app/(app)/inbox/actions";
import { assignConversation, toggleConversationTag } from "@/app/actions";
import type { AutomationProgress } from "@/lib/automation/progress";
import type { Dict } from "@/lib/i18n/dict";

type Field = { key: string; name: string };
type NamedColor = { id: string; name: string; color: string };
type Named = { id: string; name: string };
/** A colleague watching this conversation — see conversationMember in schema.ts. */
type ChatMember = { id: string; name: string; addedBy: string | null; addedAt: string };
type Payment = {
  id: string;
  amount: number | null;
  currency: string;
  method: string | null;
  referenceNo: string | null;
  status: string;
  createdAt: string;
};
/** First reply to the customer's first message in the loaded thread. */
export type FirstReply = { seconds: number; onTime: boolean } | null;

const SELECT =
  "h-[30px] w-full min-w-0 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[12.5px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-ring)]";
const EYEBROW =
  "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]";

function money(n: number | null | undefined, currency = "MYR") {
  if (n == null || !Number.isFinite(n)) return "—";
  const sym = currency === "MYR" ? "RM" : currency;
  return `${sym} ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${h}h ${pad(m)}m ${pad(s)}s`;
}

function Badge({ tone, children }: { tone: "success" | "warning" | "danger" | "primary" | "neutral"; children: React.ReactNode }) {
  const cls = {
    success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    primary: "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]",
    neutral: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  }[tone];
  return (
    <span className={`whitespace-nowrap rounded-full px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] ${cls}`}>
      {children}
    </span>
  );
}

export async function ContactPanel({
  conversationId,
  contactName,
  phone,
  agentId,
  departmentId,
  tags,
  fields,
  values,
  members,
  chatMembers,
  departments,
  allTags,
  marketingOptIn,
  contactId,
  remarks,
  email,
  starred,
  firstReply,
  payments,
  automation,
}: {
  conversationId: string;
  contactName: string;
  phone: string;
  agentId: string | null;
  departmentId: string | null;
  tags: NamedColor[];
  fields: Field[];
  values: Record<string, string>;
  members: Named[];
  chatMembers: ChatMember[];
  departments: Named[];
  allTags: NamedColor[];
  marketingOptIn: boolean;
  contactId: string;
  remarks: string;
  email: string;
  starred: boolean;
  firstReply: FirstReply;
  payments: Payment[];
  automation: AutomationProgress | null;
}) {
  const t = await getDict();
  const s = t.service;
  const id = waIdentifier(phone);

  // The picker offers the company roster minus whoever is already watching.
  const onConversation = new Set(chatMembers.map((m) => m.id));
  const candidates = members.filter((m) => !onConversation.has(m.id));
  const activeTagIds = new Set(tags.map((tg) => tg.id));
  const addableTags = allTags.filter((tg) => !activeTagIds.has(tg.id));

  const populated = fields.filter((f) => values[f.key]);

  // ── Overview ──────────────────────────────────────────────────────────
  const overview = (
    <>
      <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)]">
        <div className={`border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2 ${EYEBROW}`}>
          {s.assignSla}
        </div>
        <div className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-y-[9px] px-3 py-2.5 text-[12.5px]">
          <span className="text-[var(--color-muted)]">{s.agent}</span>
          <form action={assignConversation}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <SubmitSelect name="assignedAgentId" defaultValue={agentId ?? ""} className={SELECT} aria-label={s.agent}>
              <option value="">{s.unassignedOpt}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </SubmitSelect>
          </form>

          <span className="text-[var(--color-muted)]">{s.department}</span>
          <form action={assignConversation}>
            <input type="hidden" name="conversationId" value={conversationId} />
            <SubmitSelect name="assignedDepartmentId" defaultValue={departmentId ?? ""} className={SELECT} aria-label={s.department}>
              <option value="">{s.none}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </SubmitSelect>
          </form>

          <span className="text-[var(--color-muted)]">{s.firstReply}</span>
          <span className="flex items-center gap-1.5 tabular-nums">
            {firstReply ? (
              <>
                {duration(firstReply.seconds)}
                <Badge tone={firstReply.onTime ? "success" : "danger"}>
                  {firstReply.onTime ? s.onTime : s.late}
                </Badge>
              </>
            ) : (
              <span className="text-[var(--color-faint)]">{s.noReplyYet}</span>
            )}
          </span>

          {/* Watchers: who else was pulled in. Ownership stays with the agent. */}
          <span className="self-start pt-[5px] text-[var(--color-muted)]">{s.watchers}</span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pt-[3px]">
            {chatMembers.length === 0 ? (
              <span className="text-[var(--color-faint)]">{s.nobody}</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {chatMembers.map((m) => (
                  <form
                    key={m.id}
                    action={removeChatMember}
                    className="flex items-center gap-1 rounded-[6px] bg-[var(--color-accent-soft)] py-0.5 pl-2 pr-1 text-[11.5px] font-medium text-[var(--color-accent-ink)]"
                  >
                    <input type="hidden" name="conversationId" value={conversationId} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <span title={m.addedBy ? `${m.addedBy} · ${m.addedAt}` : m.addedAt}>{m.name}</span>
                    <button
                      type="submit"
                      aria-label={`${t.shell.close}: ${m.name}`}
                      className="rounded px-0.5 leading-none text-[var(--color-accent)] hover:text-[var(--color-danger)]"
                    >
                      ×
                    </button>
                  </form>
                ))}
              </div>
            )}
            {candidates.length > 0 && (
              <form action={addChatMember} className="flex items-center gap-1.5">
                {chatMembers.length === 0 && <span className="text-[var(--color-faint)]">·</span>}
                <SubmitSelect
                  name="memberId"
                  defaultValue=""
                  className="max-w-[140px] cursor-pointer appearance-none field-sizing-content bg-transparent text-[12.5px] font-semibold text-[var(--color-accent)] outline-none hover:underline"
                  aria-label={s.addColleague}
                >
                  <option value="">{s.addShort}</option>
                  {candidates.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </SubmitSelect>
                <input type="hidden" name="conversationId" value={conversationId} />
              </form>
            )}
          </div>
        </div>
      </section>

      {automation && (
        <AutomationCard automation={automation} conversationId={conversationId} s={s} />
      )}

      <section>
        <div className={`mb-2 ${EYEBROW}`}>{s.tags}</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tg) => (
            <form key={tg.id} action={toggleConversationTag}>
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="tagId" value={tg.id} />
              <input type="hidden" name="remove" value="1" />
              <button
                type="submit"
                title={`${tg.name} ×`}
                className="rounded-[6px] px-2 py-[3px] text-[11.5px] font-medium"
                style={{ background: `${tg.color}22`, color: tg.color }}
              >
                {tg.name} ×
              </button>
            </form>
          ))}
          {addableTags.length > 0 && (
            <form action={toggleConversationTag}>
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="remove" value="0" />
              <SubmitSelect
                name="tagId"
                defaultValue=""
                aria-label={s.addTag}
                className="h-[25px] cursor-pointer appearance-none field-sizing-content rounded-[6px] border border-dashed border-[var(--color-border-strong)] bg-transparent px-1.5 text-[11.5px] font-medium text-[var(--color-muted)] outline-none hover:bg-[var(--color-surface-2)]"
              >
                <option value="">+ {s.addTag}</option>
                {addableTags.map((tg) => (
                  <option key={tg.id} value={tg.id}>{tg.name}</option>
                ))}
              </SubmitSelect>
            </form>
          )}
        </div>
      </section>

      <section>
        <div className={`mb-2 ${EYEBROW}`}>{s.remarks}</div>
        <RemarksBox contactId={contactId} value={remarks} />
      </section>

      {/* A real switch: campaigns filter their audience on this column. */}
      <form action={setContactMarketingOptIn} className="flex items-center justify-between text-[12.5px] text-[var(--color-muted)]">
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="optIn" value={marketingOptIn ? "0" : "1"} />
        {s.optIn}
        <button
          type="submit"
          role="switch"
          aria-checked={marketingOptIn}
          aria-label={s.optIn}
          className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
            marketingOptIn ? "bg-[var(--color-accent)]" : "bg-[var(--color-border-strong)]"
          }`}
        >
          <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${marketingOptIn ? "translate-x-4" : ""}`} />
        </button>
      </form>
    </>
  );

  // ── Order: what the ERP order event wrote onto the contact, plus the
  // payment slips received in chat. Nothing here is fetched from the ERP. ──
  const orderRef = values.ref_1;
  const parseRm = (v?: string) => (v ? Number(String(v).replace(/[^\d.]/g, "")) : NaN);
  // Every order bundled into this delivery, sent by the ERP as `orders_json` — a
  // JSON array of { so, ref, amount } (amount a plain-decimal RM string). The
  // panel lists them all when there is more than one; a single order (or an older
  // event with no list) just shows the primary order block below.
  let orderList: { so?: string; ref?: string; amount?: string }[] = [];
  try {
    const parsed = values.orders_json ? JSON.parse(values.orders_json) : null;
    if (Array.isArray(parsed)) orderList = parsed as typeof orderList;
  } catch {
    /* malformed JSON — fall back to the single primary order */
  }
  // The total shown is the ERP's grand total `order_amount`, else the sum of the
  // per-order list. NOT `order_total` — that is the ERP's ORDER COUNT (1/2/3/4+),
  // used only to pick the opener template; rendering it as money showed every
  // order as "RM 1.00". money() shows "—" when none is present.
  const total = values.order_amount
    ? parseRm(values.order_amount)
    : orderList.length
      ? orderList.reduce((sum, o) => {
          const n = parseRm(o.amount);
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0)
      : NaN;
  const facts: [string, string | undefined][] = [
    [s.refNo, values.ref_no_1],
    [s.deliveryDate, values.delivery_date_1],
    [s.salesPerson, values.sales_person],
    [s.brand, values.brand_1],
    [s.deliveryStatus, values.delivery_message_status_1],
  ];
  const order = (
    <>
      {orderRef ? (
        <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2.5">
            <div>
              <div className={EYEBROW}>{s.erpOrder}</div>
              <div className="text-[15px] font-semibold tracking-[0.02em] text-[var(--color-brand)]">{orderRef}</div>
            </div>
            {values.delivery_message_status_1 && <Badge tone="primary">{values.delivery_message_status_1}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-3 py-2.5">
            {facts
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <div className="text-[10.5px] text-[var(--color-faint)]">{k}</div>
                  <div className="truncate text-[13px] font-medium text-[var(--color-ink)]">{v}</div>
                </div>
              ))}
          </div>
          {orderList.length > 1 && (
            <div className="border-t border-[var(--color-border-subtle)] px-3 py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className={EYEBROW}>{s.orders}</span>
                <span className="text-[11px] font-medium text-[var(--color-muted)]">
                  {fmt(s.ordersCount, { n: orderList.length })}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {orderList.map((o, i) => (
                  <li key={`${o.so ?? ""}-${i}`} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px]">
                      <span className="font-medium text-[var(--color-brand)]">{o.so || "—"}</span>
                      {o.ref ? <span className="text-[var(--color-muted)]"> · {o.ref}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-[12.5px] text-[var(--color-ink)]">
                      {money(parseRm(o.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <span className="text-[12px] text-[var(--color-muted)]">{s.orderTotal}</span>
            <span className="text-[17px] font-semibold tabular-nums text-[var(--color-ink)]">{money(total)}</span>
          </div>
        </section>
      ) : (
        <p className="text-[12.5px] text-[var(--color-faint)]">{s.noOrder}</p>
      )}

      <section>
        <div className={`mb-2 ${EYEBROW}`}>{s.payments}</div>
        {payments.length === 0 ? (
          <p className="text-[12.5px] text-[var(--color-faint)]">{s.noPayments}</p>
        ) : (
          <div className="flex flex-col rounded-[10px] border border-[var(--color-border)]">
            {payments.map((p) => {
              const tone =
                p.status === "VERIFIED"
                  ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                  : p.status === "REJECTED"
                    ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                    : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
              return (
                <div key={p.id} className="flex items-center gap-2.5 border-b border-[var(--color-border-subtle)] px-3 py-2.5 last:border-b-0">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] ${tone}`}>
                    {p.status === "VERIFIED" ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    ) : p.status === "REJECTED" ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-[var(--color-ink)]">{s.paymentStatus[p.status] ?? p.status}</div>
                    <div className="truncate text-[11px] text-[var(--color-faint)]">
                      {[p.method, p.referenceNo, p.createdAt].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--color-ink)]">{money(p.amount, p.currency)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );

  // ── Fields ────────────────────────────────────────────────────────────
  const fieldsBody = (
    <FieldList
      rows={fields.map((f) => ({ key: f.key, name: f.name, value: values[f.key] ?? "" }))}
      filledLabel={fmt(s.filled, { n: populated.length, total: fields.length })}
      showEmptyLabel={s.showEmpty}
      hideEmptyLabel={s.hideEmpty}
    />
  );

  return (
    <aside className="hidden w-[320px] shrink-0 flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] xl:flex">
      <div className="group/head relative flex items-center gap-3 px-4 pb-3 pt-4">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white"
          style={{ background: tint(contactName) }}
        >
          {initials(contactName).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-[var(--color-ink)]">{contactName}</span>
            <ProfileEditor contactId={contactId} name={contactName} email={email} starred={starred} />
          </div>
          <div className="flex items-center gap-1.5 text-[12px] tabular-nums text-[var(--color-muted)]" title={id.label}>
            <span className="truncate">{id.text}</span>
            <CopyButton value={phone} label={s.copy} doneLabel={s.copied} />
          </div>
          {!id.isPhone && <div className="text-[10.5px] text-[var(--color-faint)]">{s.usernameOnly}</div>}
        </div>
        <ConversationMenu conversationId={conversationId} />
      </div>

      <PanelTabs
        tabs={[
          { key: "overview", label: s.overview, body: overview },
          { key: "order", label: s.order, body: order },
          { key: "fields", label: `${s.fields} ${populated.length}/${fields.length}`, body: fieldsBody },
        ]}
      />
    </aside>
  );
}

/**
 * The customer's flow: name, how far along it is, each step, and Pause /
 * Resume. Read from automation_run + the automation graph
 * (lib/automation/progress.ts); nothing here is stored separately.
 */
function AutomationCard({
  automation: a,
  conversationId,
  s,
}: {
  automation: AutomationProgress;
  conversationId: string;
  s: Dict["service"];
}) {
  const statusKey =
    a.status === "waiting" && a.waitingFor ? `waiting_${a.waitingFor}` : a.status;
  const tone =
    a.status === "completed"
      ? "success"
      : a.status === "paused" || a.status === "superseded"
        ? "neutral"
        : a.status === "waiting"
          ? "warning"
          : "primary";
  const canToggle = a.status === "waiting" || a.status === "paused";
  return (
    <section className="overflow-hidden rounded-[10px] border border-[var(--color-border)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2">
        <span className={EYEBROW}>{s.automation}</span>
        <Badge tone={tone}>{s.runStatus[statusKey] ?? a.status}</Badge>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <div className="text-[13px] font-semibold text-[var(--color-ink)]">{a.name}</div>
        {a.steps.length > 0 && (
          <div className="flex gap-[3px]">
            {a.steps.map((st) => (
              <span
                key={st.id}
                className={`h-1 flex-1 rounded-[2px] ${
                  st.state === "todo" ? "bg-[var(--color-border)]" : "bg-[var(--color-accent)]"
                }`}
              />
            ))}
          </div>
        )}
        <div className="flex flex-col gap-[5px] text-[12px]">
          {a.steps.map((st) => (
            <div
              key={st.id}
              className={`flex items-center gap-2 ${
                st.state === "todo" ? "text-[var(--color-faint)]" : "text-[var(--color-ink)]"
              }`}
            >
              <span
                className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[1.5px] text-[8px] text-white ${
                  st.state === "done"
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                    : st.state === "current"
                      ? "border-[var(--color-accent)] bg-[var(--color-surface)]"
                      : "border-[var(--color-border-strong)] bg-[var(--color-surface)]"
                }`}
              >
                {st.state === "done" ? "✓" : ""}
              </span>
              <span className={`min-w-0 truncate ${st.state === "current" ? "font-semibold" : ""}`} title={st.label}>
                {st.label}
              </span>
            </div>
          ))}
        </div>
        {a.status === "paused" && (
          <p className="text-[11px] leading-snug text-[var(--color-faint)]">{s.pausedHint}</p>
        )}
        <div className="mt-0.5 flex items-center gap-1.5">
          {canToggle && (
            <form action={setAutomationRunPaused}>
              <input type="hidden" name="conversationId" value={conversationId} />
              <input type="hidden" name="runId" value={a.runId} />
              <input type="hidden" name="pause" value={a.status === "paused" ? "0" : "1"} />
              <button
                type="submit"
                className="rounded-[6px] border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]"
              >
                {a.status === "paused" ? s.resume : s.pause}
              </button>
            </form>
          )}
          <Link
            href={`/automations/${a.automationId}`}
            className="rounded-[6px] px-2.5 py-1 text-[11.5px] font-medium text-[var(--color-accent)] hover:underline"
          >
            {s.openFlow}
          </Link>
        </div>
      </div>
    </section>
  );
}

