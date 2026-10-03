import { Suspense } from "react";
import { SecondaryMenuSkeleton } from "@/components/shell/SecondaryMenu";
import { getDict } from "@/lib/i18n/server";
import { ContactsMenu } from "./ContactsMenu";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const t = await getDict();
  return (
    <>
      <Suspense fallback={<SecondaryMenuSkeleton title={t.nav.contacts} />}>
        <ContactsMenu />
      </Suspense>
      {children}
    </>
  );
}
