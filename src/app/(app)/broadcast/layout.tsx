import { requireModule } from "@/lib/full-access";

/** Only for people with Broadcast (Settings → Access, lib/full-access.ts). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("broadcast");
  return children;
}
