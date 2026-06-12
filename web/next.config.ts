import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), ".."),
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    externalDir: true,
  },
  turbopack: {},
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };
    if (isServer) {
      config.externals = config.externals ?? [];
      if (Array.isArray(config.externals)) {
        config.externals.push("better-sqlite3");
      } else {
        config.externals = [config.externals, "better-sqlite3"];
      }
    }
    return config;
  },
};

export default nextConfig;
