import { Suspense } from "react";
import { PageChrome } from "@/components/PageChrome";
import { ItSupport } from "@/components/it-support/ItSupport";
import { itSupportConnected } from "@/lib/it-support/hub";

/** /it-support — report a problem with Connect to IT and follow it (components/it-support). */
export default async function ItSupportPage() {
  return (
    <PageChrome section="itSupport">
      <Suspense>
        <ItSupport connected={itSupportConnected()} />
      </Suspense>
    </PageChrome>
  );
}
