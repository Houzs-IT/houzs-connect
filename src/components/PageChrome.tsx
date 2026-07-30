import { getCurrentMember } from "@/lib/current-member";
import { Topbar } from "./Topbar";

/** Server wrapper: Topbar (with current member) + scrollable content area. */
export async function PageChrome({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const me = await getCurrentMember();
  if (!me) return null; // the (app) layout redirects unauthenticated users to /login
  return (
    <>
      <Topbar title={title} subtitle={subtitle} current={me} />
      <main className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
    </>
  );
}
