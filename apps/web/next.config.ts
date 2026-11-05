import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@veto/core"],
  // The enclave check's Intel quote verifier is WebAssembly it reads from its own folder at runtime.
  serverExternalPackages: ["@phala/dcap-qvl-node"],
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
};

export default config;
