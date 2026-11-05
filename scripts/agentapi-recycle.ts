// Moves the USDC the demo's suppliers received back into the Agent API agent's wallet, so a few
// dollars keep the demo paying all week. The suppliers (Kano Cotton Mills, Ibadan Dye Works) are
// NEAR Intents accounts whose keys the demo keeps in .veto-dev/agentapi.json; each signs one
// transfer intent back to the agent, and the solver relay settles it, so it costs no gas. Tunde
// Bello's salaries leave NEAR Intents for Base and stay at his address there.
//
//   node scripts/agentapi-recycle.ts          # balances, and intents.near checks each transfer; sends nothing
//   node scripts/agentapi-recycle.ts --send   # moves it back
import { existsSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { Contract, JsonRpcProvider } from "ethers";
import { KeyPair, type KeyPairString } from "near-api-js";

const INTENTS = "intents.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"; // USDC on NEAR, 6 decimals
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RPC = process.env.NEAR_MAINNET_RPC || "https://rpc.mainnet.fastnear.com";
const RELAY = "https://solver-relay-v2.chaindefuser.com/rpc";
const send = process.argv.includes("--send");

const stateFile = new URL("../.veto-dev/agentapi.json", import.meta.url);
if (!existsSync(stateFile)) {
  console.error("No .veto-dev/agentapi.json: run scripts/agentapi-setup.ts first.");
  process.exit(1);
}
const state = JSON.parse(readFileSync(stateFile, "utf8")) as {
  wallet?: string;
  payees?: Record<string, { name: string; key: string; account: string }>;
  workers?: Record<string, { name: string; chain: string; address: string }>;
};
if (!state.wallet || !state.payees) {
  console.error("The agent isn't set up yet: run scripts/agentapi-setup.ts first.");
  process.exit(1);
}
const wallet = state.wallet;

/** A read-only call on intents.near. */
async function view<T>(method: string, args: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "veto",
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: INTENTS, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const body = (await res.json()) as { error?: unknown; result?: { result?: number[]; error?: string } };
  if (body.error || body.result?.error || !body.result?.result) throw new Error(`${method}: ${body.result?.error ?? JSON.stringify(body.error)}`);
  return JSON.parse(Buffer.from(body.result.result).toString());
}

async function relay<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RELAY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "veto", method, params: [params] }) });
  const body = (await res.json()) as { error?: unknown; result?: T };
  if (body.error || body.result === undefined) throw new Error(`${method}: ${JSON.stringify(body.error ?? body)}`);
  return body.result;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const b of bytes) {
    if (b) break;
    out = `1${out}`;
  }
  return out;
}

/** intents.near's versioned nonce: magic prefix, version 0, the contract's current salt, the deadline, 15 random bytes. */
function saltedNonce(salt: string, deadline: Date): Buffer {
  const nonce = Buffer.alloc(32);
  Buffer.from([0x56, 0x28, 0xf6, 0xc6]).copy(nonce, 0);
  nonce[4] = 0;
  Buffer.from(salt, "hex").copy(nonce, 5);
  nonce.writeBigUInt64LE(BigInt(deadline.getTime()) * 1_000_000n, 9);
  randomBytes(15).copy(nonce, 17);
  return nonce;
}

/** sha256 of the NEP-413 payload in borsh: tag 2^31 + 413, message, nonce, recipient, no callback. */
function nep413Hash(message: string, nonce: Buffer, recipient: string): Uint8Array {
  const str = (s: string) => {
    const bytes = Buffer.from(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]);
  };
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  return createHash("sha256").update(Buffer.concat([tag, str(message), nonce, str(recipient), Buffer.from([0])])).digest();
}

/** One supplier's signed transfer of `amount` USDC back to the agent's wallet. */
function signedTransfer(payee: { key: string; account: string }, amount: string, salt: string) {
  const deadline = new Date(Date.now() + 5 * 60_000);
  const message = JSON.stringify({
    deadline: deadline.toISOString(),
    intents: [{ intent: "transfer", receiver_id: wallet, tokens: { [USDC]: amount }, memo: "veto demo: back to the agent" }],
    signer_id: payee.account,
  });
  const nonce = saltedNonce(salt, deadline);
  const key = KeyPair.fromString(payee.key as KeyPairString);
  const { signature } = key.sign(nep413Hash(message, nonce, INTENTS));
  return {
    standard: "nep413",
    payload: { message, nonce: nonce.toString("base64"), recipient: INTENTS },
    public_key: key.getPublicKey().toString(),
    signature: `ed25519:${base58(signature)}`,
  };
}

const usd = (raw: bigint | string) => `$${(Number(raw) / 1e6).toFixed(6).replace(/0{1,4}$/, "")}`;
const balanceOf = async (account: string) => BigInt(await view<string>("mt_balance_of", { account_id: account, token_id: USDC }));

console.log(`Agent wallet ${wallet.slice(0, 8)}…: ${usd(await balanceOf(wallet))} USDC on NEAR Intents`);
const salt = await view<string>("current_salt", {});
let moved = 0n;
for (const payee of Object.values(state.payees)) {
  const balance = await balanceOf(payee.account);
  if (balance === 0n) {
    console.log(`• ${payee.name}: nothing to move`);
    continue;
  }
  const signed = signedTransfer(payee, balance.toString(), salt);
  // intents.near runs the transfer without committing it: a bad signature, nonce or balance fails here.
  await view("simulate_intents", { signed: [signed] });
  if (!send) {
    console.log(`• ${payee.name}: ${usd(balance)} can go back (intents.near accepts the transfer; run with --send)`);
    continue;
  }
  const published = await relay<{ status: string; intent_hash?: string; reason?: string }>("publish_intent", { quote_hashes: [], signed_data: signed });
  if (published.status !== "OK" || !published.intent_hash) throw new Error(`${payee.name}: the relay refused it (${published.reason ?? published.status})`);
  let status = "PENDING";
  for (let i = 0; i < 60 && !["SETTLED", "NOT_FOUND_OR_NOT_VALID"].includes(status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    status = (await relay<{ status: string }>("get_status", { intent_hash: published.intent_hash })).status;
  }
  if (status !== "SETTLED") throw new Error(`${payee.name}: the transfer didn't settle (${status}, intent ${published.intent_hash})`);
  moved += balance;
  console.log(`• ${payee.name}: moved ${usd(balance)} back to the agent (intent ${published.intent_hash})`);
}
if (moved > 0n) console.log(`Agent wallet now holds ${usd(await balanceOf(wallet))} USDC`);

// Salaries paid out to Base sit at the worker's own address; it's only reported here.
const base = new JsonRpcProvider("https://mainnet.base.org");
const erc20 = new Contract(BASE_USDC, ["function balanceOf(address) view returns (uint256)"], base);
for (const w of Object.values(state.workers ?? {}).filter((w) => w.chain === "base")) {
  const held = await erc20.balanceOf(w.address).catch(() => null);
  console.log(`• ${w.name}: ${held === null ? "couldn't read" : usd(held)} USDC on Base at ${w.address} (salaries stay there)`);
}
