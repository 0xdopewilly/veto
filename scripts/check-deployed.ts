// Checks that what runs on NEAR testnet is exactly this repo's code: it hashes the contracts that
// `pnpm build:contracts` just built and compares them with the code deployed for the live demo.
// Read-only and keyless.
//   pnpm build:contracts && node scripts/check-deployed.ts [root account]
//   pnpm build:contracts && pnpm shrink:vault && node scripts/check-deployed.ts --mainnet
// --mainnet checks the mainnet vault that made the first real payout instead (the shrunk build).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const MAINNET = process.argv.includes("--mainnet");
const root = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? (MAINNET ? "veto-mainnet.near" : "veto-rhwe0krb.testnet");
const RPC = MAINNET ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** NEAR writes code hashes in base58. */
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
const wasm = (path: string) => new URL(`../${path}/target/wasm32-unknown-unknown/release/`, import.meta.url);
const hashOf = (file: URL) => base58(createHash("sha256").update(readFileSync(file)).digest());

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "veto", method, params }) });
  const body = (await res.json()) as { result?: T; error?: { cause?: { name?: string }; message?: string } };
  if (!body.result) throw new Error(`${method}: ${body.error?.cause?.name ?? body.error?.message ?? res.status}`);
  return body.result;
}
const deployedCode = async (account: string) => (await rpc<{ code_hash: string }>("query", { request_type: "view_account", finality: "final", account_id: account })).code_hash;
const view = async <T>(account: string, method: string) => {
  const r = await rpc<{ result: number[] }>("query", { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: "" });
  return JSON.parse(Buffer.from(r.result).toString()) as T;
};

const checks: [string, URL, () => Promise<string>][] = MAINNET ? [
  [`mainnet vault treasury.${root} (pnpm shrink:vault)`, new URL("veto_vault.opt.wasm", wasm("contract")), () => deployedCode(`treasury.${root}`)],
] : [
  ["vault (the shared sandbox)", new URL("veto_vault.wasm", wasm("contract")), () => deployedCode(`treasury.${root}`)],
  ["vault code every factory vault runs (global contract)", new URL("veto_vault.wasm", wasm("contract")), () => view<string>(`vaults.${root}`, "get_code_hash")],
  ["factory", new URL("veto_factory.wasm", wasm("factory")), () => deployedCode(`vaults.${root}`)],
  ["test USDC token", new URL("veto_test_usdc.wasm", wasm("test-token")), () => deployedCode(`usdc.${root}`)],
];

let mismatches = 0;
for (const [name, file, deployed] of checks) {
  if (!existsSync(file)) throw new Error(`${file.pathname} is missing: run pnpm build:contracts${MAINNET ? " && pnpm shrink:vault" : ""} first`);
  const [local, live] = [hashOf(file), await deployed()];
  const same = local === live;
  if (!same) mismatches++;
  console.log(`${same ? "✓" : "✗"} ${name}: ${same ? live : `built ${local}, deployed ${live}`}`);
}
console.log(mismatches ? "\nSome deployed code differs from this build (a different Rust version changes the bytes; see rust-toolchain.toml)." : "\nThe deployed contracts are exactly this code.");
process.exitCode = mismatches ? 1 : 0;
