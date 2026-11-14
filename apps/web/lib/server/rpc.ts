// Server-side NEAR RPC: fails over between public endpoints so one throttled RPC
// doesn't take the app down.
import { FailoverRpcError, FailoverRpcProvider, JsonRpcProvider } from "near-api-js";
import { InvalidNonceError } from "near-api-js/rpc-errors";
import { RPC_UPSTREAM } from "@/lib/config";

// rpc.*.near.org is deprecated and refuses traffic, so the fallbacks are dRPC and FastNEAR's second host.
const MAINNET = process.env.NEXT_PUBLIC_NETWORK === "mainnet";
export const RPC_ENDPOINTS = [
  RPC_UPSTREAM,
  MAINNET ? "https://near.drpc.org" : "https://near-testnet.drpc.org",
  MAINNET ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com",
].filter((url, i, all) => all.indexOf(url) === i);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A throttled or unreachable RPC, as opposed to an answer from the chain. */
function throttled(e: unknown): boolean {
  const cause = (e as { cause?: unknown }).cause;
  if (typeof cause === "number") return [408, 429, 500, 502, 503].includes(cause);
  return /fetch failed|Failed to fetch|timeout|ECONN|UND_ERR|socket/i.test(`${e} ${(cause as Error | undefined)?.message ?? ""}`);
}

/**
 * Every call tries each RPC in order. near-api-js's FailoverRpcProvider keeps one "current" RPC for
 * all calls, so concurrent calls move it under each other and one call can try the same throttled
 * RPC three times; and it wraps every error, so Account never saw the "invalid nonce" it retries
 * on with a fresh nonce (two demo runs signing at once gave "Exceeded 3 providers" and could leave
 * a verdict unsubmitted). Here that answer is handed straight back, and when every RPC was only
 * throttled or unreachable, the list is tried again after a short wait.
 */
function failover(providers: JsonRpcProvider[]): JsonRpcProvider {
  const rpcMethod = (prop: PropertyKey) =>
    typeof prop === "string" && prop !== "constructor" && typeof (FailoverRpcProvider.prototype as unknown as Record<string, unknown>)[prop] === "function";
  return new Proxy(providers[0], {
    get(target, prop, receiver) {
      if (!rpcMethod(prop)) return Reflect.get(target, prop, receiver);
      return async (...args: unknown[]) => {
        const errors: unknown[] = [];
        for (let round = 0; round < 3; round++) {
          if (round) await sleep(400 * round + Math.random() * 600);
          const before = errors.length;
          for (const provider of providers) {
            try {
              return await (provider as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop as string](...args);
            } catch (e) {
              if (e instanceof InvalidNonceError) throw e;
              errors.push(e);
            }
          }
          if (!errors.slice(before).every(throttled)) break;
        }
        throw new FailoverRpcError(providers.length, errors);
      };
    },
  });
}

let shared: JsonRpcProvider | null = null;

export function serverRpc(): JsonRpcProvider {
  shared ??= failover(RPC_ENDPOINTS.map((url) => new JsonRpcProvider({ url })));
  return shared;
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
