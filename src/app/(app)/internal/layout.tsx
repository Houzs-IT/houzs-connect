import { Suspense } from "react";
import { requireModule } from "@/lib/full-access";
import { InternalMenu } from "./InternalMenu";

/** Only for people with Internal chat (Settings → Access, lib/full-access.ts). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("internal");
  return (
    <>
      <Suspense fallback={<div className="hidden w-[232px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-2)] md:block" />}>
        <InternalMenu />
      </Suspense>
      {children}
    </>
  );
}
