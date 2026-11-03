"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionConfirm } from "@/components/ActionConfirm";
import { RowMenu } from "@/components/RowMenu";
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
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();

  const post = (fn: (fd: FormData) => Promise<void>) => {
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
    <>
      <RowMenu label="Actions" disabled={pending}>
        {(close) => (
          <>
            <Link href={editable ? `/campaigns/new?edit=${id}` : `/campaigns/${id}`} className={item} onClick={close}>
              {editable ? L.edit : L.open}
            </Link>
            {canApprove && (
              <button type="button" className={item} onClick={() => { close(); post(approveCampaign); }}>
                {L.approve}
              </button>
            )}
            <button type="button" className={item} onClick={() => { close(); post(duplicateCampaign); }}>
              {L.duplicate}
            </button>
            {scheduled && (
              <button type="button" className={item} onClick={() => { close(); post(unscheduleCampaign); }}>
                {L.unschedule}
              </button>
            )}
            <button
              type="button"
              className={`${item} !text-[var(--color-danger)]`}
              onClick={() => {
                close();
                setConfirm(true);
              }}
            >
              {L.delete}
            </button>
          </>
        )}
      </RowMenu>
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
    </>
  );
}
