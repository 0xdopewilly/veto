import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { canonicalJson } from "./proposal.ts";

export const ONE_CLICK_URL = "https://1click.chaindefuser.com/v0";
/** 1Click's quote-signing key (from @defuse-protocol/one-click-sdk-typescript). */
export const ONE_CLICK_MANAGER_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";

/** NEAR Intents asset ids for USDC by chain (mainnet). */
export const USDC: Record<string, string> = {
  near: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  base: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  arbitrum: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
};

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  [k: string]: unknown;
}

export interface QuoteResponse {
  correlationId?: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequest;
  quote: Record<string, string | number | undefined>;
}

export async function requestQuote(req: QuoteRequest, jwt?: string): Promise<QuoteResponse> {
  const res = await fetch(`${ONE_CLICK_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(req),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`1Click quote failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  return body as QuoteResponse;
}

const REQUEST_FIELDS = [
  "dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo",
  "refundType", "recipient", "recipientType", "deadline", "quoteWaitingTimeMs", "referral", "virtualChainRecipient",
  "virtualChainRefundRecipient", "customRecipientMsg",
] as const;
const DRY_QUOTE_FIELDS = ["amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut", "amountOutFormatted", "amountOutUsd", "minAmountOut"] as const;
const LIVE_QUOTE_FIELDS = [...DRY_QUOTE_FIELDS, "depositAddress", "depositMemo", "deadline", "timeWhenInactive", "timeEstimate", "refundFee", "withdrawFee"] as const;

/**
 * The exact JSON 1Click signs: the request fields, then the quote fields, then the
 * timestamp, with sorted keys and empty values dropped. The vault contract verifies
 * 1Click's signature over this string and reads the payout terms from it.
 */
export function signedQuoteJson(r: QuoteResponse): string {
  const fields: Record<string, unknown> = {};
  for (const k of REQUEST_FIELDS) {
    const v = r.quoteRequest[k];
    fields[k] = ["dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline"].includes(k) ? v : v || undefined;
  }
  const quoteFields = r.quoteRequest.dry ? DRY_QUOTE_FIELDS : LIVE_QUOTE_FIELDS;
  for (const k of quoteFields) {
    const v = r.quote[k];
    fields[k] = (DRY_QUOTE_FIELDS as readonly string[]).includes(k) ? v : v || undefined;
  }
  fields.timestamp = r.timestamp;
  return canonicalJson(fields);
}

/** base58(sha256(json)): the message 1Click signs. */
export function quoteMessage(json: string): string {
  return base58.encode(sha256(new TextEncoder().encode(json)));
}

export function verifyQuote(r: QuoteResponse, managerKey = ONE_CLICK_MANAGER_KEY): boolean {
  try {
    const sig = base58.decode(r.signature.replace(/^ed25519:/, ""));
    const pub = base58.decode(managerKey.replace(/^ed25519:/, ""));
    return ed25519.verify(sig, new TextEncoder().encode(quoteMessage(signedQuoteJson(r))), pub);
  } catch {
    return false;
  }
}

/** How a vault pays a supplier on another chain (mirrors `Route` in the contract). */
export interface Route {
  token: string;
  origin_asset: string;
  destination_asset: string;
  max_fee_bps: number;
}

/**
 * An executable 1Click quote for a screened cross-chain payment: exactly the payee and amount
 * the vault screened, refunds to the vault, fees inside the route's cap. The vault checks all of
 * this again on-chain before it sends the deposit.
 */
export async function payoutQuote(opts: { vaultId: string; route: Route; payee: string; amount: string; jwt?: string }) {
  const r = await requestQuote(
    {
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: opts.route.origin_asset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: opts.route.destination_asset,
      amount: opts.amount,
      refundTo: opts.vaultId,
      refundType: "ORIGIN_CHAIN",
      // 1Click rejects mixed-case EVM addresses that fail the checksum; lowercase always passes.
      recipient: opts.payee.startsWith("0x") ? opts.payee.toLowerCase() : opts.payee,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
      referral: "veto",
    },
    opts.jwt,
  );
  if (!verifyQuote(r)) throw new Error("1Click's quote signature does not verify");
  const amountIn = BigInt(String(r.quote.amountIn));
  if (amountIn * 10_000n > BigInt(opts.amount) * BigInt(10_000 + opts.route.max_fee_bps)) {
    throw new Error(`1Click wants ${amountIn} for ${opts.amount}, over the route's ${opts.route.max_fee_bps} bps fee cap`);
  }
  return { json: signedQuoteJson(r), signature: r.signature, depositAddress: String(r.quote.depositAddress), amountIn: String(r.quote.amountIn) };
}

/** 1Click's view of a deposit: PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED… */
export async function payoutStatus(depositAddress: string, jwt?: string) {
  const res = await fetch(`${ONE_CLICK_URL}/status?depositAddress=${encodeURIComponent(depositAddress)}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  });
  if (!res.ok) throw new Error(`1Click status failed (${res.status})`);
  return (await res.json()) as { status: string; swapDetails?: { destinationChainTxHashes?: { hash: string; explorerUrl?: string }[] } };
}
