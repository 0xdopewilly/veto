import type { Payee, Proposal, Status } from "@veto/core/proposal";
import { REASON_TEXT, type ReasonCode } from "@veto/core/prompt";
import { lookalike } from "@veto/core/signals";
import { shortAddress } from "./format";

export type Tone = "pass" | "veto" | "pending" | "neutral";

export const STATUS_TEXT: Record<Status, string> = {
  Screening: "Screening",
  Executing: "Sending",
  Paid: "Paid",
  Vetoed: "Vetoed",
  OverridePending: "Override pending",
  Cancelled: "Cancelled",
  Expired: "Expired",
  Failed: "Failed",
};

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
