"use server";

// Campaign mutations. Create, save, edit, duplicate, delete, schedule, count,
// test-send, review and send.
//
// Every export here is a public POST endpoint the moment it is deployed — the
// (app) layout's redirect guards rendering, not these. This page can message the
// entire address book, so each one starts with `getCurrentMember()` and every
// row it touches is matched on the member's own companyId. The pattern is the
// one in src/app/(app)/settings/actions.ts.
//
// The {{n}} → field mapping is NOT reimplemented here. It is consumed through
// the contract in src/lib/whatsapp/templateBindings.ts: resolveSendBindings →
// templateBindingGaps → resolveSendParams, per that file's own instructions.

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  campaign as campaignTable,
  channel as channelTable,
  contact as contactTable,
  tag as tagTable,
} from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { attrs } from "@/lib/format";
import { getOrCreateConversation, sendOutbound } from "@/lib/whatsapp/transport";
import { listSendableTemplates } from "@/app/actions";
import { normalisePhone } from "@/app/(app)/contacts/actions";
import type { SampleContact } from "@/app/(app)/templates/types";
import {
  bindingKey,
  loadTemplateBindings,
} from "@/lib/whatsapp/templateBindings";
import {
  applyParams,
  resolveSendParams,
  type VarBinding,
} from "@/lib/automation/vars";
import { resolveAudience, type ContactRow } from "./audience";
import {
  NAME_MAX,
  SPEC_VERSION,
  packAudience,
  sendBlocker,
  unpackSpec,
  type AudienceCount,
  type AudienceSpec,
  type CampaignInput,
  type CampaignSpec,
  type CampaignTemplate,
  type PrepareResult,
  type SaveResult,
  type SavedStatus,
  type SendPreview,
  type SendResult,
  type TestSendResult,
} from "./spec";
import { can } from "@/lib/permissions";
import {
  EDITABLE,
  readyBindings,
  varContext,
  sendCampaignChunk,
  type Db,
  type Ready,
} from "./send";

/** Auth + company scope for every mutation below. Null when not signed in. */
async function ctx() {
  const me = await getCurrentMember();
  if (!me || !(await can(me, "campaigns"))) return null;
  return { db: getDb(), companyId: me.companyId, memberId: me.id, role: me.role };
}

/**
 * The same contact, shaped for the Templates page's `VariableRows` preview.
 *
 * That component resolves through `sampleLookup`, which reads full_name /
 * first_name / last_name / phone off the row and everything else out of
 * `attributes`. The email and source columns are therefore folded into the map,
 * in the same order `buildLookup` uses (real attributes first, built-ins on
 * top), so the wizard's preview and the actual send agree slot for slot.
 */
function sampleFor(c: ContactRow): SampleContact {
  return {
    label: c.name ?? c.phone,
    name: c.name,
    phone: c.phone,
    attributes: {
      ...attrs(c.attributes),
      email: c.email ?? "",
      source_type: c.source ?? "",
      source_id: c.sourceId ?? "",
      source_url: c.sourceUrl ?? "",
    },
  };
}

/**
 * The channel a campaign sends from, checked against the caller's company.
 *
 * Never trust the id off the wire: `channelId` arrives from the wizard's sender
 * step, and an id belonging to another tenant would otherwise send this
 * company's broadcast down someone else's WhatsApp number. Falls back to the
 * company default when the id is absent or foreign.
 */
async function pickChannel(db: Db, companyId: string, channelId?: string) {
  if (channelId) {
    const ch = await db.query.channel.findFirst({
      where: and(eq(channelTable.id, channelId), eq(channelTable.companyId, companyId)),
    });
    if (ch) return ch;
  }
  return await db.query.channel.findFirst({
    where: eq(channelTable.companyId, companyId),
    orderBy: desc(channelTable.isDefault),
  });
}

function channelLabel(ch: { displayName: string; phone: string } | undefined): string {
  return ch ? `${ch.displayName} (${ch.phone})` : "no WhatsApp number configured";
}

/** A datetime-local string only counts as a schedule if it is in the future. */
function futureDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime() > Date.now() ? d : null;
}

// ── Read: the template picker (wizard step 4) ──────────────────────────────

/**
 * The APPROVED templates this account can broadcast, each with the mapping the
 * Templates page already saved for it.
 *
 * The Graph call is `listSendableTemplates()` in src/app/actions.ts, reused
 * rather than repeated — one fetch of the template list, one place where its
 * shape is known. The mapping comes from the template_binding table, so an
 * operator who has already mapped a template on the Templates page finds step 4
 * pre-filled instead of pointing four dropdowns at the same fields again.
 */
export async function listCampaignTemplates(): Promise<CampaignTemplate[]> {
  const c = await ctx();
  if (!c) return [];
  const [templates, saved] = await Promise.all([
    listSendableTemplates(),
    loadTemplateBindings(c.companyId),
  ]);
  return templates.map((t) => ({
    name: t.name,
    language: t.language,
    body: t.body,
    bindings: saved.get(bindingKey(t.name, t.language))?.bindings ?? [],
  }));
}

// ── Read: live recipient count (wizard step 3) ─────────────────────────────

/**
 * How many people this audience actually reaches, right now.
 *
 * The wizard calls this on every audience change. It runs the same
 * `resolveAudience` the send loop runs, so the figure on screen is the figure
 * that will be written to — including the blocked and opted-out exclusions the
 * old "Recipients: N" line ignored entirely. Marketing opt-in matters more than
 * it looks: the inbox switch that sets it was dead until this week, so the
 * column is only now telling the truth about who agreed to hear from us.
 */
export async function countAudience(aud: AudienceSpec): Promise<AudienceCount> {
  const c = await ctx();
  if (!c) {
    return { matched: 0, blocked: 0, optedOut: 0, recipients: 0, sample: [], sampleContact: null };
  }
  const r = await resolveAudience(c.db, c.companyId, aud);
  const first = r.recipients[0];
  return {
    matched: r.matched,
    blocked: r.blocked,
    optedOut: r.optedOut,
    recipients: r.recipients.length,
    sampleContact: first ? sampleFor(first) : null,
    sample: r.sample.map((s) => ({
      id: s.id,
      name: s.name,
      phone: s.phone,
      blocked: s.blocked,
      optedOut: !s.blocked && !s.marketingOptIn,
    })),
  };
}

// ── Write: draft lifecycle ─────────────────────────────────────────────────

/**
 * Create or update a campaign WITHOUT sending it.
 *
 * A future `scheduleAt` stores it as "scheduled"; anything else keeps it a
 * draft. Only draft and scheduled rows may be written to — a campaign that has
 * already gone out is the record of what customers received, so editing it would
 * rewrite history. The UI offers Duplicate for that.
 */
export async function saveCampaign(input: CampaignInput): Promise<SaveResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };

  const name = input.name.trim().slice(0, NAME_MAX);
  if (!name) return { ok: false, error: "Give the campaign a name." };

  const ch = await pickChannel(c.db, c.companyId, input.channelId);
  if (!ch) return { ok: false, error: "No WhatsApp number is configured for this company." };

  const spec: CampaignSpec = input.spec;
  const scheduleAt = futureDate(input.scheduleAt);
  const status: SavedStatus = scheduleAt ? "scheduled" : "draft";

  if (input.id) {
    const [updated] = await c.db
      .update(campaignTable)
      .set({
        name,
        channelId: ch.id,
        templateName: spec.templateName || null,
        audience: packAudience(spec),
        scheduleAt,
        status,
        // Any edit voids an earlier approval: what was approved is not this.
        requiresApproval: !!input.requiresApproval,
        approvedByMemberId: null,
      })
      .where(
        and(
          eq(campaignTable.id, input.id),
          eq(campaignTable.companyId, c.companyId),
          inArray(campaignTable.status, EDITABLE)
        )
      )
      .returning();
    if (!updated) {
      return { ok: false, error: "That campaign has already been sent — duplicate it instead." };
    }
    revalidatePath("/campaigns");
    return { ok: true, id: updated.id, status };
  }

  const [created] = await c.db
    .insert(campaignTable)
    .values({
      companyId: c.companyId,
      channelId: ch.id,
      name,
      templateName: spec.templateName || null,
      audience: packAudience(spec),
      scheduleAt,
      status,
      stats: null,
      requiresApproval: !!input.requiresApproval,
    })
    .returning();
  revalidatePath("/campaigns");
  return { ok: true, id: created.id, status };
}

/** Remove a campaign. Scoped to the member's company. */
export async function deleteCampaign(formData: FormData): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await c.db
    .delete(campaignTable)
    .where(and(eq(campaignTable.id, id), eq(campaignTable.companyId, c.companyId)));
  revalidatePath("/campaigns");
}

/**
 * Copy a campaign to a fresh draft — the way to re-run something that already
 * went out, and the way to build a variant without rebuilding the bindings.
 */
export async function duplicateCampaign(formData: FormData): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const row = await c.db.query.campaign.findFirst({
    where: and(eq(campaignTable.id, id), eq(campaignTable.companyId, c.companyId)),
  });
  if (!row) return;
  await c.db.insert(campaignTable).values({
    companyId: c.companyId,
    channelId: row.channelId,
    name: `${row.name} (copy)`.slice(0, NAME_MAX),
    templateName: row.templateName,
    audience: row.audience,
    scheduleAt: null,
    status: "draft",
    // Deliberately not copied: the original's figures describe the original's
    // send, and a copy has sent nothing.
    stats: null,
    requiresApproval: row.requiresApproval,
  });
  revalidatePath("/campaigns");
}

/** Who may approve a campaign that is held for approval. */
const APPROVERS = new Set(["SUPER_ADMIN", "OWNER", "ADMIN", "MANAGER"]);

/** Approve a draft or scheduled campaign that requires it. Managers and up. */
export async function approveCampaign(formData: FormData): Promise<void> {
  const c = await ctx();
  if (!c || !APPROVERS.has(c.role)) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await c.db
    .update(campaignTable)
    .set({ approvedByMemberId: c.memberId })
    .where(
      and(
        eq(campaignTable.id, id),
        eq(campaignTable.companyId, c.companyId),
        eq(campaignTable.requiresApproval, true),
        inArray(campaignTable.status, EDITABLE)
      )
    );
  revalidatePath("/campaigns");
}

/** Take a scheduled campaign off the schedule, back to an editable draft. */
export async function unscheduleCampaign(formData: FormData): Promise<void> {
  const c = await ctx();
  if (!c) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await c.db
    .update(campaignTable)
    .set({ status: "draft", scheduleAt: null })
    .where(
      and(
        eq(campaignTable.id, id),
        eq(campaignTable.companyId, c.companyId),
        eq(campaignTable.status, "scheduled")
      )
    );
  revalidatePath("/campaigns");
}

// ── Step 5: test send ──────────────────────────────────────────────────────

/**
 * Send this campaign's template to ONE number, to see it on a real handset
 * before the blast — Seampify's step 5.
 *
 * This sends a real WhatsApp message, so it is deliberately narrow:
 *
 *  - the number must already be a contact IN THIS COMPANY. A test send is not a
 *    way to message a stranger, and it must not quietly create a contact row.
 *  - blocked and opted-out contacts are refused here, not silently dropped
 *    downstream, so "nothing arrived" is never a mystery.
 *  - the template and binding rules apply exactly as they do to the broadcast.
 *
 * Nothing is written to the campaign's stats: a test is not part of the run.
 */
export async function sendTestMessage(input: {
  spec: CampaignSpec;
  channelId: string;
  phone: string;
}): Promise<TestSendResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };

  const blocker = sendBlocker(input.spec);
  if (blocker) return { ok: false, error: blocker };

  // Normalised through the SAME helper the Contacts page stored the number
  // with, so "011-1110 8822", "+60 11-1110 8822" and "60111108822" all find the
  // one contact — and the lookup uses the (company, phone) unique index instead
  // of pulling the whole address book into the Worker to scan it.
  const wanted = await normalisePhone(input.phone);
  if (wanted.length < 7) return { ok: false, error: "Enter the full number to test with." };

  const ch = await pickChannel(c.db, c.companyId, input.channelId);
  if (!ch) return { ok: false, error: "No WhatsApp number is configured for this company." };

  const ready = await readyBindings(c.companyId, input.spec);
  if (!ready.ok) return { ok: false, error: ready.error };

  const target = await c.db.query.contact.findFirst({
    where: and(eq(contactTable.companyId, c.companyId), eq(contactTable.phone, wanted)),
  });
  if (!target) {
    return {
      ok: false,
      error: "No contact in this company has that number. Add them on the Contacts page first.",
    };
  }
  if (target.blocked) {
    return { ok: false, error: `${target.name ?? target.phone} is blocked — unblock them first.` };
  }
  if (!target.marketingOptIn) {
    return {
      ok: false,
      error: `${target.name ?? target.phone} has marketing messages switched off.`,
    };
  }

  const { params } = resolveSendParams(input.spec.templateBody, varContext(target), ready.bindings);
  const body = applyParams(input.spec.templateBody, params);
  const convo = await getOrCreateConversation(ch.id, target.id);
  const msg = await sendOutbound(convo.id, body, {
    isBot: false,
    sentByMemberId: c.memberId,
    type: "TEMPLATE",
    template: { name: input.spec.templateName, lang: ready.language, params },
  });
  if (!msg) return { ok: false, error: "The send was refused before it left." };

  revalidatePath("/inbox");
  return { ok: true, to: `${target.name ?? "Contact"} (${target.phone})`, message: body };
}

// ── Step 6: review ─────────────────────────────────────────────────────────

async function buildPreview(
  db: Db,
  companyId: string,
  spec: CampaignSpec,
  channelId: string,
  ready: Ready
): Promise<SendPreview> {
  const [r, ch] = await Promise.all([
    resolveAudience(db, companyId, spec.audience),
    pickChannel(db, companyId, channelId),
  ]);
  const sample = r.recipients[0];
  const resolved = sample
    ? resolveSendParams(spec.templateBody, varContext(sample), ready.bindings)
    : null;
  return {
    matched: r.matched,
    blocked: r.blocked,
    optedOut: r.optedOut,
    recipients: r.recipients.length,
    templateName: spec.templateName,
    templateLang: ready.language,
    channelLabel: channelLabel(ch),
    sampleName: sample ? (sample.name ?? sample.phone) : null,
    sampleMessage: resolved ? applyParams(spec.templateBody, resolved.params) : null,
    blankSlots: resolved?.blank ?? [],
  };
}

/**
 * Save the draft and return everything the review step must show: how many
 * people, who is excluded and why, which number and language it leaves with, and
 * the exact text one real recipient will read.
 *
 * Saving first is deliberate — `sendCampaignNow` takes a campaign id, never a
 * body off the wire, so what goes out is what was reviewed and what is on record.
 */
export async function prepareSend(input: CampaignInput): Promise<PrepareResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };

  const blocker = sendBlocker(input.spec);
  if (blocker) return { ok: false, error: blocker };
  const ready = await readyBindings(c.companyId, input.spec);
  if (!ready.ok) return { ok: false, error: ready.error };

  const saved = await saveCampaign(input);
  if (!saved.ok || !saved.id) return { ok: false, error: saved.error ?? "Could not save." };

  const preview = await buildPreview(c.db, c.companyId, input.spec, input.channelId, ready);
  if (preview.recipients === 0) {
    return {
      ok: false,
      id: saved.id,
      status: saved.status,
      preview,
      error:
        preview.matched === 0
          ? "This audience matches nobody."
          : "Everyone this audience matches is blocked or has marketing messages switched off.",
    };
  }
  return { ok: true, id: saved.id, status: saved.status, preview };
}

/**
 * Review a campaign that is already saved — the path a SCHEDULED campaign takes
 * when its time arrives and an operator opens it.
 *
 * Nothing dispatches scheduled campaigns automatically: this Worker has no cron
 * trigger and no route to run one from, so "scheduled" means "held, and shown as
 * due". This turns a due one into a send, through the same review and the same
 * confirm as a fresh broadcast.
 */
export async function prepareSavedSend(campaignId: string): Promise<PrepareResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };
  const row = await c.db.query.campaign.findFirst({
    where: and(eq(campaignTable.id, campaignId), eq(campaignTable.companyId, c.companyId)),
  });
  if (!row) return { ok: false, error: "Campaign not found." };
  const spec = unpackSpec(row.audience);
  if (!spec) {
    return { ok: false, error: "This campaign has no stored message — rebuild it in the wizard." };
  }
  const blocker = sendBlocker(spec);
  if (blocker) return { ok: false, error: blocker };
  const ready = await readyBindings(c.companyId, spec);
  if (!ready.ok) return { ok: false, error: ready.error };

  const preview = await buildPreview(c.db, c.companyId, spec, row.channelId, ready);
  if (preview.recipients === 0) {
    return { ok: false, id: row.id, preview, error: "Nobody in this audience can be messaged." };
  }
  return { ok: true, id: row.id, preview };
}

// ── The send ───────────────────────────────────────────────────────────────

/**
 * Send a saved campaign for real.
 *
 * What stands between one click and the whole address book:
 *
 *  1. A signed-in member, and the campaign row must be in THEIR company.
 *  2. An explicit `confirm: "SEND"` — this action is not reachable from a plain
 *     link or a stray form submit.
 *  3. The spec is re-read from the database, not taken from the caller. The text
 *     that goes out is the text the review step displayed.
 *  4. `sendBlocker` again: no approved template, no send. Meta refuses free-form
 *     business-initiated messages, so without this the run is a column of
 *     rejections charged against the number's quality rating.
 *  5. `templateBindingGaps` again: an unmapped {{n}} stops the run rather than
 *     mailing a dash to everyone.
 *  6. The status claim is a conditional UPDATE from draft/scheduled to
 *     "sending". A second click, a double submit or a second tab finds no row to
 *     claim and stops — a broadcast must not be able to go out twice.
 *  7. Blocked and opted-out contacts are dropped by `resolveAudience`, the same
 *     resolver that produced the number on screen.
 */
export async function sendCampaignNow(input: {
  campaignId: string;
  confirm: string;
}): Promise<SendResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };
  if (input.confirm !== "SEND") {
    return { ok: false, error: "This send was not confirmed." };
  }
  // The send itself — spec re-read, sendBlocker/readyBindings, the atomic
  // draft/scheduled→sending claim, the chunk loop and stats — lives in ./send so
  // the cron scheduler (which has no session) sends due scheduled campaigns with
  // the exact same logic.
  return sendCampaignChunk(c.db, c.companyId, input.campaignId);
}

// ── Broadcast page (a campaign to hand-picked contacts) ────────────────────
//
// The Broadcast screen is a campaign whose audience is a hand-picked list of
// contact ids, not a rule. It reuses the campaign send engine wholesale: a
// contact-id audience (audience.ts "ids") is created as a one-off campaign and
// driven to completion here, so it lands in the Campaigns history with the same
// stats, and the per-message read/replied tagging, as any other broadcast.

export interface BroadcastContact {
  id: string;
  name: string | null;
  phone: string;
  blocked: boolean;
  tags: string[];
}

/** The address book for the Broadcast picker: every contact + its tag names,
 *  plus the company's tag list for the filter. Company-scoped. */
export async function listBroadcastContacts(): Promise<{
  contacts: BroadcastContact[];
  tags: string[];
}> {
  const c = await ctx();
  if (!c) return { contacts: [], tags: [] };
  const [rows, tags, links] = await Promise.all([
    c.db.query.contact.findMany({
      where: eq(contactTable.companyId, c.companyId),
      columns: { id: true, name: true, phone: true, blocked: true },
      orderBy: desc(contactTable.updatedAt),
    }),
    c.db.query.tag.findMany({
      where: eq(tagTable.companyId, c.companyId),
      columns: { id: true, name: true },
    }),
    c.db.query.contactTag.findMany({ columns: { contactId: true, tagId: true } }),
  ]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const byContact = new Map<string, string[]>();
  for (const l of links) {
    const name = tagName.get(l.tagId);
    if (!name) continue; // a link to another company's tag never matches here
    const arr = byContact.get(l.contactId) ?? [];
    arr.push(name);
    byContact.set(l.contactId, arr);
  }
  return {
    contacts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      blocked: r.blocked,
      tags: byContact.get(r.id) ?? [],
    })),
    tags: tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
  };
}

/** Send one broadcast NOW to the hand-picked contacts. Creates the one-off
 *  campaign and drives the chunked send to completion, so the caller makes a
 *  single call. Returns the cumulative sent / failed / recipient counts. */
export async function sendBroadcast(input: {
  contactIds: string[];
  templateName: string;
  templateLang: string;
  templateBody: string;
  /** The template's saved {{n}} mapping, so a template with variables resolves
   *  per-contact exactly as a campaign would. Empty for a no-variable template. */
  bindings: VarBinding[];
  confirm: string;
}): Promise<SendResult> {
  if (input.confirm !== "SEND") return { ok: false, error: "This send was not confirmed." };
  const c = await ctx();
  if (!c) return { ok: false, error: "Not signed in." };
  const ids = [...new Set(input.contactIds.filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: "Pick at least one contact to broadcast to." };
  if (!input.templateName) return { ok: false, error: "Pick an approved template first." };

  const spec: CampaignSpec = {
    v: SPEC_VERSION,
    templateName: input.templateName,
    templateLang: input.templateLang || "en",
    templateBody: input.templateBody,
    bindings: input.bindings ?? [],
    audience: { kind: "ids", contactIds: ids },
  };
  const stamp = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const saved = await saveCampaign({ name: `Broadcast ${stamp}`, channelId: "", spec });
  if (!saved.ok || !saved.id) {
    return { ok: false, error: saved.error ?? "Could not create the broadcast." };
  }

  // Drive the chunked send to the end. Each call sends SEND_CHUNK and reports
  // how many remain; the cap is a safety belt, not an expected limit.
  let last: SendResult = { ok: true, sent: 0, failed: 0, recipients: 0, remaining: 0 };
  for (let i = 0; i < 1000; i++) {
    last = await sendCampaignNow({ campaignId: saved.id, confirm: "SEND" });
    if (!last.ok) return last;
    if (!last.remaining || last.remaining <= 0) break;
  }
  return last;
}
