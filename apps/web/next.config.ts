import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@veto/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
};

export default config;
