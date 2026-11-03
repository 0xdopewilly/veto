// Fetches a real executable 1Click quote (no funds move until someone deposits) and saves it
// as a contract test fixture, so the vault's on-chain quote check is tested against 1Click's
// actual live output, not just a preview.
//   node scripts/oneclick-live-fixture.ts
import { writeFileSync } from "node:fs";
import { payoutQuote, USDC } from "@veto/core";

const route = { token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", origin_asset: USDC.near, destination_asset: USDC.base, max_fee_bps: 200 };
const vaultId = "intents.near"; // any existing account; 1Click refuses refunds to accounts that don't exist
const payee = "0xa11ce57b2f0c88de41a9b3c07e6d1f45a3c0d9f2";
const amount = "5000000"; // $5.00

const q = await payoutQuote({ vaultId, route, payee, amount, jwt: process.env.ONECLICK_JWT });
writeFileSync(
  new URL("../contract/src/fixtures/oneclick_live_quote_signed.json", import.meta.url),
  JSON.stringify({ vault: vaultId, route, payee, amount, json: q.json, signature: q.signature }, null, 2) + "\n",
);
console.log(`saved a live quote: pay ${q.amountIn} in, $5.00 out to ${payee} on Base, deposit to ${q.depositAddress}`);
