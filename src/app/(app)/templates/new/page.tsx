import { getCurrentMember } from "@/lib/current-member";
import { loadFieldsAndSample } from "../data";
import { TemplateEditor } from "../TemplateEditor";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage() {
  const me = await getCurrentMember();
  if (!me) return null;
  const { fields, samples } = await loadFieldsAndSample(me.companyId);
  return <TemplateEditor existing={null} fields={fields} samples={samples} />;
}
