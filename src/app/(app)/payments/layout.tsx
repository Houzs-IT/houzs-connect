import { requireModule } from "@/lib/full-access";

/** Only for people with Payments (Settings → Access, lib/full-access.ts). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("payments");
  return children;
}
