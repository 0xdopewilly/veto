import { Account, JsonRpcProvider, teraToGas } from "near-api-js";
import type { Payee, PaymentRequest, Proposal, VaultConfig } from "./proposal.ts";

export const RPC = {
  testnet: "https://test.rpc.fastnear.com",
  mainnet: "https://free.rpc.fastnear.com",
} as const;
export type Network = keyof typeof RPC;

export function provider(network: Network = "testnet") {
  return new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? RPC[network] });
}

/** Read-only view of a vault. */
export class VaultReader {
  readonly vaultId: string;
  readonly rpc: JsonRpcProvider;

  constructor(vaultId: string, rpc: JsonRpcProvider) {
    this.vaultId = vaultId;
    this.rpc = rpc;
  }

  /** Reads optimistic state so a view right after a transaction sees its effects. */
  view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.rpc.callFunction({
      contractId: this.vaultId,
      method,
      args,
      blockQuery: { finality: "optimistic" },
    }) as Promise<T>;
  }

  config = () => this.view<VaultConfig>("get_config");
  payees = () => this.view<Payee[]>("get_payees");
  openProposals = () => this.view<Proposal[]>("get_open_proposals");
  proposal = (id: string) => this.view<Proposal | null>("get_proposal", { id });
  proposals = (fromIndex = 0, limit = 50) => this.view<Proposal[]>("get_proposals", { from_index: String(fromIndex), limit });
  /** Every proposal, newest first, a page of 100 (the contract's maximum) at a time. */
  allProposals = async (): Promise<Proposal[]> => {
    const seen = new Map<string, Proposal>();
    for (let from = 0; ; from += 100) {
      const page = await this.proposals(from, 100);
      // A proposal made while paging shifts the pages by one; the map drops the repeat.
      for (const p of page) if (!seen.has(p.id)) seen.set(p.id, p);
      if (page.length < 100) break;
    }
    return [...seen.values()].sort((a, b) => Number(b.id) - Number(a.id));
  };
  proposalHash = (id: string) => this.view<string>("get_proposal_hash", { id });
}

export async function propose(agent: Account, vaultId: string, request: PaymentRequest, contextHash: string | null) {
  return agent.callFunction<string>({
    contractId: vaultId,
    methodName: "propose",
    args: { request, context_hash: contextHash },
    gas: teraToGas("30"),
  });
}

export async function submitVerdict(
  guardian: Account,
  vaultId: string,
  args: { id: string; model_id: string; chat_id: string; request_hash: string; response: string; signature: string },
) {
  return guardian.callFunction<string>({
    contractId: vaultId,
    methodName: "submit_verdict",
    args,
    gas: teraToGas("150"),
  });
}
