import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-flow (@xyflow/react) v12 measures nodes/handles via ResizeObserver; React's
  // dev-only StrictMode double-mount can leave edges unrendered. Disable it so the
  // flow builder measures cleanly. (No effect on production behavior.)
  reactStrictMode: false,
  // Silence the multi-lockfile workspace-root warning (this app has its own lockfile).
  turbopack: { root: __dirname },
  experimental: {
    // Server actions cap their request body at 1 MB by default, and the inbox
    // composer sends files through one — so without this every photo above 1 MB
    // is rejected by Next before it ever reaches the upload code. 20 MB leaves
    // room for the 16 MB document cap (src/lib/whatsapp/media-limits.ts) plus
    // multipart overhead. It is deliberately NOT Meta's 100 MB: the action runs
    // inside a Cloudflare Worker with a 128 MB isolate, so a file that big
    // cannot be held in memory no matter what this number says.
    serverActions: { bodySizeLimit: "20mb" },
  },
  // Keep sharp out of the server file trace. On a Linux CI runner this one
  // package turned "Collecting build traces" into an ~11-minute, ~2 GB crawl:
  //
  // - nft special-cases sharp: on reaching sharp/lib/index.js it globs every
  //   package in sharp's optionalDependencies (@img/sharp-<platform>/**/*).
  // - pnpm (11.x, Linux) links each optional platform package it skipped to
  //   `../../../../..` — the repo root. So ~19 of those globs walk the whole
  //   checkout, node_modules included (which contains the same links again).
  //   Windows pnpm creates no such links, which is why it builds in ~1.5 min.
  //
  // Nothing is lost: next-server only reaches sharp for the image optimizer,
  // which OpenNext no-ops, and OpenNext already drops node_modules/sharp and
  // node_modules/@img when it copies traced files into the Worker bundle.
  outputFileTracingExcludes: {
    "*": ["**/node_modules/sharp/**", "**/node_modules/@img/**"],
  },
  // Templates & Forms moved under Settings; keep old links and bookmarks working.
  async redirects() {
    return [
      { source: "/templates", destination: "/settings/templates", permanent: false },
      { source: "/templates/:path*", destination: "/settings/templates/:path*", permanent: false },
      { source: "/forms", destination: "/settings/forms", permanent: false },
      { source: "/forms/:path*", destination: "/settings/forms/:path*", permanent: false },
    ];
  },
};

export default nextConfig;

// OpenNext: make the Cloudflare bindings (HYPERDRIVE, vars, secrets) available
// through getCloudflareContext() during `next dev`, mirroring prod on Workers.
//
// Guarded to dev, and the rejection swallowed, for one reason each:
//
// - `next build` sets NODE_ENV=production. Calling this there spins up
//   wrangler's platform proxy, which THROWS on a Hyperdrive binding with no
//   localConnectionString — and there is no .dev.vars on a build machine. The
//   build does not need bindings: every page under (app) is force-dynamic, so
//   nothing queries at build time.
// - The call is async and was never awaited, so that throw surfaced as an
//   unhandledRejection — fatal in Node 22. Whether it killed the build was a
//   race against the build finishing first, which is why it passed for weeks
//   and then started failing with no relevant code change. A .catch() makes the
//   outcome the same every time.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev().catch((e: unknown) => {
    console.warn("[next.config] Cloudflare dev bindings unavailable:", e);
  });
}
