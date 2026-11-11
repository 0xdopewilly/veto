import { actions, teraToGas, type Account } from "near-api-js";
import { evmParams, evmRouteFor, vaultEvmAddress } from "./evm.ts";
import { payoutQuote, type Route } from "./intents.ts";
import { blockingIncident, ShieldHold, shieldIncidents } from "./shield.ts";
import type { SignedScreening } from "./nearai.ts";
import { canonicalJson, proposalHash, type Proposal } from "./proposal.ts";
import { screeningUserMessage, SYSTEM_PROMPT, userMessage } from "./prompt.ts";
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
  // "<chain>:<coin>" is a native EVM coin, paid from the vault's Chain Signatures address.
  if (asset.includes(":")) return 18;
  if (!decimalsCache.has(asset)) {
    const meta = (await vault.rpc.callFunction({ contractId: asset, method: "ft_metadata", args: {} })) as { decimals: number };
    decimalsCache.set(asset, meta.decimals);
  }
  return decimalsCache.get(asset)!;
}

/** How many times a checked screening is tried when the vault's facts change under it. */
const CHECKED_TRIES = 3;
/** What a checked vault says when the signed request isn't the one it rebuilt (contract/src/lib.rs). */
const REBUILT_MISMATCH = /request this vault rebuilt/;

/**
 * Screens one proposal and submits the signed verdict on-chain:
 * mandate, payees and history from the vault, deterministic signals, the agent's private
 * evidence, a verdict signed over the exact request/response bytes, then submit_verdict.
 *
 * A vault with checked screening writes the facts itself (get_screening_facts) and rebuilds the
 * whole request when the verdict arrives, so the guardian sends the evidence instead of a request
 * hash. If another payment changes those facts while the model is answering (one settles, say),
 * the signed request no longer matches and the proposal is screened again.
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
  const { vault, proposal } = opts;
  const started = Date.now();
  if (proposal.request.chain !== "near" && opts.shieldKey) await assertNoIncident(vault, proposal, opts.shieldKey);
  const hash = proposalHash(vault.vaultId, proposal);
  if (hash !== (await vault.proposalHash(proposal.id))) throw new Error("proposal hash differs from the contract; refusing to screen");

  const config = await vault.config();
  if (!config.checked_screening) {
    const { user, signals } = await privateScreening(vault, config.mandate, proposal, hash, opts.evidence);
    return { ...(await screenOnce(opts, user, signals, hash, null)), ms: Date.now() - started };
  }
  // The evidence exactly as the agent committed to it; the vault checks its hash.
  const evidence = proposal.context_hash ? canonicalJson(opts.evidence ?? null) : null;
  for (let attempt = 1; ; attempt++) {
    const facts = await vault.screeningFacts(proposal.id);
    const signals = (JSON.parse(facts) as { signals: Signal[] }).signals;
    try {
      const screened = await screenOnce(opts, screeningUserMessage(facts, opts.evidence), signals, hash, { evidence, facts });
      return { ...screened, ms: Date.now() - started };
    } catch (e) {
      if (attempt >= CHECKED_TRIES || !(e instanceof FactsChanged || REBUILT_MISMATCH.test(String((e as Error).message)))) throw e;
    }
  }
}

/** The facts changed between screening and submitting; the verdict would not match. */
class FactsChanged extends Error {}

/** Facts written here, for a vault with private screening (or one deployed before checked screening). */
async function privateScreening(vault: VaultReader, mandate: string, proposal: Proposal, hash: string, evidence: unknown) {
  // The last 100 payments: enough for the duplicate check to still see this month's salary in a busy
  // week. The prompt itself lists only the newest 20.
  const [payees, recent] = await Promise.all([vault.payees(), vault.proposals(0, 100)]);
  const history = recent.filter((p) => p.id !== proposal.id);
  const assets = [...new Set([proposal.request.asset, ...history.map((p) => p.request.asset)])];
  const decimals = Object.fromEntries(await Promise.all(assets.map(async (a) => [a, await decimalsOf(vault, a)] as const)));
  const signals = computeSignals(proposal.request, payees, history);
  const user = userMessage({ vaultId: vault.vaultId, proposal, proposalHash: hash, mandate, payees, history, signals, decimals, evidence });
  return { user, signals };
}

async function screenOnce(
  opts: { vault: VaultReader; guardian: Account; screener: Screener; proposal: Proposal; evidence: unknown; oneClickJwt?: string },
  user: string,
  signals: Signal[],
  hash: string,
  /** For checked screening: the facts the vault wrote and the committed evidence. Null for private screening. */
  checked: { evidence: string | null; facts: string } | null,
): Promise<Omit<Screened, "ms">> {
  const { vault, guardian, screener, proposal } = opts;
  const result = await screener.screen(SYSTEM_PROMPT, user, { proposalId: proposal.id, proposalHash: hash, signals, evidence: opts.evidence });
  if (result.verdict.proposal_id !== proposal.id || result.verdict.proposal_hash !== hash) {
    throw new Error("the model did not echo this proposal's id and hash; leaving it to expire");
  }
  if (checked && (await vault.screeningFacts(proposal.id)) !== checked.facts) throw new FactsChanged("the vault's facts changed while screening");

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
          // Checked screening: the evidence, and the vault rebuilds the request. Private: the request's hash.
          ...(checked ? { evidence: checked.evidence } : { request_hash: result.requestHash }),
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
  return { result, signals, proposalHash: hash, tx: outcome.transaction.hash };
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
