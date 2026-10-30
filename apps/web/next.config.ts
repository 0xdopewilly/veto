import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@veto/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
};

export default config;
