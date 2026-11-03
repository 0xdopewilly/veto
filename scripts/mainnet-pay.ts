// The real thing: the agent proposes a USDC payout to the Base supplier, the NEAR AI model
// screens it in its enclave, the vault checks the signed verdict and 1Click's signed quote
// on-chain, pays the deposit, and NEAR Intents delivers USDC on Base.
//
//   node scripts/mainnet-pay.ts --amount 2           (dry run: shows what it would do)
//   node scripts/mainnet-pay.ts --amount 2 --send
//
// Needs .veto-dev/mainnet.json (mainnet-setup.ts), a funded vault (mainnet-fund.ts),
// NEARAI_API_KEY and optionally ONECLICK_JWT in .env.local.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Account, actions, teraToGas } from "near-api-js";
import { canonicalJson, DEFAULT_MODEL, NearAiScreener, payoutStatus, provider, screenAndSubmit, sha256Hex, VaultReader } from "@veto/core";
process.env.VETO_PROFILE ??= "mainnet";
const { loadState } = await import("./dev-state.ts");

const { values: args } = parseArgs({ options: { amount: { type: "string", default: "2" }, send: { type: "boolean", default: false } } });
loadEnv(new URL("../.env.local", import.meta.url));
const state = loadState("mainnet");
if (!state.vault || !state.agentProposeKey || !state.guardianVerdictKey) throw new Error("run node scripts/mainnet-setup.ts --send first");
const supplier = (process.env.MAINNET_SUPPLIER_BASE ?? "").toLowerCase();
const amount = String(BigInt(Math.round(Number(args.amount) * 1e6)));
const USDC_TOKEN = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const rpc = provider("mainnet");
const vault = new VaultReader(state.vault.accountId, rpc);

const evidence = {
  source: "email",
  from: "billing@test-supplier.example",
  subject: `Invoice VETO-MAINNET-1: $${args.amount} USDC on Base`,
  body: `Please pay invoice VETO-MAINNET-1 for $${args.amount} USDC to our usual Base address ${supplier}.`,
};
const request = { chain: "base", asset: USDC_TOKEN, payee: supplier, amount, memo: "VETO-MAINNET-1" };
console.log(`${args.send ? "Paying" : "Dry run:"} $${args.amount} USDC from ${vault.vaultId} to ${supplier} on Base`);
if (!args.send) {
  console.log("Nothing was sent. Run with --send to do it.");
  process.exit(0);
}
const apiKey = process.env.NEARAI_API_KEY;
if (!apiKey) throw new Error("NEARAI_API_KEY is not set in .env.local");

const agent = new Account(state.agent!.accountId, rpc, state.agentProposeKey);
const guardian = new Account(state.guardian!.accountId, rpc, state.guardianVerdictKey);
const outcome = await agent.signAndSendTransaction({
  receiverId: vault.vaultId,
  actions: [actions.functionCall("propose", { request, context_hash: sha256Hex(canonicalJson(evidence)) }, teraToGas("30"), 0n)],
  waitUntil: "FINAL",
});
const id: string = JSON.parse(Buffer.from((outcome.status as { SuccessValue: string }).SuccessValue, "base64").toString());
console.log(`• proposed #${id}  https://nearblocks.io/txns/${outcome.transaction.hash}`);

const screened = await screenAndSubmit({
  vault,
  guardian,
  screener: new NearAiScreener(apiKey, process.env.NEARAI_MODEL ?? DEFAULT_MODEL),
  proposal: (await vault.proposal(id))!,
  evidence,
  oneClickJwt: process.env.ONECLICK_JWT,
  shieldKey: process.env.SHIELD_API_KEY,
});
console.log(`• ${screened.result.verdict.verdict} from ${screened.result.model} in ${screened.ms} ms, checked on-chain  https://nearblocks.io/txns/${screened.tx}`);

for (;;) {
  const p = (await vault.proposal(id))!;
  if (p.status === "Vetoed") {
    console.log(`• vetoed: ${p.verdict?.reasons.join(", ")}`);
    break;
  }
  const deposit = p.quote?.deposit_address;
  if (deposit) {
    const s = await payoutStatus(deposit, process.env.ONECLICK_JWT);
    const tx = s.swapDetails?.destinationChainTxHashes?.[0];
    console.log(`  ${p.status} · 1Click ${s.status}${tx ? `  ${tx.explorerUrl ?? tx.hash}` : ""}`);
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) break;
  }
  await new Promise((r) => setTimeout(r, 8000));
}

function loadEnv(file: URL) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
