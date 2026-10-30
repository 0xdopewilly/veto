export type Network = "testnet" | "mainnet";

export const NETWORK: Network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** The demo business on testnet. The vault itself has no name on-chain. */
export const VAULT_NAME = process.env.NEXT_PUBLIC_VAULT_NAME ?? "Lagoon Goods";

export const VAULT_ID = process.env.NEXT_PUBLIC_VAULT_ID ?? "treasury.veto-lagoon-dygj2w.testnet";

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (NETWORK === "testnet" ? "https://test.rpc.fastnear.com" : "https://free.rpc.fastnear.com");

export const EXPLORER = NETWORK === "testnet" ? "https://testnet.nearblocks.io" : "https://nearblocks.io";

export const GITHUB_URL = "https://github.com/0xdopewilly/veto";

export const POLL_MS = 3000;

export const explorerAddress = (accountId: string) => `${EXPLORER}/address/${accountId}`;

export const verifierUrl = (model: string) => `https://cloud.near.ai/verify?model=${encodeURIComponent(model)}`;
