"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { IconDots } from "@/components/icons";
import { useShell } from "@/components/shell/ShellProvider";
import { fmt } from "@/lib/i18n/dict";
import { approveCampaign, deleteCampaign, duplicateCampaign, unscheduleCampaign } from "./actions";

/** The ⋯ menu on a campaign row. Delete goes through a confirm. */
export function CampaignRowMenu({
  id,
  name,
  editable,
  scheduled,
  canApprove,
}: {
  id: string;
  name: string;
  /** Draft or scheduled — a sent campaign can only be opened, duplicated or deleted. */
  editable: boolean;
  scheduled: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const { t } = useShell();
  const L = t.camp;
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const post = (fn: (fd: FormData) => Promise<void>) => {
    setMenu(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await fn(fd);
      setConfirm(false);
      router.refresh();
    });
  };

  const item = "block w-full px-3 py-2 text-left text-[13px] text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]";

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Actions"
        disabled={pending}
        onClick={() => setMenu((v) => !v)}
        className="grid h-7 w-7 place-items-center rounded-[6px] text-[var(--color-muted)] hover:bg-[var(--color-surface-dim)] disabled:opacity-40"
      >
        <IconDots width={15} height={15} />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
          <div className="absolute right-0 z-30 mt-1 w-44 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-popover)]">
            <Link href={editable ? `/campaigns/new?edit=${id}` : `/campaigns/${id}`} className={item}>
              {editable ? L.edit : L.open}
            </Link>
            {canApprove && (
              <button type="button" className={item} onClick={() => post(approveCampaign)}>
                {L.approve}
              </button>
            )}
            <button type="button" className={item} onClick={() => post(duplicateCampaign)}>
              {L.duplicate}
            </button>
            {scheduled && (
              <button type="button" className={item} onClick={() => post(unscheduleCampaign)}>
                {L.unschedule}
              </button>
            )}
            <button
              type="button"
              className={`${item} !text-[var(--color-danger)]`}
              onClick={() => {
                setMenu(false);
                setConfirm(true);
              }}
            >
              {L.delete}
            </button>
          </div>
        </>
      )}
      <ActionConfirm
        open={confirm}
        title={fmt(L.deleteTitle, { name })}
        confirmLabel={L.delete}
        busy={pending}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => post(deleteCampaign)}
      >
        <p>{L.deleteBody}</p>
      </ActionConfirm>
    </div>
  );
}
