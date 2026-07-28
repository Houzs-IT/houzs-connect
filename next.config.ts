import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // react-flow (@xyflow/react) v12 measures nodes/handles via ResizeObserver; React's
  // dev-only StrictMode double-mount can leave edges unrendered. Disable it so the
  // flow builder measures cleanly. (No effect on production behavior.)
  reactStrictMode: false,
  // Silence the multi-lockfile workspace-root warning (this app has its own lockfile).
  turbopack: { root: __dirname },
};

export default nextConfig;
