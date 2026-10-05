import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member, memberPhoto } from "@/db/schema";
import { ensureMemberPhotoTable } from "@/db/ensure-member-photo";
import { bypassReadCache } from "@/db/fresh";
import { getCurrentMember } from "@/lib/current-member";
import { base64ToBytes, photoKey } from "@/lib/member-photo";
import { isAdminRole } from "@/lib/permissions";

const notFound = () =>
  new Response("Not found", { status: 404, headers: { "cache-control": "private, no-store" } });

/**
 * A staff member's profile photo, by MEMBER id (lib/member-photo.ts).
 *
 * Signed-in staff only, and only for someone in the viewer's own company —
 * except admins, whose Team page lists people across every company. With a
 * `?v=` that matches the stored photo the answer is cached for a year (a new
 * photo is a new URL); anything else is revalidated on every use.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;

  const db = getDb();
  const who = await db.query.member.findFirst({
    where: eq(member.id, id),
    columns: { email: true, companyId: true },
  });
  if (!who || (who.companyId !== me.companyId && !isAdminRole(me.role))) return notFound();

  try {
    await ensureMemberPhotoTable(db);
    const [row] = await db
      .select({ data: memberPhoto.data, updatedAt: memberPhoto.updatedAt })
      .from(memberPhoto)
      // Fresh (db/fresh.ts): this answer may be cached for a year under the
      // new `?v=`, so it must not be Hyperdrive's copy of the previous photo.
      .where(and(eq(memberPhoto.email, photoKey(who.email)), bypassReadCache()))
      .limit(1);
    if (!row) return notFound();

    const current = new URL(req.url).searchParams.get("v") === String(row.updatedAt.getTime());
    return new Response(base64ToBytes(row.data), {
      headers: {
        // Only ever a JPEG: the upload action refuses anything else.
        "content-type": "image/jpeg",
        "cache-control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    console.warn("[member-photo] read failed:", e);
    return notFound();
  }
}
