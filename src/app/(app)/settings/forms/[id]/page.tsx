import { redirect } from "next/navigation";

/** Forms open in the master-detail view on /forms; old links land there. */
export default async function FormDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/settings/forms?f=${id}`);
}
