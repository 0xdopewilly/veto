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
