import { Account, teraToGas, type KeyPairString } from "near-api-js";
import { canonicalJson, provider, sha256Hex, VaultReader, type Network, type Proposal, type Status } from "@veto/core";

export interface VetoOptions {
  vaultId: string;
  agentAccountId: string;
  /** A function-call key that can only call `propose` on the vault. */
  agentKey: KeyPairString;
  /** Where the guardian receives private evidence. */
  guardianUrl: string;
  network?: Network;
}

export interface PaymentProposal {
  payee: string;
  /** Amount in the asset's smallest unit. Use `toUnits("300", 6)` for $300 of a 6-decimal token. */
  amount: string;
  /** "near" or a NEP-141 token contract. */
  asset: string;
  chain?: string;
  /** An invoice number or other reference. Goes on-chain. */
  memo?: string;
  /** Emails, invoices, the instruction that led here. Only its hash goes on-chain. */
  evidence?: unknown;
}

const FINAL: Status[] = ["Paid", "Vetoed", "Expired", "Cancelled", "Failed"];

/** Lets an agent propose payments to a Veto vault and wait for the decision. */
export class Veto {
  readonly #opts: VetoOptions;
  readonly #agent: Account;
  readonly vault: VaultReader;

  constructor(opts: VetoOptions) {
    this.#opts = opts;
    const rpc = provider(opts.network ?? "testnet");
    this.#agent = new Account(opts.agentAccountId, rpc, opts.agentKey);
    this.vault = new VaultReader(opts.vaultId, rpc);
  }

  async propose(payment: PaymentProposal) {
    let contextHash: string | null = null;
    if (payment.evidence !== undefined) {
      contextHash = sha256Hex(canonicalJson(payment.evidence));
      const res = await fetch(`${this.#opts.guardianUrl}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context_hash: contextHash, evidence: payment.evidence }),
      });
      if (!res.ok) throw new Error(`guardian refused the evidence: ${await res.text()}`);
    }
    const request = {
      chain: payment.chain ?? "near",
      asset: payment.asset,
      payee: payment.payee,
      amount: payment.amount,
      memo: payment.memo ?? null,
    };
    const outcome = await this.#agent.signAndSendTransaction({
      receiverId: this.#opts.vaultId,
      actions: [(await import("near-api-js")).actions.functionCall("propose", { request, context_hash: contextHash }, teraToGas("30"), 0n)],
      waitUntil: "FINAL",
    });
    const value = (outcome.status as { SuccessValue?: string }).SuccessValue;
    if (!value) throw new Error("the vault did not accept the proposal");
    const id: string = JSON.parse(Buffer.from(value, "base64").toString());
    return { id, contextHash, tx: outcome.transaction.hash, decision: () => this.decision(id) };
  }

  /** Resolves once the proposal is paid, vetoed, expired, cancelled or failed. */
  async decision(id: string, pollMs = 1500): Promise<Proposal> {
    for (;;) {
      const p = await this.vault.proposal(id);
      if (p && FINAL.includes(p.status)) return p;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

export function toUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
