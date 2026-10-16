// Staff logins on STAGING only. Production signs in against the Houzs ERP's
// public.users (lib/erp-auth.ts); staging has no ERP, so its own database holds
// those two tables and Connect writes them. Used by the Team page's "Create
// staging login" and by scripts/staging-setup.ts.

/** The two ERP tables sign-in reads, with only the columns it uses. */
export const STAFF_TABLES_DDL = [
  `CREATE TABLE IF NOT EXISTS public.roles (id serial PRIMARY KEY, name text NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS public.users (
    id serial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text,
    password_hash text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    role_id integer NOT NULL REFERENCES public.roles(id)
  )`,
];

/** ERP role names that roleFromErp maps back to each Connect role. */
export const STAGING_ROLE_NAMES = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  AGENT: "Agent",
  SALES: "Sales",
  VIEWER: "Viewer",
  DRIVER: "Driver",
} as const;
export type StagingRole = keyof typeof STAGING_ROLE_NAMES;

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Same PBKDF2 `salt$hash` format the ERP writes and verifyErpPassword checks. */
export async function hashStaffPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, key, 256);
  return `${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

/** 16 characters without look-alikes (0/O, 1/l/I), easy to read out. */
export function newStaffPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
