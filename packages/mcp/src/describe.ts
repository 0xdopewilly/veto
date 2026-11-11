// Plain-words descriptions of payments and vault rules, shared by the sandbox and own-vault tools.
import { formatAmount, REASON_TEXT, type ReasonCode } from "@veto/core/prompt";
import type { Payee, Proposal, Status, VaultConfig } from "@veto/core/proposal";

export interface AssetMeta {
  symbol: string;
  decimals: number;
}

export interface AssetPolicy {
  period_limit: string;
  max_single: string;
}

export interface SpendStatus {
  asset: string;
  spent: string;
  period_limit: string;
  remaining: string;
  /** Unix seconds. */
  resets_at: string;
}

/** Where the wait for a decision stops: screening is over and the vault has acted (or the owner has). */
export const DECIDED: readonly Status[] = ["Paid", "Vetoed", "Expired", "Cancelled", "Failed", "OverridePending"];

export const EXPLORER = { testnet: "https://testnet.nearblocks.io", mainnet: "https://nearblocks.io" } as const;

const STATUS_TEXT: Record<Status, string> = {
  Screening:
    "Waiting for the private screen: the model in NEAR AI Cloud's enclave hasn't returned a signed verdict yet. If none arrives by the screening deadline, the payment expires unpaid.",
  Executing: "Passed the caps and the private screen; the payout is being sent.",
  Paid: "Passed the vault's hard caps and the private screen; the vault checked the enclave's signature on-chain and paid.",
  Vetoed:
    "The model in NEAR AI Cloud's enclave said VETO and the vault checked its signature on-chain, so nothing was paid. The vault's owner can override it after a delay, or keep it blocked.",
  OverridePending: "Vetoed, then the vault's owner overrode the veto: it pays when the override delay ends, still inside the caps, unless the owner cancels.",
  Cancelled: "Closed without paying: the owner kept the veto, or cancelled the override.",
  Expired: "No signed verdict arrived before the screening deadline, so the vault never paid it. Without a signed PASS, Veto does not pay.",
  Failed: "Passed the screen, but the transfer itself failed: nothing was sent, and the amount no longer counts against the caps.",
};

/** Nanoseconds since the epoch, as the contract stores them, to an ISO time. */
export const isoFromNs = (ns: string | null | undefined) => (ns ? new Date(Number(BigInt(ns) / 1_000_000n)).toISOString() : null);

export function reasonText(code: string): string {
  return REASON_TEXT[code as ReasonCode] ?? code.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** What the app and scripts know about an asset id: native NEAR, an EVM coin "<chain>:<coin>", or a NEP-141 token. */
export function knownAsset(asset: string): AssetMeta | null {
  if (asset === "near") return { symbol: "NEAR", decimals: 24 };
  if (asset.includes(":")) return { symbol: asset.split(":")[1].toUpperCase(), decimals: 18 };
  return null;
}

/** "180.5" with 6 decimals -> "180500000". Refuses anything that isn't a plain positive number with at most `decimals` places. */
export function toUnits(amount: string, decimals: number): string {
  const s = amount.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`"${amount}" is not a plain number like 180 or 180.50`);
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`"${amount}" has more than ${decimals} decimal places`);
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
  if (units <= 0n) throw new Error("the amount must be more than zero");
  return units.toString();
}

const EVM_EXPLORER: Record<string, string> = {
  "84532": "https://sepolia.basescan.org",
  "8453": "https://basescan.org",
  "11155111": "https://sepolia.etherscan.io",
};

/** The payout's own transaction when it isn't the verdict's: a Base transfer, or what an OutLayer wallet sent. */
export function payoutTx(p: Proposal, explorer: string): string | null {
  if (p.evm?.tx_hash && EVM_EXPLORER[p.evm.chain_id]) return `${EVM_EXPLORER[p.evm.chain_id]}/tx/${p.evm.tx_hash}`;
  if (p.external?.tx_hash) return `${explorer}/txns/${p.external.tx_hash}`;
  return null;
}

export interface Links {
  proposal_tx?: string;
  verdict_tx?: string;
  payout_tx?: string;
  decision_page?: string;
  proof_page?: string;
  vault?: string;
}

const LINK_LABEL: Record<keyof Links, string> = {
  proposal_tx: "Proposal transaction",
  verdict_tx: "Verdict transaction (the vault checks the enclave's signature; on a PASS, a payment on NEAR is paid in this transaction)",
  payout_tx: "Payout transaction",
  decision_page: "Decision",
  proof_page: "Proof (hashes, signer, the on-chain signature check, and the enclave check)",
  vault: "Vault on the explorer",
};

export interface Described {
  id: string;
  status: Status;
  decided: boolean;
  explanation: string;
  payment: { payee: string; payee_name: string | null; amount: string; symbol: string; asset: string; chain: string; reference: string | null };
  verdict: { verdict: "PASS" | "VETO"; reasons: { code: string; text: string }[]; model: string; signer: string; recorded_at: string | null } | null;
  screen_deadline: string | null;
  override_executes_at: string | null;
  links: Links;
}

export function describeProposal(p: Proposal, asset: AssetMeta | undefined, payees: Payee[], links: Links): Described {
  const meta = asset ?? knownAsset(p.request.asset) ?? { symbol: p.request.asset, decimals: 0 };
  const listed = payees.find((x) => x.chain.toLowerCase() === p.request.chain.toLowerCase() && x.address.toLowerCase() === p.request.payee.toLowerCase());
  return {
    id: p.id,
    status: p.status,
    decided: DECIDED.includes(p.status),
    explanation: STATUS_TEXT[p.status] ?? p.status,
    payment: {
      payee: p.request.payee,
      payee_name: listed?.name ?? null,
      amount: formatAmount(p.request.amount, meta.decimals),
      symbol: meta.symbol,
      asset: p.request.asset,
      chain: p.request.chain,
      reference: p.request.memo,
    },
    verdict: p.verdict
      ? {
          verdict: p.verdict.pass ? "PASS" : "VETO",
          reasons: p.verdict.reasons.map((code) => ({ code, text: reasonText(code) })),
          model: p.verdict.model_id,
          signer: p.verdict.signer,
          recorded_at: isoFromNs(p.verdict.recorded_at),
        }
      : null,
    screen_deadline: p.status === "Screening" ? isoFromNs(p.screen_deadline) : null,
    override_executes_at: p.status === "OverridePending" ? isoFromNs(p.override_executes_at) : null,
    links: Object.fromEntries(Object.entries(links).filter(([, v]) => v)) as Links,
  };
}

/** The same, as text a person (or a model) reads top to bottom. */
export function proposalText(d: Described): string {
  const pay = d.payment;
  const to = pay.payee_name ? `${pay.payee_name} (${pay.payee})` : pay.payee;
  const where = pay.chain === "near" ? "" : ` on ${pay.chain}`;
  const lines = [
    `${d.status}. ${d.explanation}`,
    "",
    `Payment #${d.id}: ${pay.amount} ${pay.symbol} to ${to}${where}${pay.reference ? `, reference ${pay.reference}` : ""}.`,
  ];
  if (d.verdict) {
    lines.push(`Verdict: ${d.verdict.verdict} from ${d.verdict.model}, signed in NEAR AI Cloud's enclave by ${d.verdict.signer}.`);
    if (d.verdict.reasons.length) {
      lines.push("Reasons:");
      for (const r of d.verdict.reasons) lines.push(`- ${r.text} (${r.code})`);
    }
  }
  if (d.screen_deadline) lines.push(`Screening deadline: ${d.screen_deadline}.`);
  if (d.override_executes_at) lines.push(`Override pays at: ${d.override_executes_at}.`);
  const links = Object.entries(d.links) as [keyof Links, string][];
  if (links.length) {
    lines.push("", "Links:");
    for (const [k, url] of links) lines.push(`- ${LINK_LABEL[k]}: ${url}`);
  }
  return lines.join("\n");
}

export interface RulesInput {
  vaultId: string;
  network: string;
  config: VaultConfig;
  payees: Payee[];
  policies: [string, AssetPolicy][];
  spend: Record<string, SpendStatus>;
  assets: Record<string, AssetMeta>;
  pending?: [string, { policy: AssetPolicy; effective_at: string }][];
}

const duration = (secs: string | number) => {
  const s = Number(secs);
  if (s === 604800) return "week";
  if (s % 86400 === 0) return s === 86400 ? "day" : `${s / 86400} days`;
  if (s % 3600 === 0) return s === 3600 ? "hour" : `${s / 3600} hours`;
  return `${s} s`;
};

export function describeRules(r: RulesInput) {
  const caps = r.policies.map(([asset, policy]) => {
    const meta = r.assets[asset] ?? knownAsset(asset) ?? { symbol: asset, decimals: 0 };
    const spend = r.spend[asset];
    const fmt = (raw: string) => formatAmount(raw, meta.decimals);
    return {
      asset,
      symbol: meta.symbol,
      max_per_payment: fmt(policy.max_single),
      limit_per_period: fmt(policy.period_limit),
      period: duration(r.config.period_secs),
      spent_this_period: spend ? fmt(spend.spent) : null,
      left_this_period: spend ? fmt(spend.remaining) : null,
      period_resets_at: spend ? new Date(Number(spend.resets_at) * 1000).toISOString() : null,
    };
  });
  const pending = (r.pending ?? []).map(([asset, { policy, effective_at }]) => {
    const meta = r.assets[asset] ?? knownAsset(asset) ?? { symbol: asset, decimals: 0 };
    return { asset, symbol: meta.symbol, max_per_payment: formatAmount(policy.max_single, meta.decimals), limit_per_period: formatAmount(policy.period_limit, meta.decimals), effective_at: isoFromNs(effective_at) };
  });
  return {
    vault: r.vaultId,
    network: r.network,
    owner: r.config.owner,
    frozen: r.config.frozen,
    mandate: r.config.mandate,
    payee_list_enforced_on_chain: r.config.require_listed_payee,
    caps,
    pending_cap_changes: pending,
    payees: r.payees.map((p) => ({ name: p.name, chain: p.chain, address: p.address })),
    override_delay_seconds: Number(r.config.override_delay_secs),
    screening_timeout_seconds: Number(r.config.screen_timeout_secs),
  };
}

export function rulesText(d: ReturnType<typeof describeRules>): string {
  const lines = [
    `Vault ${d.vault} on NEAR ${d.network}, owned by ${d.owner}.${d.frozen ? " It is frozen: it refuses every new payment until the owner unfreezes it." : ""}`,
    "",
    `Mandate (the owner's rules, which the screen reads): ${d.mandate || "(none)"}`,
    "",
    "Hard caps, checked by the vault contract when a payment is proposed and again when it pays:",
  ];
  for (const c of d.caps) {
    const left = c.left_this_period !== null ? `; ${c.spent_this_period} spent, ${c.left_this_period} left until ${c.period_resets_at}` : "";
    lines.push(`- ${c.symbol} (${c.asset}): at most ${c.max_per_payment} a payment and ${c.limit_per_period} a ${c.period}${left}`);
  }
  for (const p of d.pending_cap_changes) lines.push(`- Pending change for ${p.symbol}: ${p.max_per_payment} a payment, ${p.limit_per_period} a period, from ${p.effective_at}`);
  lines.push("", `Payees (${d.payees.length}):`);
  for (const p of d.payees) lines.push(`- ${p.name}: ${p.address} (${p.chain})`);
  lines.push(
    "",
    d.payee_list_enforced_on_chain
      ? "The contract refuses payees that aren't on the list."
      : "The contract doesn't refuse unlisted payees by itself; the screen flags them (NEW_PAYEE).",
    `A veto can be overridden by the owner after ${d.override_delay_seconds} s. A payment with no signed verdict after ${d.screening_timeout_seconds} s expires unpaid.`,
  );
  return lines.join("\n");
}
