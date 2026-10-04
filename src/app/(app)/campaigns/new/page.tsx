import { and, asc, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaign, channel, contact, contactField, contactTag, tag } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { isLive } from "@/lib/whatsapp/cloud-api";
import { templateConfig } from "@/lib/whatsapp/templates";
import { BUILT_IN_FIELDS } from "@/lib/automation/vars";
import type { FieldOption } from "@/app/(app)/templates/types";
import { CampaignComposer, type CampaignDraft } from "../CampaignComposer";
import { listCampaignTemplates } from "../actions";
import { unpackSpec } from "../spec";

// The approved-template list is remote state that changes on Meta's side, and
// recipient counts change whenever anyone edits a contact.
export const dynamic = "force-dynamic";

/** A stored UTC instant as Malaysian wall clock, for <input type="datetime-local">. */
function toMalaysianInput(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string | string[] }>;
}) {
  const me = await getCurrentMember();
  if (!me) return null;
  const db = getDb();
  const sp = await searchParams;
  const editId = (Array.isArray(sp.edit) ? sp.edit[0] : sp.edit) ?? "";

  const [channels, tagOpts, fields, templates] = await Promise.all([
    db.query.channel.findMany({
      where: eq(channel.companyId, me.companyId),
      orderBy: desc(channel.isDefault),
    }),
    // Reachable count per tag. The blocked / opted-out filter is in the JOIN,
    // so a tag whose contacts are all excluded still lists — at zero.
    db
      .select({ name: tag.name, color: tag.color, count: count(contact.id) })
      .from(tag)
      .leftJoin(contactTag, eq(contactTag.tagId, tag.id))
      .leftJoin(
        contact,
        and(eq(contact.id, contactTag.contactId), eq(contact.blocked, false), eq(contact.marketingOptIn, true))
      )
      .where(eq(tag.companyId, me.companyId))
      .groupBy(tag.id, tag.name, tag.color)
      .orderBy(asc(tag.name)),
    db.query.contactField.findMany({
      where: eq(contactField.companyId, me.companyId),
      orderBy: asc(contactField.key),
    }),
    listCampaignTemplates(),
  ]);

  const attributeFields: FieldOption[] = fields.map((f) => ({ key: f.key, name: f.name }));
  const fieldOptions: FieldOption[] = [...BUILT_IN_FIELDS.map((f) => ({ ...f, builtin: true })), ...attributeFields];

  // Only a draft or scheduled campaign opens for editing; a sent one is the
  // record of what customers received, and the list offers Duplicate instead.
  let initial: CampaignDraft | null = null;
  if (editId) {
    const row = await db.query.campaign.findFirst({
      where: and(eq(campaign.id, editId), eq(campaign.companyId, me.companyId)),
    });
    const spec = row ? unpackSpec(row.audience) : null;
    if (row && spec && (row.status === "draft" || row.status === "scheduled")) {
      initial = {
        id: row.id,
        name: row.name,
        channelId: row.channelId,
        spec,
        scheduleAt: toMalaysianInput(row.scheduleAt),
        requiresApproval: row.requiresApproval,
      };
    }
  }

  return (
    <CampaignComposer
      key={initial?.id ?? "new"}
      channels={channels.map((c) => ({ id: c.id, displayName: c.displayName, phone: c.phone, isDefault: c.isDefault }))}
      tags={tagOpts}
      fields={fieldOptions}
      attributeFields={attributeFields}
      templates={templates}
      templatesConfigured={!!templateConfig()}
      live={isLive()}
      initial={initial}
    />
  );
}
