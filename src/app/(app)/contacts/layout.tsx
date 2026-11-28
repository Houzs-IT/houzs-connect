import { Suspense } from "react";
import { SecondaryMenuSkeleton } from "@/components/shell/SecondaryMenu";
import { getDict } from "@/lib/i18n/server";
import { requireModule } from "@/lib/full-access";
import { ContactsMenu } from "./ContactsMenu";

/** Only for people with Contacts (Settings → Access, lib/full-access.ts). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("contacts");
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
