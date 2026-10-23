"use server";

import { revalidatePath } from "next/cache";
import { getCurrentMember } from "@/lib/current-member";
import { createKey, revokeKey } from "@/lib/api-keys";
import { can } from "@/lib/permissions";

export async function newApiKey(name: string): Promise<{ ok: boolean; key?: string; error?: string }> {
  const me = await getCurrentMember();
  if (!me || !(await can(me, "settings"))) return { ok: false, error: "Your role cannot manage API keys." };
  const clean = name.trim().slice(0, 60);
  if (!clean) return { ok: false, error: "Give the key a name." };
  const key = await createKey(me.companyId, clean, me.id);
  revalidatePath("/settings/developers");
  return { ok: true, key };
}

export async function revokeApiKey(id: string): Promise<{ ok: boolean }> {
  const me = await getCurrentMember();
  if (!me || !(await can(me, "settings"))) return { ok: false };
  await revokeKey(me.companyId, id);
  revalidatePath("/settings/developers");
  return { ok: true };
}
