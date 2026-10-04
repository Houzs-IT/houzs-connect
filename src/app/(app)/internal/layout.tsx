import { Suspense } from "react";
import { InternalMenu } from "./InternalMenu";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="hidden w-[232px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface-2)] md:block" />}>
        <InternalMenu />
      </Suspense>
      {children}
    </>
  );
}
