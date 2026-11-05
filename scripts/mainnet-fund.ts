// Moves USDC from Base into the mainnet vault through NEAR Intents: asks 1Click for a deposit
// address that delivers USDC on NEAR to the vault, then (with --watch) follows it until it lands.
//
//   node scripts/mainnet-fund.ts --amount 10          (prints where to send 10 USDC on Base)
//   node scripts/mainnet-fund.ts --watch <address>    (follows a deposit until the vault has it)
//
// Needs .veto-dev/mainnet.json (from mainnet-setup.ts) and MAINNET_FUNDER_BASE in .env.local:
// the Base address you send from, which is also where 1Click refunds a failed swap.
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { payoutStatus, provider, requestQuote, USDC, verifyQuote } from "@veto/core";
process.env.VETO_PROFILE ??= "mainnet";
const { loadState } = await import("./dev-state.ts");

const { values: args } = parseArgs({ options: { amount: { type: "string" }, watch: { type: "string" } } });
loadEnv(new URL("../.env.local", import.meta.url));
const state = loadState("mainnet");
if (!state.vault) { console.error("no mainnet vault yet; run node scripts/mainnet-setup.ts --send first"); process.exit(1); }
const vaultId = state.vault.accountId;
const jwt = process.env.ONECLICK_JWT;

if (args.watch) {
  for (;;) {
    const s = await payoutStatus(args.watch, jwt);
    const balance = await provider("mainnet").callFunction({
      contractId: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
      method: "ft_balance_of",
      args: { account_id: vaultId },
    });
    console.log(`${new Date().toISOString().slice(11, 19)}  ${s.status}  vault holds $${Number(balance) / 1e6}`);
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  process.exit(0);
}

const funder = (process.env.MAINNET_FUNDER_BASE ?? "").toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(funder)) { console.error("set MAINNET_FUNDER_BASE (the 0x… Base address you send from) in .env.local"); process.exit(1); }
const amount = BigInt(Math.round(Number(args.amount ?? "0") * 1e6));
if (amount < 1_000_000n) throw new Error("pass --amount in USDC, at least 1");

const r = await requestQuote(
  {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: USDC.base,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC.near,
    amount: String(amount),
    refundTo: funder,
    refundType: "ORIGIN_CHAIN",
    recipient: vaultId,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
    referral: "veto",
  },
  jwt,
);
if (!verifyQuote(r)) throw new Error("1Click's quote signature does not verify");
console.log(`Send exactly ${Number(amount) / 1e6} USDC on Base from ${funder}`);
console.log(`to the 1Click deposit address  ${r.quote.depositAddress}`);
console.log(`before ${r.quote.deadline}. The vault receives about $${Number(r.quote.amountOut) / 1e6} USDC on NEAR.`);
console.log(`\nThen: node scripts/mainnet-fund.ts --watch ${r.quote.depositAddress}`);

function loadEnv(file: URL) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
