// Server-only: the testnet demo's accounts. Every key here is a function-call key that can only
// call its own vault's methods (agent: propose; guardian: verdicts and external payments; demo
// owner: the owner methods). A vault created through the factory has its own agent and guardian
// accounts (<name>_agent, <name>_guard) holding keys limited to that vault; its owner signs every
// owner action from their own wallet. The OutLayer wallet's API key and the approver's key are
// for the sandbox's OutLayer path.
import { Account, type KeyPairString } from "near-api-js";
import { DEFAULT_MODEL, DevScreener, NearAiScreener, OutLayer, VaultReader, type Screener } from "@veto/core";
import { isKnownVault, SANDBOX_ID } from "@/lib/config";
import { serverRpc } from "./rpc";

const env = (key: string) => process.env[key]?.trim() ?? "";

export const demo = {
  enabled: env("DEMO_ENABLED") === "1" && env("NEXT_PUBLIC_NETWORK") !== "mainnet" && Boolean(env("DEMO_AGENT_KEY")),
  vaultId: env("NEXT_PUBLIC_VAULT_ID"),
  root: env("DEMO_ROOT"),
  token: env("DEMO_TOKEN"),
  agentId: env("DEMO_AGENT_ACCOUNT_ID"),
  guardianId: env("DEMO_GUARDIAN_ACCOUNT_ID"),
  ownerId: env("DEMO_OWNER_ACCOUNT_ID"),
  outlayerWallet: env("DEMO_OUTLAYER_WALLET"),
  factory: env("NEXT_PUBLIC_FACTORY_ID"),
};

interface OutLayerDemo {
  client: OutLayer;
  wallet: string;
  /** The wallet's own API key: what the agent holds. */
  walletKey: string;
  approver: { accountId: string; key: KeyPairString };
}

let cached: { reader: VaultReader; agent: Account; guardian: Account; owner: Account | null; screener: Screener; outlayer: OutLayerDemo | null } | null = null;

export function demoAccounts() {
  if (!demo.enabled) throw new Error("the testnet demo is not configured");
  if (!cached) {
    const rpc = serverRpc();
    const nearAiKey = env("NEARAI_API_KEY");
    cached = {
      reader: new VaultReader(demo.vaultId, rpc),
      agent: new Account(demo.agentId, rpc, env("DEMO_AGENT_KEY") as KeyPairString),
      guardian: new Account(demo.guardianId, rpc, env("DEMO_GUARDIAN_KEY") as KeyPairString),
      owner: env("DEMO_OWNER_KEY") ? new Account(demo.ownerId, rpc, env("DEMO_OWNER_KEY") as KeyPairString) : null,
      // The enclave model alone when a NEAR AI key is set, as on every factory vault: if NEAR AI
      // can't answer, the payment expires unpaid. Without a key (a local demo:setup), a test key the
      // vault was told to trust screens instead, and the app labels every decision it signs.
      screener: nearAiKey ? new NearAiScreener(nearAiKey, env("NEARAI_MODEL") || DEFAULT_MODEL) : new DevScreener(env("DEMO_TEST_SIGNER_KEY")),
      outlayer:
        demo.outlayerWallet && env("DEMO_OUTLAYER_WALLET_KEY") && env("DEMO_OUTLAYER_APPROVER_KEY")
          ? {
              client: new OutLayer("testnet"),
              wallet: demo.outlayerWallet,
              walletKey: env("DEMO_OUTLAYER_WALLET_KEY"),
              approver: { accountId: env("DEMO_OUTLAYER_APPROVER_ID"), key: env("DEMO_OUTLAYER_APPROVER_KEY") as KeyPairString },
            }
          : null,
    };
  }
  return cached;
}

/** The accounts that act on one vault: the sandbox's, or an owned vault's own agent and guardian. */
export interface VaultAccounts {
  vaultId: string;
  sandbox: boolean;
  reader: VaultReader;
  agent: Account;
  guardian: Account;
  /** The sandbox's demo owner. Owned vaults have none: their owner's wallet signs. */
  owner: Account | null;
  screener: Screener;
  outlayer: OutLayerDemo | null;
}

/** Whether the demo can act on vaults the factory created. */
export const ownedVaultsEnabled = () => demo.enabled && !!demo.factory && !!env("DEMO_OWNED_AGENT_KEY") && !!env("DEMO_OWNED_GUARDIAN_KEY") && !!env("NEARAI_API_KEY");

const owned = new Map<string, VaultAccounts>();
let screener: Screener | null = null;

/** `null` when this isn't a vault the demo acts on. */
export function vaultAccounts(vaultId: string = SANDBOX_ID): VaultAccounts | null {
  if (!demo.enabled || !isKnownVault(vaultId)) return null;
  if (vaultId === demo.vaultId || vaultId === SANDBOX_ID) return { vaultId: demo.vaultId, sandbox: true, ...demoAccounts() };
  if (!ownedVaultsEnabled()) return null;
  let found = owned.get(vaultId);
  if (!found) {
    const rpc = serverRpc();
    const name = vaultId.slice(0, vaultId.indexOf("."));
    // Only the model in the enclave: an owned vault trusts no test key, so if NEAR AI can't
    // answer, the payment expires unpaid.
    screener ??= new NearAiScreener(env("NEARAI_API_KEY"), env("NEARAI_MODEL") || DEFAULT_MODEL);
    found = {
      vaultId,
      sandbox: false,
      reader: new VaultReader(vaultId, rpc),
      agent: new Account(`${name}_agent.${demo.factory}`, rpc, env("DEMO_OWNED_AGENT_KEY") as KeyPairString),
      guardian: new Account(`${name}_guard.${demo.factory}`, rpc, env("DEMO_OWNED_GUARDIAN_KEY") as KeyPairString),
      owner: null,
      outlayer: null,
      screener,
    };
    owned.set(vaultId, found);
  }
  return found;
}

/** Who is asking, for per-visitor limits (Vercel sets x-forwarded-for). */
export const visitor = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

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
