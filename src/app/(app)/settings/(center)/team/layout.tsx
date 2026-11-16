import { requireAdmin } from "@/lib/full-access";

/** Owners, admins and Super Admins only (lib/full-access.ts requireAdmin). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return children;
}
