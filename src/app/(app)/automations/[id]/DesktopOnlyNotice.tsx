import Link from "next/link";

/**
 * Shown instead of the Builder on phones and small touch iPads (the same cutoff
 * as the `compact` variant): the Builder is a desktop tool. Pure CSS, so there
 * is no flash and it works before any script has loaded. OK goes back to the list.
 */
export function DesktopOnlyNotice({ message, ok }: { message: string; ok: string }) {
  return (
    <div className="hidden min-w-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center compact:flex">
      <p className="max-w-xs text-[15px] font-medium leading-relaxed text-[var(--color-ink)]">{message}</p>
      <Link
        href="/automations"
        className="grid h-11 w-full max-w-xs place-items-center rounded-lg bg-[var(--color-accent)] text-[13.5px] font-semibold text-white hover:opacity-90"
      >
        {ok}
      </Link>
    </div>
  );
}
