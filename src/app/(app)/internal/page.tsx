import { Placeholder } from "@/components/Placeholder";
import { getDict } from "@/lib/i18n/server";

// Internal (staff-to-staff chat) is the last step of the redesign. Until then
// the rail links here so the navigation is complete and says what is coming.
export default async function InternalPage() {
  const t = await getDict();
  return (
    <Placeholder
      section="internal"
      page="comingSoon"
      title={t.nav.internal}
      phase={t.internal.phase}
      points={[t.internal.p1, t.internal.p2, t.internal.p3]}
    />
  );
}
