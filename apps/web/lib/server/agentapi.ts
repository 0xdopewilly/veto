// Server-only: the demo's NEAR Intents Agent API path (mainnet). The agent account moves money only
// inside its owner-signed policy, and Veto holds its only grant: the AI agent can't spend, it can
// only ask. Veto screens the request with the same enclave model as the vault, and only a pass
// becomes a transfer (a supplier on NEAR) or a withdrawal through NEAR Intents (a salary paid out on
// the chain the worker chose), which the owner's policy still limits (destinations, per-payment and
// daily caps).
//
// The account lives on mainnet with a few real dollars, so the inbox's amounts are scaled 1:100
// here ($180.00 → $1.80), and the sandbox's testnet suppliers map onto the account's mainnet ones.
// The screen sees the business's payment history from the sandbox vault, mapped the same way, so it
// still catches a duplicate invoice. The sandbox vault is on testnet, so this path doesn't record on
// it; the enclave's signed verdict and the Agent API's own operation record are the trail.
import { createHash } from "node:crypto";
import {
  AgentApi,
  AgentApiError,
  canonicalJson,
  computeSignals,
  DEFAULT_MODEL,
  NearAiScreener,
  sha256Hex,
  SYSTEM_PROMPT,
  userMessage,
  type Payee,
  type Proposal,
  type StatusResponse,
} from "@veto/core";
import { demo as sandboxDemo, demoAccounts } from "./demo";
import { WORKER } from "./evm";

const env = (key: string) => process.env[key]?.trim() ?? "";

/** USDC on NEAR, as the Agent API names it, and the token contract the screen sees. */
export const AGENT_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_CONTRACT = AGENT_USDC.slice("nep141:".length);
/** The inbox's amounts, scaled for a wallet holding a few real dollars. */
export const AGENT_SCALE = 100n;

let api: AgentApi | null = null;
let screener: NearAiScreener | null = null;

export function agentApiDemo() {
  const agentId = env("DEMO_AGENTAPI_AGENT_ID");
  const grant = env("DEMO_AGENTAPI_GRANT");
  const key = env("NEAR_INTENTS_AGENT_API_KEY");
  if (!agentId || !grant || !key || !env("NEARAI_API_KEY")) return null;
  api ??= new AgentApi(env("NEAR_INTENTS_AGENT_API_URL") || "https://api.agentsonintents.com", key);
  screener ??= new NearAiScreener(env("NEARAI_API_KEY"), env("NEARAI_MODEL") || DEFAULT_MODEL);
  // "Kano Cotton Mills=<account>;…;Tunde Bello=base:0x…": the destinations the owner's policy allows,
  // NEAR Intents accounts for transfers and chain:address for payouts on another chain.
  const payees: Payee[] = env("DEMO_AGENTAPI_PAYEES")
    .split(";")
    .filter(Boolean)
    .map((pair) => {
      const [name, target] = pair.split("=");
      const onChain = /^([a-z]+):(.+)$/.exec(target);
      return { name, chain: onChain ? onChain[1] : "near", address: onChain ? onChain[2] : target, added_at: "0" };
    });
  return { api, screener, agentId, grant, payees };
}

/** The payroll worker's address on Base mainnet, the one payout off NEAR the owner's policy allows. */
export function agentApiWorker(): string | null {
  return agentApiDemo()?.payees.find((p) => p.name === WORKER && p.chain === "base")?.address ?? null;
}

/**
 * The example emails' money, scaled like their payments ("$180.00" or "180.00 USDC" → "$1.80"), so
 * what the agent reads and what it asks for agree. Without it the screen sees a mismatch.
 */
export function scaleMoney(text: string, scale: bigint) {
  const scaled = (n: string) => (Number(n.replace(/,/g, "")) / Number(scale)).toFixed(2);
  return text.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)(\s?USDC)?|(\d[\d,]*(?:\.\d+)?)(\s?USDC)/g, (_m, a, aUnit, b, bUnit) =>
    a !== undefined ? `$${scaled(a)}${aUnit ?? ""}` : `${scaled(b)}${bUnit}`,
  );
}

/**
 * The sandbox's suppliers map onto the Agent API ones by name; an address that is already one of the
 * account's stays; any other onto one the policy never lists.
 */
function mapPayee(payee: string, payees: Payee[]): string {
  if (payees.some((p) => p.address.toLowerCase() === payee.toLowerCase())) return payee;
  const known = [
    ["kano-cotton.", "Kano Cotton Mills"],
    ["ibadan-dye.", "Ibadan Dye Works"],
  ].find(([prefix]) => payee.startsWith(prefix));
  const listed = known && payees.find((p) => p.name === known[1]);
  return listed ? listed.address : createHash("sha256").update(`veto-unlisted:${payee}`).digest("hex");
}

export interface AgentApiOutcome {
  id: string;
  /** `chain` is "near" for a transfer inside NEAR Intents, or the chain a withdrawal pays out on. */
  request: { payee: string; payee_name: string | null; amount: string; asset: string; chain: string };
  verdict: { verdict: "PASS" | "VETO"; reasons: string[]; model: string; signer: string; approved_signer: boolean; ms: number };
  execution:
    | { kind: "skipped" }
    | { kind: "refused"; code: string; layer: string | null; message: string }
    | { kind: "sent"; correlation_id: string; status: StatusResponse["status"]; failure_code: string | null; tx_hash: string | null };
}

/**
 * Screens one payment the agent asks its Agent API wallet to make, and runs it with Veto's grant
 * only if the screen passes. `amount` is in USDC's 6-decimal units. With `scaled`, an inbox
 * example: its amount and the money in its text are scaled 1:100. An email someone writes is taken
 * as written, so a large amount meets the owner's per-payment limit.
 */
export async function runViaAgentApi(input: {
  payee: string;
  amount: string;
  /** Where it pays out: "near" (default) for a transfer, or a chain such as "base" for a withdrawal. */
  chain?: string;
  memo: string | null;
  evidence: { source: string; from: string; subject: string; body: string };
  scaled: boolean;
  /** The sandbox vault's recent proposals, when the caller already read them (the same snapshot its scenario was built from). */
  books?: Proposal[];
}): Promise<AgentApiOutcome> {
  const demo = agentApiDemo();
  if (!demo) throw new Error("the Agent API wallet is not configured");
  const sandbox = demoAccounts();
  const started = Date.now();

  const recipient = mapPayee(input.payee, demo.payees);
  const amount = input.scaled ? (BigInt(input.amount) / AGENT_SCALE || 1n).toString() : input.amount;
  // The email names the sandbox's testnet accounts; the agent reads them as the accounts it pays.
  const root = sandboxDemo.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mapText = (text: string) => text.replace(new RegExp(`[a-z0-9][a-z0-9-]*\\.${root}`, "g"), (account) => mapPayee(account, demo.payees));
  const evidence = input.scaled
    ? { ...input.evidence, subject: mapText(scaleMoney(input.evidence.subject, AGENT_SCALE)), body: mapText(scaleMoney(input.evidence.body, AGENT_SCALE)) }
    : { ...input.evidence, body: mapText(input.evidence.body) };
  const chain = input.chain ?? "near";
  const request = { chain, asset: USDC_CONTRACT, payee: recipient, amount, memo: input.memo };
  const id = `aa-${Date.now().toString(36)}`;
  const now = (BigInt(Date.now()) * 1_000_000n).toString();
  const proposal: Proposal = {
    id,
    agent: "the demo AI agent (no grant: it can only ask)",
    request,
    context_hash: sha256Hex(canonicalJson(evidence)),
    status: "Screening",
    created_at: now,
    screen_deadline: now,
    verdict: null,
    override_executes_at: null,
    settled_at: null,
  };
  const hash = sha256Hex(canonicalJson({ agent_id: demo.agentId, id, request }));

  // The same screen as the vault's: the owner's mandate, the allowed payees, the account's recent
  // transfers and the agent's evidence, signed in the enclave over the exact bytes.
  const [config, signers, recent, books] = await Promise.all([
    sandbox.reader.config(),
    sandbox.reader.view<[string, unknown][]>("get_signers"),
    demo.api.request<{ data: StatusResponse[] }>("GET", `/v1/agents/${demo.agentId}/history?limit=20`).catch(() => ({ data: [] })),
    input.books ?? sandbox.reader.proposals(0, 30),
  ]);
  const own: Proposal[] = recent.data
    .filter((s) => (s.type === "transfer" || s.type === "withdraw") && s.status === "SUCCESS")
    .map((s, i) => {
      const r = (s.details.request ?? {}) as { amount?: string; recipient?: string; chain?: string };
      const paidOn = s.type === "withdraw" ? (r.chain ?? "base") : "near";
      return { ...proposal, id: `aa-past-${i}`, status: "Paid", request: { chain: paidOn, asset: USDC_CONTRACT, payee: r.recipient ?? "", amount: r.amount ?? "0", memo: null } };
    });
  const vaultBooks: Proposal[] = books
    .slice(0, 30)
    .filter((p) => p.request.chain === "near" && p.request.asset === sandboxDemo.token)
    .map((p) => ({
      ...p,
      request: {
        ...p.request,
        asset: USDC_CONTRACT,
        payee: mapPayee(p.request.payee, demo.payees),
        amount: input.scaled ? (BigInt(p.request.amount) / AGENT_SCALE || 1n).toString() : p.request.amount,
      },
    }));
  const history = [...own, ...vaultBooks];
  const signals = computeSignals(request, demo.payees, history);
  const user = userMessage({
    vaultId: `agent-api:${demo.agentId}`,
    proposal,
    proposalHash: hash,
    mandate: config.mandate,
    payees: demo.payees,
    history,
    signals,
    decimals: { [USDC_CONTRACT]: 6 },
    evidence,
  });
  const result = await demo.screener.screen(SYSTEM_PROMPT, user);
  if (result.verdict.proposal_id !== id || result.verdict.proposal_hash !== hash) throw new Error("the model did not echo this payment's id and hash; nothing was sent");
  const approved = signers.some(([address]) => address.toLowerCase() === result.signingAddress);
  // Only a pass signed by a key the vault approves runs; anything else is a veto.
  const pass = result.verdict.verdict === "PASS" && approved;

  const payeeName = demo.payees.find((p) => p.address.toLowerCase() === recipient.toLowerCase() && p.chain === chain)?.name ?? null;
  const outcome: AgentApiOutcome = {
    id,
    request: { payee: recipient, payee_name: payeeName, amount, asset: AGENT_USDC, chain },
    verdict: {
      verdict: pass ? "PASS" : "VETO",
      reasons: approved ? result.verdict.reasons : ["UNAPPROVED_SIGNER", ...result.verdict.reasons],
      model: result.model,
      signer: result.signingAddress,
      approved_signer: approved,
      ms: Date.now() - started,
    },
    execution: { kind: "skipped" },
  };
  if (!pass) return outcome;
  // A frozen vault stops everything Veto would approve, this path included: nothing is sent.
  if (config.frozen) {
    outcome.execution = { kind: "refused", code: "vault_frozen", layer: "veto", message: "The owner froze the vault, so Veto sent nothing." };
    return outcome;
  }

  try {
    // The idempotency key is tied to this screening, so a retry can never send twice. On NEAR it's a
    // transfer inside NEAR Intents; to another chain, a withdrawal that NEAR Intents pays out there.
    const key = `veto-${hash.slice(0, 40)}`;
    const sent =
      chain === "near"
        ? await demo.api.transfer(demo.agentId, demo.grant, { asset: AGENT_USDC, amount, recipient }, key)
        : await demo.api.withdraw(demo.agentId, demo.grant, { asset: AGENT_USDC, amount, chain, recipient }, key);
    const settled = sent.status === "PROCESSING" || sent.status === "QUEUED" ? await demo.api.settle(sent.correlation_id, 45_000) : sent;
    outcome.execution = {
      kind: "sent",
      correlation_id: settled.correlation_id,
      status: settled.status,
      failure_code: settled.failure_code,
      tx_hash: (settled.details.tx_hash as string | undefined) ?? null,
    };
  } catch (e) {
    if (!(e instanceof AgentApiError)) throw e;
    outcome.execution = { kind: "refused", code: e.code, layer: e.layer ?? null, message: e.message };
  }
  return outcome;
}

/** The account as the Agents page shows it: owner, policy in force, balance, Veto's grant. */
export async function agentApiSnapshot() {
  const demo = agentApiDemo();
  if (!demo) return null;
  const [agent, policy, balances, grants] = await Promise.all([
    demo.api.agent(demo.agentId),
    demo.api.policy(demo.agentId),
    demo.api.balances(demo.agentId),
    demo.api.request<{ data: { grant_id: string; label: string; expires_at: string; revoked_at: string | null }[] }>("GET", `/v1/agents/${demo.agentId}/grants`),
  ]);
  const usdc = balances.balances.find((b) => b.asset_id === AGENT_USDC);
  return {
    agent_id: agent.id,
    name: agent.name,
    status: agent.status,
    owner: agent.owner?.address ?? null,
    wallet: agent.wallet?.near_account_id ?? null,
    policy: policy.policy,
    policy_status: policy.status,
    in_force: policy.status === "APPLIED" && policy.provider_policy_synced,
    usdc: usdc?.available_raw ?? "0",
    grants: grants.data.filter((g) => !g.revoked_at).map((g) => ({ label: g.label, expires_at: g.expires_at })),
    payees: demo.payees.map((p) => ({ name: p.name, address: p.address, chain: p.chain })),
    scale: Number(AGENT_SCALE),
  };
}
