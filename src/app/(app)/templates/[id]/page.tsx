import { notFound } from "next/navigation";
import { getCurrentMember } from "@/lib/current-member";
import { editBlockedReason, type TemplateStatus } from "@/lib/whatsapp/templates";
import { bindingKey } from "@/lib/whatsapp/templateBindings";
import { loadBindings, loadFieldsAndSample, loadTemplateList } from "../data";
import { TemplateEditor } from "../TemplateEditor";

// A template's status changes on Meta's side; read it fresh.
export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentMember();
  if (!me) return null;
  const { id } = await params;
  const [list, bindings, { fields, samples }] = await Promise.all([
    loadTemplateList(),
    loadBindings(me.companyId),
    loadFieldsAndSample(me.companyId),
  ]);
  const x = list.templates.find((tp) => tp.id === id);
  if (!x) notFound();
  return (
    <TemplateEditor
      existing={{
        id: x.id,
        name: x.name,
        language: x.language,
        category: x.category,
        status: x.status,
        body: x.body,
        header: x.header,
        footer: x.footer,
        buttons: x.buttons,
        mediaHeader: x.mediaHeader,
        rejectedReason: x.rejectedReason,
        bindings: bindings.map.get(bindingKey(x.name, x.language))?.bindings ?? [],
        editBlocked: editBlockedReason(x.status as TemplateStatus),
      }}
      fields={fields}
      samples={samples}
    />
  );
}
