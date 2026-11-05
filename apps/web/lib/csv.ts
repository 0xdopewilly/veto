// Activity as a CSV an accountant can open as is: one row per payment, plain numbers, UTC times, and
// a link to each payment's proof.
import type { Proposal } from "@veto/core/proposal";
import { evmTxUrl, payeeLabel, reasonText, STATUS_TEXT } from "./decision";
import { chainLabel, nsToDate } from "./format";
import { metaOf, type VaultState } from "./vault";

const HEADER = [
  "Payment",
  "Requested (UTC)",
  "Status",
  "Payee",
  "Payee account or address",
  "Chain",
  "Amount",
  "Currency",
  "Reference",
  "Requested by",
  "Veto verdict",
  "Reasons",
  "Paid (UTC)",
  "Transaction",
  "Proof",
];

/** "2026-11-04 14:32:10", from a NEAR timestamp in nanoseconds. */
const utc = (ns: string | null) => (ns && ns !== "0" ? nsToDate(ns).toISOString().replace("T", " ").slice(0, 19) : "");

/** A token amount as a plain number: no symbol or thousands separator, at least two decimals. */
function plainAmount(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${value / base}.${frac}`;
}

/**
 * One field, quoted when it holds a comma, quote or line break. A field a spreadsheet would run as
 * a formula (=, +, -, @) gets a leading apostrophe: an agent writes the memo, and it shouldn't be
 * able to plant a formula in the owner's books.
 */
function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function paymentsCsv(state: VaultState, proposals: Proposal[], origin: string, vaultId: string): string {
  const rows = proposals.map((p) => {
    const meta = metaOf(state, p.request.asset);
    const verdict = p.verdict ? (p.verdict.pass ? "Pass" : "Veto") : "";
    return [
      `#${p.id}`,
      utc(p.created_at),
      STATUS_TEXT[p.status],
      payeeLabel(state.payees, p),
      p.request.payee,
      chainLabel(p.request.chain),
      plainAmount(p.request.amount, meta.decimals),
      meta.symbol,
      p.request.memo ?? "",
      p.external ? `${p.external.wallet} (OutLayer wallet)` : p.agent,
      verdict,
      (p.verdict?.reasons ?? []).map(reasonText).join("; "),
      p.status === "Paid" ? utc(p.settled_at) : "",
      evmTxUrl(p) ?? "",
      `${origin}/app/decisions/${p.id}/proof?vault=${encodeURIComponent(vaultId)}`,
    ];
  });
  // CRLF line ends and a byte-order mark, so Excel opens it as UTF-8 with columns in place.
  return `\uFEFF${[HEADER, ...rows].map((r) => r.map(field).join(",")).join("\r\n")}\r\n`;
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
