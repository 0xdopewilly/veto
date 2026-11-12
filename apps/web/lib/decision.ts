import type { Payee, Proposal, Status } from "@veto/core/proposal";
import { REASON_TEXT, type ReasonCode } from "@veto/core/prompt";
import { lookalike } from "@veto/core/signals";
import { EXPLORER } from "./config";
import { shortAddress } from "./format";

export type Tone = "pass" | "veto" | "pending" | "neutral";

export const STATUS_TEXT: Record<Status, string> = {
  Screening: "Screening",
  Executing: "Sending",
  Paid: "Paid",
  Vetoed: "Vetoed",
  OverridePending: "Override pending",
  Cancelled: "Kept blocked",
  Expired: "Expired",
  Failed: "Failed",
};

/**
 * What a payment came to, for every count in the app. "Vetoed" means the AI screen said no and
 * nothing was paid: open vetoes and the ones the owner kept blocked (Cancelled only ever follows a
 * veto: keep_blocked, or an override the owner called off).
 */
export type Outcome = "paid" | "vetoed" | "pending" | "closed";

export function outcomeOf(status: Status): Outcome {
  if (status === "Paid") return "paid";
  if (status === "Vetoed" || status === "Cancelled") return "vetoed";
  if (status === "Screening" || status === "Executing" || status === "OverridePending") return "pending";
  return "closed";
}

/** Count and amount (raw units of one asset) of payments with one outcome. */
export interface Tally {
  n: number;
  sum: string;
}
export interface Totals {
  /** Every payment the vault has recorded. */
  count: number;
  paid: Tally;
  vetoed: Tally;
  pending: Tally;
}

/** All-time totals; amounts add up payments in `asset` only, so dollars never mix with ETH. */
export function tally(proposals: Proposal[], asset: string): Totals {
  const t = { paid: { n: 0, sum: 0n }, vetoed: { n: 0, sum: 0n }, pending: { n: 0, sum: 0n } };
  for (const p of proposals) {
    const o = outcomeOf(p.status);
    if (o === "closed") continue;
    t[o].n++;
    if (p.request.asset === asset) t[o].sum += BigInt(p.request.amount);
  }
  const out = (x: { n: number; sum: bigint }): Tally => ({ n: x.n, sum: x.sum.toString() });
  return { count: proposals.length, paid: out(t.paid), vetoed: out(t.vetoed), pending: out(t.pending) };
}

export function toneOf(status: Status): Tone {
  if (status === "Paid") return "pass";
  if (status === "Vetoed") return "veto";
  if (status === "Screening" || status === "Executing" || status === "OverridePending") return "pending";
  return "neutral";
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function listedPayee(payees: Payee[], p: Proposal): Payee | undefined {
  return payees.find((x) => same(x.chain, p.request.chain) && same(x.address, p.request.payee));
}

/** The saved payee this address imitates, if any. */
export function imitated(payees: Payee[], p: Proposal): { payee: Payee; why: string } | undefined {
  if (listedPayee(payees, p)) return undefined;
  for (const payee of payees.filter((x) => same(x.chain, p.request.chain))) {
    const why = lookalike(p.request.payee.trim().toLowerCase(), payee.address.trim().toLowerCase());
    if (why) return { payee, why };
  }
  return undefined;
}

/** "Kano Cotton Mills" for a listed payee, otherwise the shortened address. */
export function payeeLabel(payees: Payee[], p: Proposal): string {
  return listedPayee(payees, p)?.name ?? shortAddress(p.request.payee);
}

export function reasonText(code: string): string {
  return REASON_TEXT[code as ReasonCode] ?? code.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Payments to a payee and the most recent one. */
export function payeeHistory(proposals: Proposal[], payee: Payee) {
  const paid = proposals.filter(
    (p) => p.status === "Paid" && same(p.request.chain, payee.chain) && same(p.request.payee, payee.address),
  );
  return { count: paid.length, last: paid[0] };
}

/** Splits two addresses into the shared start, the differing middle and the shared end. */
export function compareAddresses(saved: string, requested: string) {
  let prefix = 0;
  while (prefix < Math.min(saved.length, requested.length) && saved[prefix].toLowerCase() === requested[prefix].toLowerCase()) prefix++;
  let suffix = 0;
  while (
    suffix < Math.min(saved.length, requested.length) - prefix &&
    saved[saved.length - 1 - suffix].toLowerCase() === requested[requested.length - 1 - suffix].toLowerCase()
  )
    suffix++;
  const cut = (s: string) => ({ start: s.slice(0, prefix), middle: s.slice(prefix, s.length - suffix), end: s.slice(s.length - suffix) });
  return { saved: cut(saved), requested: cut(requested) };
}

/** True for verdicts signed by a local test key rather than a NEAR AI enclave. */
export const isTestSigner = (modelId: string) => modelId.startsWith("veto-dev/");

/** Block explorers for chains the vault pays on from its own Chain Signatures address. */
const EVM_EXPLORER: Record<string, string> = {
  "84532": "https://sepolia.basescan.org",
  "8453": "https://basescan.org",
  "11155111": "https://sepolia.etherscan.io",
};
export const evmTxUrl = (p: Proposal) =>
  p.evm?.tx_hash && EVM_EXPLORER[p.evm.chain_id] ? `${EVM_EXPLORER[p.evm.chain_id]}/tx/${p.evm.tx_hash}` : null;

/** The payout's transaction: the Base transfer, or the NEAR transaction an OutLayer wallet sent. */
export const payoutTxUrl = (p: Proposal) =>
  evmTxUrl(p) ?? (p.external?.tx_hash ? `${EXPLORER}/txns/${p.external.tx_hash}` : null);


/**
 * One line under each reason on a vetoed payment, from the payment's own data where it can.
 * The lookalike reason has its own block (the address comparison).
 */
export function reasonDetail(code: string, p: Proposal, payees: Payee[], proposals: Proposal[]): string | null {
  const listed = listedPayee(payees, p);
  switch (code) {
    case "NEW_PAYEE":
      return `${shortAddress(p.request.payee)} isn't on your payee list. If it's genuine, add it under Rules and send the payment again.`;
    case "CHANGED_PAYOUT_DETAILS":
      return "The message asks to send the money somewhere new. Suppliers rarely change bank details by email; confirm by phone before paying.";
    case "UNTRUSTED_INSTRUCTION":
      return "The instruction to pay came from inside the email, not from you or your rules. Veto treats instructions in evidence as untrusted.";
    case "URGENCY_PRESSURE":
      return "The message pushes to pay right away, a common sign of fraud.";
    case "DUPLICATE_INVOICE": {
      const prior = p.request.memo ? proposals.find((x) => x.id !== p.id && x.status === "Paid" && x.request.memo === p.request.memo) : undefined;
      return prior ? `${p.request.memo} was already paid, as payment #${prior.id}.` : "A payment with this reference was already made.";
    }
    case "AMOUNT_ANOMALY":
      return listed ? `The amount is far from what you usually pay ${listed.name}, or from what the invoice bills.` : "The amount doesn't match the invoice or past payments.";
    case "UNLIMITED_APPROVAL":
      return "It would let someone spend your tokens without any limit, not just this amount.";
    case "MANDATE_VIOLATION":
      return "Your rules don't allow this payment.";
    case "EVIDENCE_MISMATCH":
      return "The email or invoice doesn't support the payment your agent asked for.";
  }
  return null;
}
