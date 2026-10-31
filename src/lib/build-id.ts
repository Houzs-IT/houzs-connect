// The build id this bundle was compiled with, inlined by next.config.ts.
// "dev" under `next dev` (no stamp) — the update check treats that as "skip".
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
