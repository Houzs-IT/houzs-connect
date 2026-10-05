"use server";

import { getCurrentMember } from "@/lib/current-member";
import { isAdminRole } from "@/lib/permissions";
import { probeReceiptAi, type ProbeResult } from "@/lib/receipt-vision";

/** Admins only: try the receipt AI's connection step by step and say what answered. */
export async function testReceiptAi(): Promise<ProbeResult | null> {
  const me = await getCurrentMember();
  if (!me || !isAdminRole(me.role)) return null;
  return probeReceiptAi();
}
