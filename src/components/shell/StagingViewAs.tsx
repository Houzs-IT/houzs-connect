import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { member } from "@/db/schema";
import { getCurrentMember, getSignedInMember } from "@/lib/current-member";
import { isAdminRole } from "@/lib/permissions";
import { stopViewAs, viewAs } from "@/app/view-as-actions";

/** The staging banner's "View as" picker (app/view-as-actions.ts). Admins only; the layout shows it on staging only. */
export async function StagingViewAs() {
  const [real, me] = await Promise.all([getSignedInMember(), getCurrentMember()]);
  if (!real || !me || !isAdminRole(real.role)) return null;

  if (me.id !== real.id) {
    return (
      <form action={stopViewAs} className="inline-flex items-center gap-2">
        <span>
          Viewing as {me.name} ({me.role.toLowerCase()})
        </span>
        <button type="submit" className="rounded bg-amber-950 px-2 py-px text-amber-50">
          Back to me
        </button>
      </form>
    );
  }

  const people = await getDb().query.member.findMany({
    columns: { id: true, name: true, role: true },
    where: and(eq(member.companyId, real.companyId), eq(member.active, true)),
    orderBy: [asc(member.role), asc(member.name)],
  });
  return (
    <form action={viewAs} className="inline-flex items-center gap-1.5">
      <label htmlFor="view-as">View as</label>
      <select id="view-as" name="memberId" defaultValue="" className="max-w-56 rounded border border-amber-700 bg-amber-50 px-1 text-xs">
        <option value="" disabled>
          Choose a person
        </option>
        {people
          .filter((p) => p.id !== real.id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role.toLowerCase()})
            </option>
          ))}
      </select>
      <button type="submit" className="rounded bg-amber-950 px-2 py-px text-amber-50">
        View
      </button>
    </form>
  );
}
