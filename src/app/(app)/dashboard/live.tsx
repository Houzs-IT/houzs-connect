import Link from "next/link";
import { clockTime, relTime } from "@/lib/format";
import { fmt, type Dict } from "@/lib/i18n/dict";
import { Skel } from "@/components/skeleton";
import { LiveRefresh } from "@/components/inbox/LiveRefresh";
import { SLA_MINUTES } from "@/lib/sla";
import { liveNow } from "./queries";
import { Avatar, Card, EYEBROW, Empty } from "./ui";
import { humanDuration } from "./util";

type S = Dict["dash"];

/**
 * Live reporting: what is happening right now, re-rendered every 10 seconds by
 * polling (the same LiveRefresh the inbox uses — there are no websockets yet).
 * "Agents online" reads member.last_seen_at (lib/presence.ts).
 */
export async function LiveTab({ companyId, s }: { companyId: string; s: S }) {
  const l = await liveNow(companyId);
  const now = l.now;
  const kpis = [
    { label: s.l1, hint: s.l1Hint, value: l.onlineAgents, dot: "#2f8a5b", bg: "linear-gradient(135deg,#ffffff 40%,#e3f5ea)" },
    { label: s.l2, hint: s.l2Hint, value: l.openNow, dot: "#1593c4", bg: "linear-gradient(135deg,#ffffff 40%,#e2f4fa)" },
    { label: s.l3, hint: s.l3Hint, value: l.waitingCount, dot: "#d9822b", bg: "linear-gradient(135deg,#ffffff 40%,#fdf1e0)" },
    { label: s.l4, hint: s.l4Hint, value: l.botHandling, dot: "#7a4fd6", bg: "linear-gradient(135deg,#ffffff 40%,#efe9fb)" },
  ];
  const mark = {
    in: { t: s.feedIn, bg: "var(--color-pastel-blue)", ink: "var(--color-pastel-blue-ink)" },
    out: { t: s.feedOut, bg: "var(--color-pastel-green)", ink: "var(--color-pastel-green-ink)" },
    bot: { t: s.feedBot, bg: "var(--color-accent-soft)", ink: "var(--color-accent-ink)" },
    flow: { t: s.feedFlow, bg: "var(--color-pastel-purple)", ink: "var(--color-pastel-purple-ink)" },
    pay: { t: s.feedPay, bg: "var(--color-pastel-orange)", ink: "var(--color-pastel-orange-ink)" },
  };

  return (
    <div className="flex flex-col gap-4">
      <LiveRefresh seconds={10} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <section
            key={k.label}
            className="rounded-[16px] border border-[var(--color-border-subtle)] px-5 py-[18px]"
            style={{ background: k.bg }}
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-muted)]">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: k.dot, boxShadow: `0 0 0 3px ${k.dot}2e` }} />
              {k.label}
            </div>
            <div className="mt-2 text-[34px] font-medium tracking-[-0.02em] tabular-nums text-[var(--color-ink)]">{k.value}</div>
            <div className="text-[11.5px] text-[var(--color-faint)]">{k.hint}</div>
          </section>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card pad="px-[22px] py-[18px]">
          <div className="mb-1.5 flex items-center gap-2">
            <span className={EYEBROW}>{s.liveFeed}</span>
            <span className="flex items-center gap-1 rounded-full bg-[var(--color-success-soft)] px-[7px] py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-success)]">
              <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[var(--color-success)]" />
              Live
            </span>
            <span className="ml-auto text-[11.5px] text-[var(--color-faint)]">{s.refresh}</span>
          </div>
          {l.feed.length === 0 ? (
            <Empty>{s.noData}</Empty>
          ) : (
            <ul>
              {l.feed.map((f) => {
                const m = mark[f.kind];
                const meta =
                  f.kind === "flow"
                    ? (s.runStatus[f.who] ?? f.who)
                    : f.kind === "pay"
                      ? `${s.paySlip} · ${f.who}`
                      : f.kind === "in"
                        ? f.who
                        : `${f.who} → ${f.to}`;
                const body = (
                  <>
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[8.5px] font-bold tracking-[0.02em]"
                      style={{ background: m.bg, color: m.ink }}
                    >
                      {m.t}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[var(--color-ink)]">{f.text || "—"}</div>
                      <div className="truncate text-[11px] text-[var(--color-faint)]">{meta}</div>
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-faint)]">{clockTime(f.at)}</span>
                  </>
                );
                return (
                  <li key={f.id} className="border-b border-[var(--color-border-subtle)] last:border-b-0">
                    {f.href ? (
                      <Link href={f.href} className="flex items-center gap-3 py-2.5 text-[12.5px] hover:bg-[var(--color-surface-2)]">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 py-2.5 text-[12.5px]">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card pad="px-5 py-[18px]">
            <div className="mb-3 flex items-center">
              <span className={`flex-1 ${EYEBROW}`}>{s.queueNow}</span>
              <span className="text-[12px] font-semibold tabular-nums text-[var(--color-danger)]">{l.waitingCount}</span>
            </div>
            {l.waiting.length === 0 ? (
              <Empty>{s.noData}</Empty>
            ) : (
              <ul>
                {l.waiting.map((q) => {
                  const sec = (now - q.since.getTime()) / 1000;
                  return (
                    <li key={q.id} className="border-b border-[var(--color-border-subtle)] last:border-b-0">
                      <Link href={`/inbox/${q.id}`} className="flex items-center gap-2.5 py-2 text-[12.5px] hover:bg-[var(--color-surface-2)]">
                        <Avatar name={q.name} size={26} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--color-ink)]">{q.name}</div>
                          {q.ref && <div className="text-[11px] font-semibold text-[var(--color-brand)]">{q.ref}</div>}
                        </div>
                        <span
                          className={`text-[11px] font-semibold tabular-nums ${
                            sec >= SLA_MINUTES * 60 ? "text-[var(--color-danger)]" : "text-[var(--color-warning)]"
                          }`}
                        >
                          {humanDuration(sec)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <Link href="/inbox" className="mt-2.5 block text-[12px] font-semibold text-[var(--color-accent)] hover:underline">
              {s.openService}
            </Link>
          </Card>

          <Card pad="px-5 py-[18px]">
            <div className={`mb-3 ${EYEBROW}`}>{s.whoActive}</div>
            <ul className="flex flex-col">
              {l.people.map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 py-1.5 text-[12.5px]">
                  <span className="relative">
                    <Avatar name={a.name} size={26} />
                    <span
                      className={`absolute -bottom-px -right-px h-[9px] w-[9px] rounded-full border-2 border-white ${
                        a.online ? "bg-[var(--color-success)]" : "bg-[var(--color-border-strong)]"
                      }`}
                    />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{a.name}</span>
                  <span className={`whitespace-nowrap text-[11.5px] ${a.online ? "font-semibold text-[var(--color-success)]" : "text-[var(--color-faint)]"}`}>
                    {a.online ? s.onlineNow : a.lastSeen ? fmt(s.lastSeen, { at: relTime(a.lastSeen) }) : s.neverSeen}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function LiveSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} pad="px-5 py-[18px]">
            <Skel className="h-[11px] w-24" />
            <Skel className="mt-3 h-[34px] w-14" />
            <Skel className="mt-2 h-[11px] w-32" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <div className="skeleton h-[420px] rounded-[10px]" />
        </Card>
        <Card>
          <div className="skeleton h-[300px] rounded-[10px]" />
        </Card>
      </div>
    </div>
  );
}
