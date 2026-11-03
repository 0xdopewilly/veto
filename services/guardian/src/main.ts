// Veto guardian: watches a vault, screens each proposed payment privately and submits
// the signed verdict on-chain. It also approves for OutLayer agent wallets: an agent hands
// over a pending approval, the guardian records and screens it on the vault, and votes yes
// on OutLayer only once the vault has passed it.
//
//   NEARAI_API_KEY=... node services/guardian/src/main.ts
//
// Config (env): VAULT_ID, NEAR_NETWORK (testnet|mainnet), GUARDIAN_ACCOUNT_ID,
// GUARDIAN_PRIVATE_KEY, NEARAI_API_KEY, NEARAI_MODEL, PORT. On testnet, anything not set
// is read from .veto-dev/testnet.json. VETO_SCREENER=dev uses the local dev screener.
// OutLayer: OUTLAYER_APPROVER_ID and OUTLAYER_APPROVER_KEY (a full-access key of the
// account named as an approver on the wallet's policy). ONECLICK_JWT lowers 1Click's fee on
// cross-chain payouts. With EXECUTE_OVERRIDES=1 the guardian also pays out overrides once their
// delay has passed (its key must allow execute_override), with a fresh quote when cross-chain.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, teraToGas, type KeyPairString } from "near-api-js";
import {
  approvePassed,
  canonicalJson,
  quoteFor,
  DEFAULT_MODEL,
  OutLayer,
  provider,
  recordApproval,
  screenAndSubmit,
  settleFromTx,
  sha256Hex,
  VaultReader,
  type Network,
  type Proposal,
} from "@veto/core";
import { DevScreener, NearAiScreener, type Screener } from "@veto/core";

const ROOT = new URL("../../../", import.meta.url);
loadEnvFile(new URL(".env.local", ROOT));
const network = (process.env.NEAR_NETWORK ?? "testnet") as Network;
const dev = network === "testnet" && existsSync(new URL(".veto-dev/testnet.json", ROOT))
  ? JSON.parse(readFileSync(new URL(".veto-dev/testnet.json", ROOT), "utf8"))
  : {};
const vaultId: string = process.env.VAULT_ID ?? dev.vault?.accountId;
const guardianId: string = process.env.GUARDIAN_ACCOUNT_ID ?? dev.guardian?.accountId;
const guardianKey = process.env.GUARDIAN_PRIVATE_KEY ?? dev.guardianVerdictKey;
if (!vaultId || !guardianId || !guardianKey) throw new Error("set VAULT_ID, GUARDIAN_ACCOUNT_ID and GUARDIAN_PRIVATE_KEY");

const rpc = provider(network);
const vault = new VaultReader(vaultId, rpc);
const guardian = new Account(guardianId, rpc, guardianKey);
const screener: Screener =
  process.env.VETO_SCREENER === "dev"
    ? new DevScreener(process.env.VETO_DEV_SIGNER_KEY)
    : new NearAiScreener(requireEnv("NEARAI_API_KEY"), process.env.NEARAI_MODEL ?? DEFAULT_MODEL);

const outlayer = new OutLayer(network);
const approver = process.env.OUTLAYER_APPROVER_ID && process.env.OUTLAYER_APPROVER_KEY
  ? { accountId: process.env.OUTLAYER_APPROVER_ID, key: process.env.OUTLAYER_APPROVER_KEY as KeyPairString }
  : null;

const DATA = new URL(`data/${vaultId}/`, ROOT);
mkdirSync(new URL("evidence/", DATA), { recursive: true });
mkdirSync(new URL("audit/", DATA), { recursive: true });

const inFlight = new Set<string>();
const voted = new Set<string>();
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);

log(`guardian ${guardianId} watching ${vaultId} on ${network} with ${screener.model}`);
if (approver) log(`approving for OutLayer wallets as ${approver.accountId}`);
if (screener instanceof DevScreener) log(`dev screener signing as ${screener.wallet.address} (local testing only)`);

setInterval(() => void tick().catch((e) => log(`watch error: ${e.message}`)), 2000);
void tick();

async function tick() {
  for (const proposal of await vault.openProposals()) {
    // Passed here (or an override that came due): release it on the wallet.
    if (proposal.external && proposal.status === "Executing" && approver && !voted.has(proposal.id)) {
      voted.add(proposal.id);
      approvePassed({ outlayer, proposal, approver })
        .then(() => log(`proposal ${proposal.id}: approved on OutLayer (${proposal.external!.approval_id})`))
        .catch((e) => (voted.delete(proposal.id), log(`proposal ${proposal.id}: OutLayer vote failed: ${e.message}`)));
      continue;
    }
    if (proposal.status === "OverridePending" && process.env.EXECUTE_OVERRIDES === "1" && !inFlight.has(proposal.id)) {
      const due = Number(BigInt(proposal.override_executes_at ?? "0") / 1_000_000n);
      if (Date.now() < due) continue;
      inFlight.add(proposal.id);
      executeOverride(proposal)
        .catch((e) => log(`proposal ${proposal.id}: override not executed: ${e.message}`))
        .finally(() => inFlight.delete(proposal.id));
      continue;
    }
    if (proposal.status !== "Screening" || inFlight.has(proposal.id)) continue;
    inFlight.add(proposal.id);
    handle(proposal)
      .catch((e) => log(`proposal ${proposal.id}: ${e.message}`))
      .finally(() => inFlight.delete(proposal.id));
  }
}

async function handle(proposal: Proposal) {
  const deadline = Number(BigInt(proposal.screen_deadline) / 1_000_000n);
  if (Date.now() > deadline) {
    await guardian.callFunction({ contractId: vaultId, methodName: "expire", args: { id: proposal.id }, gas: teraToGas("30") });
    log(`proposal ${proposal.id}: no verdict in time, expired (fails closed)`);
    return;
  }

  const evidence = proposal.context_hash ? readEvidence(proposal.context_hash) : null;
  if (proposal.context_hash && evidence === undefined) {
    log(`proposal ${proposal.id}: waiting for the agent's evidence`);
    return;
  }
  const { result, signals, proposalHash: hash, tx, ms } = await screenAndSubmit({ vault, guardian, screener, proposal, evidence, oneClickJwt: process.env.ONECLICK_JWT });
  writeFileSync(
    new URL(`audit/${proposal.id}.json`, DATA),
    JSON.stringify(
      {
        proposal_id: proposal.id,
        proposal_hash: hash,
        verdict: result.verdict,
        signals,
        model: result.model,
        chat_id: result.chatId,
        signed_text: result.signedText,
        signature: result.signature,
        signing_address: result.signingAddress,
        request_hash: result.requestHash,
        response_hash: result.responseHash,
        // Kept locally so the owner can prove exactly what the model saw. Never published.
        request_b64: Buffer.from(result.requestBytes).toString("base64"),
        response_b64: Buffer.from(result.responseBytes).toString("base64"),
        verdict_tx: tx,
        screened_ms: ms,
      },
      null,
      2,
    ),
  );
  log(`proposal ${proposal.id}: ${result.verdict.verdict}${result.verdict.reasons.length ? ` (${result.verdict.reasons.join(", ")})` : ""} in ${ms} ms, tx ${tx}`);
}

async function executeOverride(proposal: Proposal) {
  const quote = proposal.request.chain === "near" ? null : await quoteFor(vault, proposal, process.env.ONECLICK_JWT);
  await guardian.callFunction({
    contractId: vaultId,
    methodName: "execute_override",
    args: { id: proposal.id, quote: quote && { json: quote.json, signature: quote.signature } },
    gas: teraToGas("150"),
  });
  log(`proposal ${proposal.id}: override delay passed, paid out${quote ? ` through 1Click deposit ${quote.depositAddress}` : ""}`);
}

/** undefined = not received yet; null never happens for a proposal with a context hash. */
function readEvidence(contextHash: string): unknown {
  const file = new URL(`evidence/${contextHash}.json`, DATA);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

// The agent posts its private evidence here before proposing; only its hash goes on-chain.
const port = Number(process.env.PORT ?? 8799);
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const url = new URL(req.url ?? "/", "http://guardian");
  try {
    if (req.method === "POST" && url.pathname === "/evidence") {
      const { context_hash, evidence } = JSON.parse(await body(req));
      if (sha256Hex(canonicalJson(evidence)) !== context_hash) return json(res, 400, { error: "evidence does not match context_hash" });
      writeFileSync(new URL(`evidence/${context_hash}.json`, DATA), JSON.stringify(evidence));
      return json(res, 200, { ok: true });
    }
    // An agent with an OutLayer wallet hands over the approval its payment is waiting on.
    if (req.method === "POST" && url.pathname === "/outlayer/approvals") {
      const { approval_id, evidence } = JSON.parse(await body(req));
      if (typeof approval_id !== "string") return json(res, 400, { error: "approval_id is required" });
      if (evidence !== undefined) writeFileSync(new URL(`evidence/${sha256Hex(canonicalJson(evidence))}.json`, DATA), JSON.stringify(evidence));
      const proposal = await recordApproval({ vault, guardian, approval: await outlayer.approval(approval_id), evidence });
      log(`proposal ${proposal.id}: recorded OutLayer approval ${approval_id}`);
      return json(res, 200, { proposal_id: proposal.id });
    }
    // ...and reports the wallet's transaction once OutLayer sent it. Checked on NEAR before it counts.
    if (req.method === "POST" && url.pathname === "/outlayer/settled") {
      const { proposal_id, tx_hash } = JSON.parse(await body(req));
      const proposal = await vault.proposal(String(proposal_id));
      if (!proposal?.external) return json(res, 404, { error: "no such external payment" });
      const status = await settleFromTx({ vault, guardian, proposal, txHash: String(tx_hash) });
      log(`proposal ${proposal.id}: ${status} (tx ${tx_hash})`);
      return json(res, 200, { status });
    }
    const audit = url.pathname.match(/^\/proposals\/(\d+)\/audit$/);
    if (req.method === "GET" && audit) {
      const file = new URL(`audit/${audit[1]}.json`, DATA);
      if (!existsSync(file)) return json(res, 404, { error: "no audit record" });
      const { request_b64: _private, ...shareable } = JSON.parse(readFileSync(file, "utf8"));
      return json(res, 200, shareable);
    }
    if (url.pathname === "/health") return json(res, 200, { vault: vaultId, network, model: screener.model });
    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 400, { error: (e as Error).message });
  }
}).listen(port, () => log(`evidence and audit API on http://localhost:${port}`));

function json(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
}

function body(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 256 * 1024) reject(new Error("evidence is too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (put it in .env.local, or run with VETO_SCREENER=dev for local tests)`);
  return v;
}

function loadEnvFile(file: URL) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
