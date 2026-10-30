// Veto guardian: watches a vault, screens each proposed payment privately and submits
// the signed verdict on-chain.
//
//   NEARAI_API_KEY=... node services/guardian/src/main.ts
//
// Config (env): VAULT_ID, NEAR_NETWORK (testnet|mainnet), GUARDIAN_ACCOUNT_ID,
// GUARDIAN_PRIVATE_KEY, NEARAI_API_KEY, NEARAI_MODEL, PORT. On testnet, anything not set
// is read from .veto-dev/testnet.json. VETO_SCREENER=dev uses the local dev screener.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, teraToGas } from "near-api-js";
import {
  canonicalJson,
  computeSignals,
  DEFAULT_MODEL,
  provider,
  proposalHash,
  sha256Hex,
  SYSTEM_PROMPT,
  userMessage,
  VaultReader,
  type Network,
  type Proposal,
} from "@veto/core";
import { DevScreener, NearAiScreener, type Screener } from "./screener.ts";

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

const DATA = new URL(`data/${vaultId}/`, ROOT);
mkdirSync(new URL("evidence/", DATA), { recursive: true });
mkdirSync(new URL("audit/", DATA), { recursive: true });

const inFlight = new Set<string>();
const decimals = new Map<string, number>([["near", 24]]);
const log = (msg: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${msg}`);

log(`guardian ${guardianId} watching ${vaultId} on ${network} with ${screener.model}`);
if (screener instanceof DevScreener) log(`dev screener signing as ${screener.wallet.address} (local testing only)`);

setInterval(() => void tick().catch((e) => log(`watch error: ${e.message}`)), 2000);
void tick();

async function tick() {
  for (const proposal of await vault.openProposals()) {
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

  const started = Date.now();
  const [config, payees, history] = await Promise.all([vault.config(), vault.payees(), vault.proposals(0, 30)]);
  const hash = proposalHash(vaultId, proposal);
  const onChainHash = await vault.proposalHash(proposal.id);
  if (hash !== onChainHash) throw new Error("proposal hash differs from the contract; refusing to screen");

  const evidence = proposal.context_hash ? readEvidence(proposal.context_hash) : null;
  if (proposal.context_hash && evidence === undefined) {
    log(`proposal ${proposal.id}: waiting for the agent's evidence`);
    return;
  }
  const signals = computeSignals(proposal.request, payees, history.filter((p) => p.id !== proposal.id));
  const input = {
    vaultId,
    proposal,
    proposalHash: hash,
    mandate: config.mandate,
    payees,
    history: history.filter((p) => p.id !== proposal.id),
    signals,
    decimals: Object.fromEntries(
      await Promise.all(
        [...new Set([proposal.request.asset, ...history.map((p) => p.request.asset)])].map(async (a) => [a, await assetDecimals(a)] as const),
      ),
    ),
    evidence,
  };
  const user = userMessage(input);
  const result = await screener.screen(SYSTEM_PROMPT, user, { proposalId: proposal.id, proposalHash: hash, signals, evidence });
  if (result.verdict.proposal_id !== proposal.id || result.verdict.proposal_hash !== hash) {
    throw new Error("model did not echo this proposal's id and hash; leaving it to expire");
  }

  const outcome = await guardian.signAndSendTransaction({
    receiverId: vaultId,
    actions: [
      (await import("near-api-js")).actions.functionCall(
        "submit_verdict",
        {
          id: proposal.id,
          model_id: result.model,
          chat_id: result.chatId,
          request_hash: result.requestHash,
          response: Buffer.from(result.responseBytes).toString("base64"),
          signature: result.signature,
        },
        teraToGas("150"),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const tx = outcome.transaction.hash;
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
        screened_ms: Date.now() - started,
      },
      null,
      2,
    ),
  );
  log(`proposal ${proposal.id}: ${result.verdict.verdict}${result.verdict.reasons.length ? ` (${result.verdict.reasons.join(", ")})` : ""} in ${Date.now() - started} ms, tx ${tx}`);
}

async function assetDecimals(asset: string) {
  if (!decimals.has(asset)) {
    const meta = (await rpc.callFunction({ contractId: asset, method: "ft_metadata", args: {} })) as { decimals: number };
    decimals.set(asset, meta.decimals);
  }
  return decimals.get(asset)!;
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
