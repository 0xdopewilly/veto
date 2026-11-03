import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

export type Status =
  | "Screening"
  | "Executing"
  | "Paid"
  | "Vetoed"
  | "OverridePending"
  | "Cancelled"
  | "Expired"
  | "Failed";

export interface PaymentRequest {
  chain: string;
  asset: string;
  payee: string;
  amount: string;
  memo: string | null;
}

export interface VerdictRecord {
  pass: boolean;
  reasons: string[];
  model_id: string;
  signer: string;
  chat_id: string;
  request_hash: string;
  response_hash: string;
  recorded_at: string;
}

/** A payment held by an external agent wallet (e.g. OutLayer) until the guardian votes. */
export interface ExternalPayment {
  provider: string;
  wallet: string;
  approval_id: string;
  op_hash: string;
  tx_hash: string | null;
}

export interface Proposal {
  id: string;
  agent: string;
  request: PaymentRequest;
  context_hash: string | null;
  status: Status;
  created_at: string;
  screen_deadline: string;
  verdict: VerdictRecord | null;
  override_executes_at: string | null;
  settled_at: string | null;
  external?: ExternalPayment | null;
}

export interface Payee {
  name: string;
  chain: string;
  address: string;
  added_at: string;
}

export interface VaultConfig {
  owner: string;
  guardian: string;
  frozen: boolean;
  mandate: string;
  require_listed_payee: boolean;
  period_secs: string;
  period_anchor_secs: string;
  override_delay_secs: string;
  raise_delay_secs: string;
  screen_timeout_secs: string;
  proposal_count: string;
}

/** Runs in Node and the browser. */
export const sha256Hex = (data: string | Uint8Array): string =>
  bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));

/** Must match `proposal_hash_of` in contract/src/lib.rs exactly. */
export function proposalHash(vaultId: string, proposal: Pick<Proposal, "id" | "request" | "context_hash" | "external">): string {
  const r = proposal.request;
  const e = proposal.external;
  const parts = [
    "veto",
    "v1",
    vaultId,
    proposal.id,
    r.chain,
    r.asset,
    r.payee,
    r.amount,
    r.memo ?? "",
    proposal.context_hash ?? "",
    ...(e ? [e.provider, e.wallet, e.approval_id, e.op_hash] : []),
  ];
  return sha256Hex(parts.join(":"));
}

/** Canonical bytes of the private evidence an agent attaches to a proposal. */
export function evidenceBytes(evidence: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(evidence));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
