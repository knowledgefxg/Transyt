import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2gb" },
    middlewareClientMaxBodySize: "2gb",
  },
};

export default nextConfig;
