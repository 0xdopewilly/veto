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
