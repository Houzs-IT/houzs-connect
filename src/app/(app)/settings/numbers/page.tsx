// Phone numbers — the WABA's numbers, and the place to add one.
//
// Before this page the only way to see which number the app sends from, or
// whether it was healthy, was WhatsApp Manager; and adding a number meant
// leaving the product entirely. Both now happen here, against the same WABA
// the send path uses, so what this page says cannot drift from what actually
// happens.

import { notFound } from "next/navigation";
import { PageChrome } from "@/components/PageChrome";
import { getCurrentMember } from "@/lib/current-member";
import { fetchNumbers } from "./actions";
import { NumbersClient } from "./NumbersClient";
import { getDict } from "@/lib/i18n/server";
import { SettingsHead } from "../ui";

export default async function NumbersPage() {
  const me = await getCurrentMember();
  if (!me) notFound();

  const view = await fetchNumbers();
  const t = await getDict();

  return (
    <PageChrome section="settings" page="channels">
      <div className="max-w-[1180px] p-4 md:p-6">
        <SettingsHead title={t.set.channels} sub={t.set.channelsSub} />
        {!view.permitted ? (
          <p className="text-[13px] text-[var(--color-muted)]">
            Only an owner or admin can see and change the company&apos;s WhatsApp numbers.
          </p>
        ) : !view.configured ? (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-[12.5px] text-[var(--color-muted)]">
            WhatsApp is not connected yet. Set{" "}
            <span className="font-mono">WHATSAPP_WABA_ID</span> and{" "}
            <span className="font-mono">WHATSAPP_TOKEN</span> on the Worker to manage numbers here.
          </div>
        ) : view.error ? (
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_6%,transparent)] px-4 py-3">
            <p className="text-[12.5px] text-[var(--color-danger)]">
              Meta would not list this account&apos;s numbers: {view.error}
            </p>
            <p className="mt-1 text-[11px] text-[var(--color-faint)]">
              A token that has expired, or one without{" "}
              <span className="font-mono">whatsapp_business_management</span>, fails exactly here.
            </p>
          </div>
        ) : (
          <NumbersClient
            numbers={view.numbers}
            activeId={view.activeId}
            managerUrl={view.managerUrl}
            assignments={view.assignments}
            companies={view.companies}
          />
        )}
      </div>
    </PageChrome>
  );
}
