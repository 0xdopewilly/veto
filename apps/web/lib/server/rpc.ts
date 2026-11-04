// Server-side NEAR RPC: fails over between public endpoints so one throttled RPC
// doesn't take the app down.
import { FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { RPC_UPSTREAM } from "@/lib/config";

// rpc.*.near.org is deprecated and refuses traffic, so the fallbacks are dRPC and FastNEAR's second host.
const MAINNET = process.env.NEXT_PUBLIC_NETWORK === "mainnet";
export const RPC_ENDPOINTS = [
  RPC_UPSTREAM,
  MAINNET ? "https://near.drpc.org" : "https://near-testnet.drpc.org",
  MAINNET ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com",
].filter((url, i, all) => all.indexOf(url) === i);

let shared: FailoverRpcProvider | null = null;

export function serverRpc(): JsonRpcProvider {
  shared ??= new FailoverRpcProvider(RPC_ENDPOINTS.map((url) => new JsonRpcProvider({ url })));
  // FailoverRpcProvider implements the same calls the app uses (callFunction, viewAccount).
  return shared as unknown as JsonRpcProvider;
}

/**
 * An account's NEAR balance in yocto from the first RPC that answers: null if the account doesn't
 * exist, undefined if no RPC answered. Raw JSON-RPC, because the failover provider wraps every
 * error, including "no such account", in its own.
 */
export async function accountBalance(accountId: string): Promise<bigint | null | undefined> {
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "veto", method: "query", params: { request_type: "view_account", finality: "optimistic", account_id: accountId } }),
      });
      const body = (await res.json()) as { result?: { amount?: string }; error?: { cause?: { name?: string } } };
      if (body.result?.amount !== undefined) return BigInt(body.result.amount);
      if (body.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
    } catch {
      // try the next RPC
    }
  }
  return undefined;
}
