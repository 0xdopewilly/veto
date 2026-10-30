// Server-only: the testnet demo's accounts. Each key can only call its own vault methods
// (agent: propose; guardian: submit_verdict/expire; demo owner: the owner methods).
import { Account, type KeyPairString } from "near-api-js";
import { DEFAULT_MODEL, DevScreener, NearAiScreener, provider, VaultReader, type Screener } from "@veto/core";

const env = (key: string) => process.env[key]?.trim() ?? "";

export const demo = {
  enabled: env("DEMO_ENABLED") === "1" && env("NEXT_PUBLIC_NETWORK") !== "mainnet" && Boolean(env("DEMO_AGENT_KEY")),
  vaultId: env("NEXT_PUBLIC_VAULT_ID"),
  root: env("DEMO_ROOT"),
  token: env("DEMO_TOKEN"),
  agentId: env("DEMO_AGENT_ACCOUNT_ID"),
  guardianId: env("DEMO_GUARDIAN_ACCOUNT_ID"),
  ownerId: env("DEMO_OWNER_ACCOUNT_ID"),
};

let cached: { reader: VaultReader; agent: Account; guardian: Account; owner: Account | null; screener: Screener } | null = null;

export function demoAccounts() {
  if (!demo.enabled) throw new Error("the testnet demo is not configured");
  if (!cached) {
    const rpc = provider("testnet");
    const nearAiKey = env("NEARAI_API_KEY");
    cached = {
      reader: new VaultReader(demo.vaultId, rpc),
      agent: new Account(demo.agentId, rpc, env("DEMO_AGENT_KEY") as KeyPairString),
      guardian: new Account(demo.guardianId, rpc, env("DEMO_GUARDIAN_KEY") as KeyPairString),
      owner: env("DEMO_OWNER_KEY") ? new Account(demo.ownerId, rpc, env("DEMO_OWNER_KEY") as KeyPairString) : null,
      // The real model when a NEAR AI key is set; otherwise a test key the demo vault was told
      // to trust, which the app labels as a test signer on every decision it signs.
      screener: nearAiKey ? new NearAiScreener(nearAiKey, env("NEARAI_MODEL") || DEFAULT_MODEL) : new DevScreener(env("DEMO_TEST_SIGNER_KEY")),
    };
  }
  return cached;
}

/** Small in-memory limiter: at most `max` events per `windowMs` per bucket. */
const hits = new Map<string, number[]>();
export function allow(bucket: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  hits.set(bucket, recent);
  return true;
}
