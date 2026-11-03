import { actions, teraToGas, type Account } from "near-api-js";
import { evmParams, evmRouteFor, vaultEvmAddress } from "./evm.ts";
import { payoutQuote, type Route } from "./intents.ts";
import { blockingIncident, ShieldHold, shieldIncidents } from "./shield.ts";
import type { SignedScreening } from "./nearai.ts";
import { proposalHash, type Proposal } from "./proposal.ts";
import { SYSTEM_PROMPT, userMessage } from "./prompt.ts";
import type { Screener } from "./screener.ts";
import { computeSignals, type Signal } from "./signals.ts";
import type { VaultReader } from "./vault.ts";

export interface Screened {
  result: SignedScreening;
  signals: Signal[];
  proposalHash: string;
  tx: string;
  ms: number;
}

const decimalsCache = new Map<string, number>([["near", 24]]);

async function decimalsOf(vault: VaultReader, asset: string) {
  if (!decimalsCache.has(asset)) {
    const meta = (await vault.rpc.callFunction({ contractId: asset, method: "ft_metadata", args: {} })) as { decimals: number };
    decimalsCache.set(asset, meta.decimals);
  }
  return decimalsCache.get(asset)!;
}

/**
 * Screens one proposal and submits the signed verdict on-chain:
 * mandate, payees and history from the vault, deterministic signals, the agent's private
 * evidence, a verdict signed over the exact request/response bytes, then submit_verdict.
 */
export async function screenAndSubmit(opts: {
  vault: VaultReader;
  guardian: Account;
  screener: Screener;
  proposal: Proposal;
  evidence: unknown;
  /** 1Click API key; optional, it only lowers 1Click's fee. */
  oneClickJwt?: string;
  /** NEAR Intents Shield key: holds cross-chain payouts while an incident touches their route. */
  shieldKey?: string;
}): Promise<Screened> {
  const { vault, guardian, screener, proposal } = opts;
  const started = Date.now();
  if (proposal.request.chain !== "near" && opts.shieldKey) await assertNoIncident(vault, proposal, opts.shieldKey);
  const [config, payees, recent] = await Promise.all([vault.config(), vault.payees(), vault.proposals(0, 30)]);
  const history = recent.filter((p) => p.id !== proposal.id);

  const hash = proposalHash(vault.vaultId, proposal);
  if (hash !== (await vault.proposalHash(proposal.id))) throw new Error("proposal hash differs from the contract; refusing to screen");

  const assets = [...new Set([proposal.request.asset, ...history.map((p) => p.request.asset)])];
  const decimals = Object.fromEntries(await Promise.all(assets.map(async (a) => [a, await decimalsOf(vault, a)] as const)));
  const signals = computeSignals(proposal.request, payees, history);
  const user = userMessage({ vaultId: vault.vaultId, proposal, proposalHash: hash, mandate: config.mandate, payees, history, signals, decimals, evidence: opts.evidence });

  const result = await screener.screen(SYSTEM_PROMPT, user, { proposalId: proposal.id, proposalHash: hash, signals, evidence: opts.evidence });
  if (result.verdict.proposal_id !== proposal.id || result.verdict.proposal_hash !== hash) {
    throw new Error("the model did not echo this proposal's id and hash; leaving it to expire");
  }

  // A pass to another chain needs what the vault can't know itself: an executable 1Click quote
  // (NEAR Intents routes) or the nonce and gas fees for its own address (Chain Signatures routes).
  const evmRoute = proposal.request.chain === "near" ? undefined : await evmRouteFor(vault, proposal.request.chain);
  const pass = result.verdict.verdict === "PASS" && proposal.request.chain !== "near";
  const quote = pass && !evmRoute ? await quoteFor(vault, proposal, opts.oneClickJwt) : null;
  const evm = pass && evmRoute ? await evmParams(evmRoute, await vaultEvmAddress(vault, evmRoute)) : null;

  const outcome = await guardian.signAndSendTransaction({
    receiverId: vault.vaultId,
    actions: [
      actions.functionCall(
        "submit_verdict",
        {
          id: proposal.id,
          model_id: result.model,
          chat_id: result.chatId,
          request_hash: result.requestHash,
          response: Buffer.from(result.responseBytes).toString("base64"),
          signature: result.signature,
          quote: quote && { json: quote.json, signature: quote.signature },
          evm,
        },
        // Chain Signatures: the MPC sign call and its callback run inside this transaction.
        teraToGas(evm ? "300" : "100"),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  return { result, signals, proposalHash: hash, tx: outcome.transaction.hash, ms: Date.now() - started };
}

async function routeFor(vault: VaultReader, proposal: Proposal) {
  const routes = await vault.view<[string, Route][]>("get_routes");
  const route = routes.find(([chain]) => chain === proposal.request.chain)?.[1];
  if (!route) throw new Error(`the vault has no route to ${proposal.request.chain}`);
  return route;
}

/** A fresh executable 1Click quote for a cross-chain proposal, on the vault's route for its chain. */
export async function quoteFor(vault: VaultReader, proposal: Proposal, jwt?: string) {
  const route = await routeFor(vault, proposal);
  return payoutQuote({ vaultId: vault.vaultId, route, payee: proposal.request.payee, amount: proposal.request.amount, jwt });
}

/** Throws ShieldHold while an active Shield incident touches this payout's route. */
export async function assertNoIncident(vault: VaultReader, proposal: Proposal, shieldKey: string) {
  const incident = blockingIncident(await shieldIncidents(shieldKey), await routeFor(vault, proposal), proposal.request);
  if (incident) throw new ShieldHold(incident);
}
