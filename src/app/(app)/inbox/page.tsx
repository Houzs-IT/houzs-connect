import { IconInbox } from "@/components/icons";
import { getDict } from "@/lib/i18n/server";

export default async function InboxEmpty() {
  const t = await getDict();
  return (
    <div className="dot-grid flex flex-1 flex-col items-center justify-center bg-[var(--color-canvas)] px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-[16px] bg-[var(--color-surface)] text-[var(--color-accent)] shadow-card ring-1 ring-[var(--color-border)]">
        <IconInbox width={28} height={28} />
      </div>
      <p className="mt-4 text-[15px] font-semibold text-[var(--color-ink)]">{t.service.selectTitle}</p>
      <p className="mt-1 max-w-xs text-[13px] text-[var(--color-muted)]">{t.service.selectBody}</p>
    </div>
  );
}
