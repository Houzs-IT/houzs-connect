import { requireModule } from "@/lib/full-access";

/** Only for people with the company's settings (Settings → Access, lib/full-access.ts). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("settings");
  return children;
}
