export type Network = "testnet" | "mainnet";

export const NETWORK: Network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** The shared sandbox: a demo business anyone can try without a wallet. */
export const SANDBOX_NAME = process.env.NEXT_PUBLIC_VAULT_NAME ?? "Lagoon Goods";

export const SANDBOX_ID = process.env.NEXT_PUBLIC_VAULT_ID ?? "treasury.veto-rhwe0krb.testnet";

/** Creates vaults owned by whoever calls it (the vault code is a NEAR global contract). */
export const FACTORY_ID = process.env.NEXT_PUBLIC_FACTORY_ID ?? "vaults.veto-rhwe0krb.testnet";

const FACTORY_VAULT = FACTORY_ID ? new RegExp(`^[a-z0-9]+(-[a-z0-9]+)*\\.${FACTORY_ID.replace(/[.-]/g, "\\$&")}$`) : null;

/** Vaults this app opens: the sandbox, and vaults the factory created. */
export function isKnownVault(id: string): boolean {
  return id === SANDBOX_ID || !!FACTORY_VAULT?.test(id);
}

/** The public NEAR RPC the app's server talks to (also shown in code samples). */
export const RPC_UPSTREAM =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (NETWORK === "testnet" ? "https://test.rpc.fastnear.com" : "https://free.rpc.fastnear.com");

/**
 * In the browser, reads go through the app's own /api/rpc, which caches identical calls for a
 * moment and retries another RPC, so a throttled free RPC can't leave the screen loading.
 */
export const RPC_URL = typeof window === "undefined" ? RPC_UPSTREAM : `${window.location.origin}/api/rpc`;

export const EXPLORER = NETWORK === "testnet" ? "https://testnet.nearblocks.io" : "https://nearblocks.io";
/** NEAR's own public RPC: what the Proof page reads the chain from, so it doesn't take our server's word. */
export const PUBLIC_RPC = NETWORK === "testnet" ? "https://rpc.testnet.near.org" : "https://rpc.mainnet.near.org";
/** Public store of the sandbox's published proof bytes (lib/server/proofs.ts). Anyone can read it. */
export const PROOF_BASE = process.env.NEXT_PUBLIC_PROOF_BASE ?? "https://axon0nurb8ormdne.public.blob.vercel-storage.com";

export const GITHUB_URL = "https://github.com/0xdopewilly/veto";

export const POLL_MS = 3000;

export const explorerAddress = (accountId: string) => `${EXPLORER}/address/${accountId}`;

export const verifierUrl = (model: string) => `https://cloud.near.ai/verify?model=${encodeURIComponent(model)}`;
