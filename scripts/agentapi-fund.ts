// Prints where to send USDC so the demo's Agent API wallet can make real payments.
//
//   node scripts/agentapi-fund.ts            # USDC on NEAR
//   node scripts/agentapi-fund.ts base       # USDC on Base (or solana, arbitrum, eth, …)
//
// The API asks 1Click for a deposit address on that chain; whatever arrives there lands in the
// agent's NEAR Intents account as USDC. Deposits need no grant and never go through the policy.
// Nothing moves until you send funds; an unused address simply expires.
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AgentApi } from "@veto/core";

const chain = (process.argv[2] ?? "near").toLowerCase();
const rootEnv = new URL("../.env.local", import.meta.url);
const envVar = (name: string) => readFileSync(rootEnv, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const stateFile = new URL("../.veto-dev/agentapi.json", import.meta.url);
if (!existsSync(stateFile)) {
  console.error("No .veto-dev/agentapi.json: run scripts/agentapi-setup.ts first.");
  process.exit(1);
}
const state = JSON.parse(readFileSync(stateFile, "utf8")) as { agentId: string; wallet?: string };
const api = new AgentApi(envVar("NEAR_INTENTS_AGENT_API_URL") || "https://api.agentsonintents.com", envVar("NEAR_INTENTS_AGENT_API_KEY"));

const tokens = (await api.tokens()).data;
const usdcOn = (c: string) => tokens.find((t) => t.symbol === "USDC" && t.blockchain === c);
const target = usdcOn("near")!;
const origin = usdcOn(chain);
if (!origin) {
  const chains = [...new Set(tokens.filter((t) => t.symbol === "USDC").map((t) => t.blockchain))].sort();
  throw new Error(`No USDC on "${chain}". Chains with USDC: ${chains.join(", ")}`);
}

const op = await api.deposit(state.agentId, { origin_asset: origin.asset_id, destination_asset: target.asset_id }, `veto-fund-${randomUUID()}`);
const d = op.details as Record<string, unknown>;
console.log(`Send USDC on ${chain} to fund the Veto demo agent (${state.wallet ?? state.agentId}).\n`);
if (d.deposit_address) console.log(`  Address:  ${d.deposit_address}`);
if (d.memo) console.log(`  Memo:     ${d.memo}   (include it, or the deposit can't be matched)`);
if (d.min_amount) console.log(`  Minimum:  ${Number(d.min_amount) / 10 ** origin.decimals} USDC`);
if (d.expires_at) console.log(`  Expires:  ${d.expires_at}`);
console.log(`  Status:   ${op.status} (${op.correlation_id})`);
if (!d.deposit_address) console.log(`\n${JSON.stringify(d, null, 2)}`);
console.log("\nA few dollars is plenty: the inbox's examples that pass cost 9 and 7.5 cents each. Check the balance on the app's Agents page.");
