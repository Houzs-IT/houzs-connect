import { PageChrome } from "@/components/PageChrome";
import { getDict } from "@/lib/i18n/server";
import { ProposalNote, SettingsHead } from "./ui";

type Key = "notifications" | "developers" | "billing" | "files" | "integrations";
const SUB = { notifications: "notifSub", developers: "devSub", billing: "billingSub", files: "filesSub", integrations: "integSub" } as const;
const BODY = { notifications: "notifBody", developers: "devBody", billing: "billingBody", files: "filesBody", integrations: "integBody" } as const;

/** A Settings panel from the redesign that waits on new tables or endpoints. */
export async function ProposalPage({ k }: { k: Key }) {
  const t = await getDict();
  const L = t.set;
  return (
    <PageChrome section="settings" crumbs={[L[k]]}>
      <div className="max-w-[880px] p-4 md:p-6">
        <SettingsHead title={L[k]} sub={L[SUB[k]]} />
        <ProposalNote L={L} body={L[BODY[k]]} />
      </div>
    </PageChrome>
  );
}
