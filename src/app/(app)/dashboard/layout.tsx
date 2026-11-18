import { requireModule } from "@/lib/full-access";

/** Only for people with Dashboard (Settings → Access, lib/full-access.ts). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("dashboard");
  return children;
}
