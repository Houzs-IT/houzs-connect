import { PageChrome } from "@/components/PageChrome";
import { TemplateComposer } from "./TemplateComposer";
import { StarterSetButton } from "./StarterSetButton";
import { fetchTemplates, removeTemplate } from "./actions";

// Live, never cached — a template's status changes on Meta's side, not ours.
export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "var(--color-success)",
  PENDING: "var(--color-warning)",
  REJECTED: "var(--color-danger)",
  PAUSED: "var(--color-warning)",
  DISABLED: "var(--color-faint)",
};

export default async function TemplatesPage() {
  const { configured, templates, error } = await fetchTemplates();

  return (
    <PageChrome
      title="Templates"
      subtitle="WhatsApp message templates — create, submit for Meta review, track status"
    >
      <div className="grid gap-6 p-6 lg:grid-cols-[400px_1fr]">
        <div className="flex flex-col gap-4">
          <TemplateComposer />
          <StarterSetButton />
        </div>

        <div className="min-w-0">
          {!configured && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">
                WhatsApp is not connected yet
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted)]">
                Set <code className="font-mono text-[12px]">WHATSAPP_WABA_ID</code> and{" "}
                <code className="font-mono text-[12px]">WHATSAPP_TOKEN</code> as Worker secrets,
                then reload this page. Until then templates cannot be listed or submitted, and no
                business-initiated message can be sent.
              </p>
            </div>
          )}

          {configured && error && (
            <div className="mb-4 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-4 text-[13px] text-[var(--color-danger)]">
              Could not read templates from Meta: {error}
            </div>
          )}

          {configured && !error && (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                  {templates.length} template{templates.length === 1 ? "" : "s"} on this WhatsApp
                  account
                </span>
              </div>

              {templates.length === 0 && (
                <div className="px-4 py-10 text-center text-[13px] text-[var(--color-faint)]">
                  No templates yet. Submit one on the left, or import the starter set.
                </div>
              )}

              <ul>
                {templates.map((t) => (
                  <li
                    key={t.id}
                    className="border-b border-[var(--color-border)] px-4 py-3 last:border-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12.5px] font-medium text-[var(--color-ink)]">
                            {t.name}
                          </span>
                          <span
                            className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                            style={{
                              background: `color-mix(in srgb, ${STATUS_COLOR[t.status] ?? "var(--color-muted)"} 12%, transparent)`,
                              color: STATUS_COLOR[t.status] ?? "var(--color-muted)",
                            }}
                          >
                            {t.status}
                          </span>
                          <span className="text-[11px] text-[var(--color-faint)]">
                            {t.category} · {t.language}
                          </span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                          {t.body}
                        </p>
                        {t.buttons.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {t.buttons.map((b) => (
                              <span
                                key={b}
                                className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)]"
                              >
                                {b}
                              </span>
                            ))}
                          </div>
                        )}
                        {t.status === "REJECTED" && t.rejectedReason && (
                          <p className="mt-2 text-[12px] text-[var(--color-danger)]">
                            Rejected: {t.rejectedReason}
                          </p>
                        )}
                      </div>
                      <form action={removeTemplate} className="flex-none">
                        <input type="hidden" name="name" value={t.name} />
                        <button className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]">
                          Delete
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </PageChrome>
  );
}
