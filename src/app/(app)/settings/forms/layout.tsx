import { Suspense } from "react";
import { SecondaryMenuSkeleton } from "@/components/shell/SecondaryMenu";
import { getDict } from "@/lib/i18n/server";
import { TFMenu } from "@/app/(app)/templates/TFMenu";
import { requireModule } from "@/lib/full-access";

export default async function Layout({ children }: { children: React.ReactNode }) {
  // Only for people with the company's settings (Settings → Access, lib/full-access.ts).
  await requireModule("settings");
  const t = await getDict();
  return (
    <>
      <Suspense fallback={<SecondaryMenuSkeleton title={t.nav.templates} />}>
        <TFMenu />
      </Suspense>
      {children}
    </>
  );
}
