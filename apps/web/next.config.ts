import path from "node:path";
import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@nora/ui", "@nora/brand"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The browser only talks to this origin; auth cookies stay first-party.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
