// Assign a WhatsApp number to the company whose customers it serves.
//
// Assigning writes the Meta phone number id onto a channel of that company, and
// from then on channel-routing.ts files deliveries to that number under the
// company and sends its replies from it. The rules below exist because a number
// carries history:
//
//   - A number whose channel already has conversations is never MOVED to another
//     company. Its contacts and threads belong to the first company; moving the
//     channel would hand them across. Refused, with the count.
//   - The Houzs number reaches its channel today only through the legacy default
//     (see channel-routing.ts). Assigning it to that same company just writes the
//     id down; assigning it anywhere else would split six live conversations off
//     their number, so that is refused the same way.
//   - A new company made here has no ERP counterpart (erp_company_id NULL). The
//     org sync only touches companies the ERP has, so it will never rename or
//     deactivate it.

import { and, count, eq, sql } from "drizzle-orm";
import { bypassReadCache } from "@/db/fresh";
import type { DB } from "@/db/client";
import { channel, company, conversation } from "@/db/schema";
import { channelForNumber, loadRoutingTable } from "./channels";

export type AssignTarget = { companyId: string } | { newCompanyName: string };

export type AssignResult =
  | { ok: true; companyName: string; createdCompany: boolean }
  | { ok: false; error: string };

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function conversationCount(db: DB, channelId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(conversation)
    .where(and(eq(conversation.channelId, channelId), bypassReadCache()));
  return row?.n ?? 0;
}

async function resolveCompany(
  db: DB,
  target: AssignTarget
): Promise<{ id: string; name: string; created: boolean } | { error: string }> {
  if ("companyId" in target) {
    const found = await db.query.company.findFirst({
      columns: { id: true, name: true, active: true },
      where: and(eq(company.id, target.companyId), bypassReadCache()),
    });
    if (!found || !found.active) return { error: "That company no longer exists." };
    return { id: found.id, name: found.name, created: false };
  }

  const name = target.newCompanyName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return { error: "A company name needs 2 to 60 characters." };
  }
  // Case-insensitive, and against inactive companies too: two companies that
  // differ only in case would be two inboxes nobody can tell apart.
  const clash = await db.query.company.findFirst({
    columns: { name: true },
    where: and(sql`lower(${company.name}) = ${name.toLowerCase()}`, bypassReadCache()),
  });
  if (clash) {
    return { error: `A company called "${clash.name}" already exists — pick it from the list instead.` };
  }
  const base = slugify(name) || "company";
  const taken = new Set(
    (await db.query.company.findMany({ columns: { slug: true }, where: bypassReadCache() })).map((c) => c.slug)
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const [created] = await db
    .insert(company)
    .values({ name, slug, code: base.replace(/-/g, "").toUpperCase().slice(0, 16) || null })
    .returning({ id: company.id, name: company.name });
  return { id: created.id, name: created.name, created: true };
}

export async function assignNumber(
  db: DB,
  number: { id: string; displayPhoneNumber: string; verifiedName: string | null },
  target: AssignTarget
): Promise<AssignResult> {
  const routing = await loadRoutingTable(db);
  const current = channelForNumber(routing, number.id);

  // Moving a number that already serves a company.
  if (current && "companyId" in target && current.channel.companyId === target.companyId) {
    if (!current.legacy) {
      const same = await resolveCompany(db, target);
      return "error" in same
        ? { ok: false, error: same.error }
        : { ok: true, companyName: same.name, createdCompany: false };
    }
  } else if (current) {
    const threads = await conversationCount(db, current.channel.id);
    if (threads > 0) {
      return {
        ok: false,
        error: `This number already has ${threads} conversation(s) in another company. Moving it would hand those customers to a different company, so it is not allowed here.`,
      };
    }
  }

  const target_ = await resolveCompany(db, target);
  if ("error" in target_) return { ok: false, error: target_.error };

  const phone = number.displayPhoneNumber.replace(/\D/g, "");
  const displayName = number.verifiedName?.trim() || number.displayPhoneNumber;

  try {
    if (current && !current.legacy && current.channel.companyId !== target_.id) {
      // An empty channel elsewhere let go of the number (checked above).
      await db.update(channel).set({ phoneNumberId: null }).where(eq(channel.id, current.channel.id));
    }

    if (current?.legacy && current.channel.companyId === target_.id) {
      // Write down what the legacy default already meant.
      await db
        .update(channel)
        .set({ phoneNumberId: number.id, phone, displayName, mode: "LIVE" })
        .where(eq(channel.id, current.channel.id));
    } else {
      const theirs = routing.channels.filter((c) => c.companyId === target_.id);
      await db.insert(channel).values({
        companyId: target_.id,
        displayName,
        phone,
        phoneNumberId: number.id,
        mode: "LIVE",
        // The first number a company gets is its default: campaigns and
        // automations that name no channel send from the default one.
        isDefault: !theirs.some((c) => c.isDefault),
      });
    }
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
    if (code === "23505") {
      return { ok: false, error: "Someone assigned this number a moment ago. Reload the page to see where it went." };
    }
    throw e;
  }

  return { ok: true, companyName: target_.name, createdCompany: target_.created };
}
