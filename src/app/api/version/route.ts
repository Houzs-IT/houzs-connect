// The build id of the currently deployed server, for the client's update check
// (components/shell/UpdateBanner.tsx). NEXT_PUBLIC_BUILD_ID is inlined at build
// (next.config.ts), so this returns THIS deploy's id; an open tab compares it to
// the id it booted with and offers a refresh when they differ.
//
// force-dynamic + no-store: a response cached at the edge would keep handing back
// the previous deploy's id and the banner would never appear.

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(
    JSON.stringify({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
