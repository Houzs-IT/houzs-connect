"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AdminOverview, LeakReport, MyConnector } from "@/lib/mcp/admin";
import { SetCard } from "../ui";
import {
  decideMcpRequest,
  disconnectConnection,
  disconnectMyApp,
  leakCheck,
  removeMcpAccess,
  requestMcpAccess,
  setMcpActionSwitch,
  turnOnMcp,
} from "./actions";

const when = (v: string | null) =>
  v
    ? new Date(v)
        .toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })
        .replace("Sept", "Sep")
    : "—";

const btn = "h-[32px] shrink-0 rounded-[8px] px-3 text-[12.5px] font-semibold disabled:opacity-50";
const primary = `${btn} bg-[var(--color-brand)] text-white`;
const soft = `${btn} border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]`;
const danger = `${btn} bg-[var(--color-danger-soft)] text-[var(--color-danger)]`;
const rowCls = "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--color-border-subtle)] px-4 py-3";
const empty = "border-t border-[var(--color-border-subtle)] px-4 py-3 text-[13px] text-[var(--color-faint)]";

function Person({ name, sub }: { name: string; sub: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13.5px] font-semibold text-[var(--color-ink)]">{name}</div>
      <div className="truncate text-[12px] text-[var(--color-faint)]">{sub}</div>
    </div>
  );
}

export function AiConnectorClient({
  connectorUrl,
  me,
  mine,
  overview,
}: {
  connectorUrl: string;
  me: { name: string; email: string };
  mine: MyConnector;
  overview: AdminOverview | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [reason, setReason] = useState("");
  const [pick, setPick] = useState("");
  const [leakFor, setLeakFor] = useState("");
  const [leak, setLeak] = useState<LeakReport | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setFlash({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Something went wrong.") });
      router.refresh();
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(connectorUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const o = overview;
  return (
    <div className="flex flex-col gap-4">
      {flash && (
        <div
          role="status"
          className={`rounded-[10px] px-4 py-2.5 text-[13px] ${flash.ok ? "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}
        >
          {flash.text}
        </div>
      )}

      {/* Connector URL */}
      <SetCard icon="⇄" tone="blue" title="Connector URL" sub="Paste this into Claude or ChatGPT when you add a custom connector.">
        <div className={rowCls}>
          <code className="min-w-0 flex-1 break-all rounded-[8px] bg-[var(--color-surface-2)] px-3 py-2 font-code text-[12.5px] text-[var(--color-ink)]">{connectorUrl}</code>
          <button type="button" onClick={copy} className={primary}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </SetCard>

      {/* Stats (admin) */}
      {o && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Connected people", o.stats.connectedPeople],
            ["Lookups (24 h)", o.stats.callsToday],
            ["Refused (24 h)", o.stats.refusedToday],
            ["Waiting for approval", o.stats.waiting],
          ].map(([label, v]) => (
            <div key={label as string} className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <div className="text-[11.5px] text-[var(--color-faint)]">{label}</div>
              <div className="text-[22px] font-semibold text-[var(--color-ink)]">{v}</div>
            </div>
          ))}
        </div>
      )}
      {o?.limits && (
        <p className="text-[12px] text-[var(--color-faint)]">
          Limits per person: {o.limits.perMinute} lookups a minute and {o.limits.perDay} a day (the leak check is not counted). Excel exports: up to{" "}
          {o.limits.exportRows.toLocaleString("en")} rows, download link valid {o.limits.exportLinkMinutes} minutes.
        </p>
      )}

      {/* Admin: AI actions (round 4b) — everything OFF until turned on here */}
      {o && (
        <SetCard
          icon="⚑"
          tone="orange"
          title="AI actions"
          sub={`Off by default. When on, the AI can only PROPOSE; nothing happens until the person says yes to the exact summary. Each confirmation is single use and expires after ${o.actions.ttlMinutes} minutes; at most ${o.actions.perDay} confirmed actions per person a day. It always runs as the person, with their own access.`}
        >
          <div className={rowCls}>
            <Person
              name="Allow AI actions"
              sub={`Main switch. Off = the connector is read-only for everyone, whatever is ticked below. Confirmed in the last 24 h: ${o.actions.confirmedToday}.`}
            />
            <button
              type="button"
              role="switch"
              aria-checked={o.actions.switches.main}
              disabled={pending}
              onClick={() => run(() => setMcpActionSwitch("actions", !o.actions.switches.main))}
              className={o.actions.switches.main ? danger : primary}
            >
              {o.actions.switches.main ? "Turn off" : "Turn on"}
            </button>
          </div>
          {o.actions.kinds.map((k) => {
            const on = o.actions.switches[k.kind];
            return (
              <div key={k.kind} className={rowCls}>
                <Person name={`${on ? "On" : "Off"} · ${k.title}`} sub={o.actions.switches.main ? k.sub : `${k.sub} (needs the main switch on too)`} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={k.title}
                  disabled={pending}
                  onClick={() => run(() => setMcpActionSwitch(k.kind, !on))}
                  className={on ? danger : soft}
                >
                  {on ? "Turn off" : "Turn on"}
                </button>
              </div>
            );
          })}
          <div className={empty}>Never possible through the AI: campaigns or broadcasts, deleting anything, importing contacts.</div>
        </SetCard>
      )}

      {/* My status */}
      {!mine.allowed && (
        <SetCard icon="?" tone="orange" title="Request access" sub="AI Connector is not turned on for your account yet. The admin approves each person.">
          {mine.pendingSince ? (
            <div className={empty}>You asked on {when(mine.pendingSince)} — waiting for the admin.</div>
          ) : (
            <div className={rowCls}>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                placeholder="What will you use it for? (optional)"
                className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-ink)]"
              />
              <button type="button" disabled={pending} onClick={() => run(() => requestMcpAccess(reason))} className={primary}>
                Request access
              </button>
            </div>
          )}
        </SetCard>
      )}

      {/* Admin: waiting for approval */}
      {o && (
        <SetCard icon="!" tone="orange" title="Waiting for approval" sub="People who asked to use the AI Connector.">
          {o.requests.length === 0 && <div className={empty}>Nobody is waiting.</div>}
          {o.requests.map((r) => (
            <div key={r.id} className={rowCls}>
              <Person name={r.name} sub={[r.email, r.company, when(r.createdAt), r.reason && `“${r.reason}”`].filter(Boolean).join(" · ")} />
              <div className="flex gap-2">
                <button type="button" disabled={pending} onClick={() => run(() => decideMcpRequest(r.id, false))} className={soft}>
                  Reject
                </button>
                <button type="button" disabled={pending} onClick={() => run(() => decideMcpRequest(r.id, true))} className={primary}>
                  Approve
                </button>
              </div>
            </div>
          ))}
        </SetCard>
      )}

      {/* Admin: turn on for someone */}
      {o && (
        <SetCard icon="+" tone="green" title="Turn on for someone" sub="Give a person access without waiting for a request.">
          <div className={rowCls}>
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-ink)]"
            >
              <option value="">Pick a person…</option>
              {o.staff.filter((p) => !p.admin).map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name} — {p.companies}
                </option>
              ))}
            </select>
            <button type="button" disabled={pending || !pick} onClick={() => run(() => turnOnMcp(pick))} className={primary}>
              Turn on
            </button>
          </div>
        </SetCard>
      )}

      {/* Admin: connected people */}
      {o && (
        <SetCard icon="◉" tone="purple" title="Connected people" sub="Every AI app connected right now. Disconnect takes effect on its next lookup.">
          {o.connected.length === 0 && <div className={empty}>No AI app is connected.</div>}
          {o.connected.map((c) => (
            <div key={c.tokenId} className={rowCls}>
              <Person name={`${c.name} · ${c.app}`} sub={[c.company, `connected ${when(c.connectedAt)}`, `last used ${when(c.lastUsedAt)}`].filter(Boolean).join(" · ")} />
              <button type="button" disabled={pending} onClick={() => run(() => disconnectConnection(c.tokenId))} className={danger}>
                Disconnect
              </button>
            </div>
          ))}
        </SetCard>
      )}

      {/* Admin: allowed list */}
      {o && (
        <SetCard icon="✓" tone="green" title="Allowed list" sub="People who may connect. Super Admins and Owners always may. Remove also disconnects them.">
          {o.allowed.length === 0 && <div className={empty}>Nobody yet.</div>}
          {o.allowed.map((a) => (
            <div key={a.email} className={rowCls}>
              <Person name={a.name} sub={`${a.email} · since ${when(a.approvedAt)}`} />
              <button type="button" disabled={pending} onClick={() => run(() => removeMcpAccess(a.email))} className={danger}>
                Remove
              </button>
            </div>
          ))}
        </SetCard>
      )}

      {/* Admin: recent lookups */}
      {o && (
        <SetCard icon="≡" tone="cyan" title="Recent lookups" sub="The last 100 things an AI app read, newest first.">
          {o.calls.length === 0 && <div className={empty}>No lookups yet.</div>}
          {o.calls.length > 0 && (
            <div className="max-h-[420px] overflow-auto border-t border-[var(--color-border-subtle)]">
              {o.calls.map((k) => (
                <div key={k.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--color-border-subtle)] px-4 py-2 text-[12.5px] last:border-b-0">
                  <span className="w-[110px] shrink-0 text-[var(--color-faint)]">{when(k.at)}</span>
                  <span className="shrink-0 font-semibold text-[var(--color-ink)]">
                    {k.name || "—"} · {k.app}
                  </span>
                  <span className="min-w-0 flex-1 break-all font-code text-[12px] text-[var(--color-muted)]">
                    {k.tool}
                    {k.target ? ` ${k.target}` : ""}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold ${k.ok ? "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]" : "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"}`}
                  >
                    {k.ok ? "OK" : k.note || `Refused ${k.status}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SetCard>
      )}

      {/* Admin: leak check */}
      {o && (
        <SetCard
          icon="⚲"
          tone="pink"
          title="Leak check"
          sub="Reads every list as one approved staff account and shows which money / people field NAMES reach it — never the values. The temporary token is revoked afterwards."
        >
          <div className={rowCls}>
            <select
              value={leakFor}
              onChange={(e) => setLeakFor(e.target.value)}
              className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-ink)]"
            >
              <option value="">Pick an approved staff account…</option>
              {o.allowed.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || !leakFor}
              onClick={() =>
                start(async () => {
                  setLeak(null);
                  const r = await leakCheck(leakFor);
                  if (r.ok && r.report) setLeak(r.report);
                  else setFlash({ ok: false, text: r.error ?? "Leak check failed." });
                })
              }
              className={primary}
            >
              {pending ? "Checking…" : "Run check"}
            </button>
          </div>
          {leak && (
            <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
              <div className="mb-2 text-[12.5px] text-[var(--color-muted)]">
                As <b className="text-[var(--color-ink)]">{leak.person}</b> ({leak.role}, {leak.company})
              </div>
              <div className="flex flex-col gap-1.5">
                {leak.rows.map((r) => (
                  <div key={r.path} className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
                    <span className="w-[150px] shrink-0 font-code text-[var(--color-ink)]">{r.path}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-semibold ${r.outcome === "opened" ? "bg-[var(--color-pastel-orange)] text-[var(--color-pastel-orange-ink)]" : r.outcome === "refused" ? "bg-[var(--color-pastel-green)] text-[var(--color-pastel-green-ink)]" : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"}`}
                    >
                      {r.outcome === "opened" ? "Can read" : r.outcome === "refused" ? "Refused" : `Error ${r.status}`}
                    </span>
                    <span className="min-w-0 flex-1 text-[var(--color-muted)]">
                      {r.sensitive.length ? `Money / people fields: ${r.sensitive.join(", ")}` : r.outcome === "opened" ? "No money / people fields" : ""}
                      {r.hidden.length ? ` · removed: ${r.hidden.join(", ")}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SetCard>
      )}

      {/* My connected apps */}
      <SetCard icon="☺" tone="blue" title="My connected apps" sub={`AI apps connected with your login (${me.email}).`}>
        {mine.apps.length === 0 && <div className={empty}>None yet.</div>}
        {mine.apps.map((a) => (
          <div key={a.tokenId} className={rowCls}>
            <Person name={a.app} sub={`connected ${when(a.connectedAt)} · last used ${when(a.lastUsedAt)}`} />
            <button type="button" disabled={pending} onClick={() => run(() => disconnectMyApp(a.tokenId))} className={danger}>
              Disconnect
            </button>
          </div>
        ))}
      </SetCard>

      {/* How to connect */}
      <SetCard icon="i" tone="purple" title="How to connect" sub="Two minutes, once per app. You sign in with your own Houzs Connect account.">
        <div className="grid gap-4 border-t border-[var(--color-border-subtle)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink)] md:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold">Claude (claude.ai or the Claude app)</div>
            <ol className="list-decimal space-y-0.5 pl-5 text-[var(--color-muted)]">
              <li>Settings → Connectors → Add custom connector.</li>
              <li>Name it “Houzs Connect” and paste the connector URL above.</li>
              <li>Press Connect, sign in to Houzs Connect, then press Allow.</li>
              <li>Ask, for example: “Which customers are waiting for a reply?”</li>
            </ol>
          </div>
          <div>
            <div className="mb-1 font-semibold">ChatGPT</div>
            <ol className="list-decimal space-y-0.5 pl-5 text-[var(--color-muted)]">
              <li>Settings → Apps &amp; Connectors → Advanced → turn on Developer mode.</li>
              <li>Create a connector, paste the connector URL above, authentication OAuth.</li>
              <li>Sign in to Houzs Connect, then press Allow.</li>
              <li>In a new chat, pick the connector and ask your question.</li>
            </ol>
          </div>
          <p className="text-[12px] text-[var(--color-faint)] md:col-span-2">
            Use the address of the company you work in (this page shows the right one). Read-only unless the admin turns on AI actions — and even then
            the AI only proposes: nothing is sent or changed until you say yes. It can never approve a payment, send a campaign or delete anything. The admin
            sees every lookup and can disconnect any app.
          </p>
        </div>
      </SetCard>
    </div>
  );
}
