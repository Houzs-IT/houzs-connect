import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { company } from "@/db/schema";
import { brandForSlug, DEFAULT_BRAND, type Brand } from "@/lib/brand";

/**
 * The brand for a company id — resolved through its slug. Server-only (it reads
 * the database), which is why it is kept out of the pure lib/brand.ts so that
 * module stays safe to import from anywhere. Falls back to Houzs when the
 * company is missing, so a caller never has to special-case it.
 */
export async function brandForCompanyId(companyId: string): Promise<Brand> {
  const co = await getDb().query.company.findFirst({
    columns: { slug: true },
    where: eq(company.id, companyId),
  });
  return co ? brandForSlug(co.slug) : DEFAULT_BRAND;
}
