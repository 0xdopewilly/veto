import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@veto/core"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
