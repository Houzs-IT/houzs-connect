"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { ensureAutoReplyTable } from "@/db/ensure-auto-reply";
import { autoReply } from "@/db/schema";
import { getCurrentMember } from "@/lib/current-member";
import { DAYS, parseClock, type AutoReplySettings, type WeekHours } from "@/lib/auto-reply/decide";
import { MAX_REPLY_CHARS } from "@/lib/auto-reply/defaults";
import { isAdminRole } from "@/lib/permissions";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/** The first thing wrong with the settings, in words, or null. */
function problem(s: AutoReplySettings): string | null {
  if (s.welcomeText.length > MAX_REPLY_CHARS || s.awayText.length > MAX_REPLY_CHARS) {
    return `A WhatsApp message can be at most ${MAX_REPLY_CHARS} characters.`;
  }
  if (s.welcomeEnabled && !s.welcomeText.trim()) return "The welcome message is switched on but empty.";
  if (s.awayEnabled && !s.awayText.trim()) return "The away message is switched on but empty.";
  if (!Number.isInteger(s.welcomeAfterHours) || s.welcomeAfterHours < 1 || s.welcomeAfterHours > 720) {
    return "Greet again after: pick between 1 and 720 hours.";
  }
  if (!Number.isInteger(s.awayRepeatHours) || s.awayRepeatHours < 1 || s.awayRepeatHours > 168) {
    return "Repeat the away message after: pick between 1 and 168 hours.";
  }
  const hours = s.hours ?? {};
  for (const d of DAYS) {
    const slot = hours[d];
    if (!slot) continue;
    const open = parseClock(slot.open);
    const close = parseClock(slot.close);
    if (open === null || close === null) return `The hours for ${d} must be written like 09:00.`;
    if (open === close) return `The opening and closing time for ${d} are the same.`;
  }
  if (s.awayEnabled && !DAYS.some((d) => hours[d])) {
    return "The away message is on, but no day has opening hours — it would be sent to every message.";
  }
  return null;
}

/** Save the session company's auto replies (owner/admin only). */
export async function saveAutoReplies(input: AutoReplySettings): Promise<SaveResult> {
  const me = await getCurrentMember();
  if (!me || !isAdminRole(me.role)) {
    return { ok: false, error: "Only an owner or admin can change the automatic replies." };
  }
  const clean: AutoReplySettings = {
    ...input,
    welcomeText: input.welcomeText.replace(/\r\n/g, "\n"),
    awayText: input.awayText.replace(/\r\n/g, "\n"),
    timezone: "Asia/Kuala_Lumpur",
    hours: Object.fromEntries(
      DAYS.map((d) => [d, input.hours?.[d] ? { open: input.hours[d]!.open.trim(), close: input.hours[d]!.close.trim() } : null])
    ) as WeekHours,
  };
  const why = problem(clean);
  if (why) return { ok: false, error: why };

  const db = getDb();
  await ensureAutoReplyTable(db);
  const values = {
    companyId: me.companyId,
    welcomeEnabled: clean.welcomeEnabled,
    welcomeText: clean.welcomeText,
    welcomeAfterHours: clean.welcomeAfterHours,
    awayEnabled: clean.awayEnabled,
    awayText: clean.awayText,
    hours: clean.hours,
    timezone: clean.timezone,
    awayRepeatHours: clean.awayRepeatHours,
    updatedAt: new Date(),
    updatedBy: me.email,
  };
  await db
    .insert(autoReply)
    .values(values)
    .onConflictDoUpdate({ target: autoReply.companyId, set: values });
  revalidatePath("/settings/auto-replies");
  return { ok: true };
}
