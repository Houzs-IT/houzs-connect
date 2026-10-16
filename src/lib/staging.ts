import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  metaWriteRefusal,
  parsePhoneList,
  recipientRefusal,
  restUrlRefusal,
} from "./staging-fence";

// The Worker-env side of src/lib/staging-fence.ts. Read from the Worker env as
// well as process.env: `next dev` puts .dev.vars on the former only.
type FenceVar = "CONNECT_STAGING" | "STAGING_ALLOWED_PHONES" | "STAGING_RELAY_PHONES";

function envVar(name: FenceVar): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    return getCloudflareContext().env[name];
  } catch {
    return undefined; // not inside the Worker (seed script, tests)
  }
}

export function isStaging(): boolean {
  return envVar("CONNECT_STAGING") === "1";
}

export function stagingRecipientRefusal(to: string): string | null {
  const staging = isStaging();
  return recipientRefusal(to, staging, staging ? parsePhoneList(envVar("STAGING_ALLOWED_PHONES")) : new Set());
}

export function stagingRestRefusal(url: string): string | null {
  return restUrlRefusal(url, isStaging());
}

export function stagingMetaWriteRefusal(method: string | undefined): string | null {
  return metaWriteRefusal(method, isStaging());
}

/** Production only: the testers whose deliveries go to staging. */
export function stagingRelayPhones(): Set<string> {
  return isStaging() ? new Set() : parsePhoneList(envVar("STAGING_RELAY_PHONES"));
}
