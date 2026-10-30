import type { Payee, PaymentRequest, Proposal } from "./proposal.ts";

/**
 * Deterministic risk signals computed before the AI screen. They are handed to the
 * model as facts; the model still decides. Each code matches a reason the model may return.
 */
export type SignalCode =
  | "LISTED_PAYEE"
  | "NEW_PAYEE"
  | "LOOKALIKE_ADDRESS"
  | "DUPLICATE_INVOICE"
  | "AMOUNT_ANOMALY";

export interface Signal {
  code: SignalCode;
  detail: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const isEvm = (s: string) => /^0x[0-9a-f]{40}$/i.test(s.trim());

export function computeSignals(request: PaymentRequest, payees: Payee[], history: Proposal[]): Signal[] {
  const signals: Signal[] = [];
  const target = norm(request.payee);
  const sameChain = payees.filter((p) => norm(p.chain) === norm(request.chain));
  const listed = sameChain.find((p) => norm(p.address) === target);

  if (listed) {
    signals.push({ code: "LISTED_PAYEE", detail: `Payee is on the list as "${listed.name}".` });
  } else {
    const paidBefore = history.some((p) => p.status === "Paid" && norm(p.request.payee) === target);
    if (!paidBefore) signals.push({ code: "NEW_PAYEE", detail: "This address is not on the payee list and has never been paid." });
    for (const p of sameChain) {
      const why = lookalike(target, norm(p.address));
      if (why) {
        signals.push({ code: "LOOKALIKE_ADDRESS", detail: `Looks like ${p.name}'s saved address ${p.address} (${why}).` });
      }
    }
  }

  const memo = request.memo?.trim();
  if (memo) {
    const dup = history.find((p) => p.status === "Paid" && p.request.memo?.trim() === memo);
    if (dup) signals.push({ code: "DUPLICATE_INVOICE", detail: `Reference "${memo}" was already paid in proposal ${dup.id}.` });
  }

  const pastToPayee = history
    .filter((p) => p.status === "Paid" && norm(p.request.payee) === target && p.request.asset === request.asset)
    .map((p) => BigInt(p.request.amount));
  if (pastToPayee.length >= 2) {
    const max = pastToPayee.reduce((a, b) => (a > b ? a : b));
    if (BigInt(request.amount) > max * 2n) {
      signals.push({ code: "AMOUNT_ANOMALY", detail: "More than twice the largest past payment to this payee." });
    }
  }
  return signals;
}

/** Why `candidate` looks like `saved`, or null. Exact matches are not lookalikes. */
export function lookalike(candidate: string, saved: string): string | null {
  if (candidate === saved) return null;
  if (isEvm(candidate) && isEvm(saved)) {
    const a = candidate.slice(2);
    const b = saved.slice(2);
    let prefix = 0;
    while (prefix < a.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (suffix < a.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
    if (prefix >= 4 && suffix >= 4) return `same first ${prefix} and last ${suffix} characters`;
    return null;
  }
  const distance = levenshtein(skeleton(candidate), skeleton(saved));
  if (distance === 0) return "visually identical characters";
  if (distance <= 2 && Math.min(candidate.length, saved.length) >= 6) return `${distance} character${distance > 1 ? "s" : ""} different`;
  return null;
}

/** Folds characters that are easy to confuse at a glance. */
function skeleton(s: string): string {
  return s.replace(/rn/g, "m").replace(/vv/g, "w").replace(/[1il|]/g, "l").replace(/0/g, "o").replace(/5/g, "s");
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
