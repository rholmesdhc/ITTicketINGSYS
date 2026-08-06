import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Trimmed standalone server output for the production Docker image
  // (see frontend/Dockerfile) — avoids shipping the full node_modules.
  output: "standalone",
};

export default nextConfig;
