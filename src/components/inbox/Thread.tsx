import { clockTime } from "@/lib/format";
import { IconCheck } from "@/components/icons";

type Msg = {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  isBot: boolean;
  status: string;
  createdAt: Date | string;
};

export function Thread({ messages }: { messages: Msg[]; contactName: string }) {
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-6">
      {messages.map((m) => {
        const out = m.direction === "OUT";
        return (
          <div
            key={m.id}
            className={`flex ${out ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[62%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm ring-1 ${
                out
                  ? "rounded-br-md bg-[var(--color-out)] text-[#3d2c07] ring-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
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
                  out ? "justify-end text-[#8a6d2e]" : "text-[var(--color-faint)]"
                }`}
              >
                {clockTime(m.createdAt)}
                {out && <IconCheck width={12} height={12} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
