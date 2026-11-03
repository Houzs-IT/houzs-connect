import { Suspense } from "react";
import { SecondaryMenuSkeleton } from "@/components/shell/SecondaryMenu";
import { requireModule } from "@/lib/full-access";
import { getDict } from "@/lib/i18n/server";
import { LogsMenu } from "./LogsMenu";

export default async function Layout({ children }: { children: React.ReactNode }) {
  // Only for people with System Logs (Settings → Access, lib/full-access.ts).
  await requireModule("logs");
  const t = await getDict();
  return (
    <>
      <Suspense fallback={<SecondaryMenuSkeleton title={t.nav.logs} />}>
        <LogsMenu />
      </Suspense>
      {children}
    </>
  );
}
