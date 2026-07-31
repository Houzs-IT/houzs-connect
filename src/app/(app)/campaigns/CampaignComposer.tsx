"use client";

// One-time broadcast composer (Seampify "Campaigns" parity). Posts to the
// createAndSendCampaign server action. Client-side it owns: audience selection
// (all / tag / attribute), {{variable}} insertion at the cursor, a live review
// count, and the send-now vs schedule-later toggle. All styling reads Ink &
// Petrol tokens; petrol is the only CTA.

import { useRef, useState } from "react";
import { createAndSendCampaign } from "./actions";

interface TagOpt {
  name: string;
  color: string;
  count: number;
}

export function CampaignComposer({
  tags,
  totalContacts,
  varKeys,
}: {
  tags: TagOpt[];
  totalContacts: number;
  varKeys: string[];
}) {
  const [audienceKind, setAudienceKind] = useState<"all" | "tag" | "attribute">("all");
  const [audienceTag, setAudienceTag] = useState(tags[0]?.name ?? "");
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const msgRef = useRef<HTMLTextAreaElement>(null);

  // Live review count — exact for all/tag, unknown for attribute (resolved on send).
  const reviewCount =
    audienceKind === "all"
      ? totalContacts
      : audienceKind === "tag"
        ? (tags.find((t) => t.name === audienceTag)?.count ?? 0)
        : null;

  function insertVar(key: string) {
    const el = msgRef.current;
    if (!el) return;
    const token = `{{${key}}}`;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    // Restore focus + caret just after the inserted token.
    const caret = start + token.length;
    el.focus();
    el.setSelectionRange(caret, caret);
  }

  const inputCls =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-accent)]";
  const labelCls = "mb-1 block text-[11px] text-[var(--color-muted)]";

  return (
    <form
      action={createAndSendCampaign}
      className="h-fit rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <h3 className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">
        New one-time campaign
      </h3>

      <label className={labelCls}>Name</label>
      <input name="name" required placeholder="e.g. Balance reminder" className={`mb-3 ${inputCls}`} />

      {/* Audience */}
      <label className={labelCls}>Audience</label>
      <input type="hidden" name="audienceKind" value={audienceKind} />
      <div className="mb-2 flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5">
        {(["all", "tag", "attribute"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setAudienceKind(k)}
            className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium capitalize transition-colors ${
              audienceKind === k
                ? "bg-[var(--color-surface)] text-[var(--color-accent)] shadow-card"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {k === "all" ? "All" : k === "tag" ? "By tag" : "By attribute"}
          </button>
        ))}
      </div>

      {audienceKind === "tag" && (
        <select
          name="audienceTag"
          value={audienceTag}
          onChange={(e) => setAudienceTag(e.target.value)}
          className={`mb-3 ${inputCls}`}
        >
          {tags.length === 0 && <option value="">No tags yet</option>}
          {tags.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.count})
            </option>
          ))}
        </select>
      )}

      {audienceKind === "attribute" && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <input name="attrKey" placeholder="attribute key" list="attr-keys" className={inputCls} />
          <input name="attrValue" placeholder="equals value" className={inputCls} />
          <datalist id="attr-keys">
            {varKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </div>
      )}

      {/* Template name (optional) */}
      <label className={labelCls}>Template name (optional)</label>
      <input name="templateName" placeholder="e.g. balance_reminder_v1" className={`mb-3 ${inputCls}`} />

      {/* Message + variable inserts */}
      <label className={labelCls}>Message</label>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {varKeys.slice(0, 8).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insertVar(k)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            {`{{${k}}}`}
          </button>
        ))}
      </div>
      <textarea
        ref={msgRef}
        name="message"
        required
        rows={4}
        placeholder="Hi {{full_name}}, a quick reminder about order {{ref_1}}…"
        className={`mb-3 resize-none ${inputCls}`}
      />

      {/* Schedule */}
      <label className={labelCls}>When</label>
      <input type="hidden" name="scheduleMode" value={scheduleMode} />
      <div className="mb-2 flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5">
        {(["now", "later"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setScheduleMode(m)}
            className={`flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
              scheduleMode === m
                ? "bg-[var(--color-surface)] text-[var(--color-accent)] shadow-card"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {m === "now" ? "Send now" : "Schedule"}
          </button>
        ))}
      </div>
      {scheduleMode === "later" && (
        <input type="datetime-local" name="scheduleAt" className={`mb-3 ${inputCls}`} />
      )}

      {/* Review + submit */}
      <div className="mb-3 mt-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-[12px] text-[var(--color-muted)]">
        Recipients:{" "}
        <span className="font-mono font-medium text-[var(--color-ink)]">
          {reviewCount == null ? "computed on send" : reviewCount}
        </span>
        {audienceKind !== "attribute" && reviewCount != null && (
          <span className="text-[var(--color-faint)]"> contact{reviewCount === 1 ? "" : "s"}</span>
        )}
      </div>
      <p className="mb-3 text-[11px] text-[var(--color-faint)]">
        Merge vars: {"{{full_name}}"} {"{{phone}}"} … · DEMO sends via the stubbed transport.
      </p>
      <button className="w-full rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-medium text-white">
        {scheduleMode === "later" ? "Schedule campaign" : "Send broadcast"}
      </button>
    </form>
  );
}
