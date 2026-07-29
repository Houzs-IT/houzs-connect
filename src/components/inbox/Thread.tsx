import { clockTime } from "@/lib/format";
import { IconCheck } from "@/components/icons";
import { demoTap } from "@/app/actions";

type Msg = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  isBot: boolean;
  status: string;
  interactivePayload: unknown;
  createdAt: Date | string;
};

type Buttons = { kind?: string; buttons?: { id: string; label: string }[] };

export function Thread({
  messages,
  conversationId,
}: {
  messages: Msg[];
  contactName: string;
  conversationId: string;
}) {
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-6">
      {messages.map((m) => {
        const out = m.direction === "OUT";
        const payload = (m.interactivePayload as Buttons | null) ?? null;
        const buttons = payload?.buttons ?? [];
        return (
          <div
            key={m.id}
            className={`flex ${out ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[62%]">
              <div
                className={`rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm ring-1 ${
                  out
                    ? "rounded-br-md bg-[var(--color-out)] text-[var(--color-accent-ink)] ring-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                    : "rounded-bl-md bg-[var(--color-in)] text-[var(--color-ink)] ring-[var(--color-border)]"
                }`}
              >
                {m.isBot && (
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-ink)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                    Bot
                  </div>
                )}
                <p className="whitespace-pre-wrap">{m.body}</p>
                <div
                  className={`mt-1 flex items-center gap-1 text-[10px] ${
                    out
                      ? "justify-end text-[color-mix(in_srgb,var(--color-accent-ink)_60%,transparent)]"
                      : "text-[var(--color-faint)]"
                  }`}
                >
                  {clockTime(m.createdAt)}
                  {out && <IconCheck width={12} height={12} />}
                </div>
              </div>

              {/* Interactive buttons — tappable in DEMO to simulate the customer. */}
              {out && buttons.length > 0 && (
                <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                  {buttons.map((b) => (
                    <form key={b.id} action={demoTap}>
                      <input type="hidden" name="conversationId" value={conversationId} />
                      <input type="hidden" name="buttonId" value={b.id} />
                      <input type="hidden" name="buttonLabel" value={b.label} />
                      <button
                        type="submit"
                        className="rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-ink)] shadow-sm transition-colors hover:bg-[var(--color-accent-soft)]"
                      >
                        {b.label}
                      </button>
                    </form>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
