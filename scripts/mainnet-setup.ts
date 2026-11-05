// Builds a mainnet Veto vault that holds real USDC and pays a supplier on Base through NEAR
// Intents. Prints the plan and its cost and sends nothing unless you pass --send.
//
//   node scripts/mainnet-setup.ts          (dry run: what it would do and cost)
//   node scripts/mainnet-setup.ts --send   (does it; safe to re-run, finished steps are skipped)
//
// Needs in .env.local: MAINNET_ROOT_ID and MAINNET_ROOT_KEY (a full-access key of a mainnet
// account you created and funded for this, never your prize payout account) and
// MAINNET_SUPPLIER_BASE (the Base address that receives the test payout).
import { existsSync, readFileSync } from "node:fs";
import { actions, nearToYocto, PublicKey, teraToGas, yoctoToNear, type KeyPairString } from "near-api-js";
import { DEFAULT_MODEL, modelAttestation, USDC } from "@veto/core";
process.env.VETO_PROFILE ??= "mainnet";
const { account, exists, loadState, newKey, saveState } = await import("./dev-state.ts");

const NETWORK = "mainnet";
const SEND = process.argv.includes("--send");
const USDC_TOKEN = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USD = 1_000_000n;
const WASM = new URL("../contract/target/wasm32-unknown-unknown/release/veto_vault.wasm", import.meta.url);
const MANDATE = "Pay listed suppliers only, in USDC. No single payment over $25. Ask me before paying a new or changed address.";
// Small on purpose: this vault exists to prove one real payout.
const POLICY = { period_limit: String(50n * USD), max_single: String(25n * USD) };
const ROUTE = { token: USDC_TOKEN, origin_asset: USDC.near, destination_asset: USDC.base, max_fee_bps: 300 };
const SUBS = { treasury: "0.1", buyer: "0.1", guardian: "0.3" } as const;

loadEnv(new URL("../.env.local", import.meta.url));
const rootId = process.env.MAINNET_ROOT_ID ?? "";
const rootKey = (process.env.MAINNET_ROOT_KEY ?? "") as KeyPairString;
const supplier = (process.env.MAINNET_SUPPLIER_BASE ?? "").toLowerCase();
if (!rootId || !rootKey || !/^0x[0-9a-f]{40}$/.test(supplier)) {
  throw new Error("set MAINNET_ROOT_ID, MAINNET_ROOT_KEY and MAINNET_SUPPLIER_BASE (a 0x… Base address) in .env.local");
}
// An account this script must never use, e.g. where a prize is paid (MAINNET_PROTECTED_ACCOUNT, optional).
const PROTECTED = process.env.MAINNET_PROTECTED_ACCOUNT?.trim() || null;
if (PROTECTED && (rootId === PROTECTED || rootId.endsWith(`.${PROTECTED}`))) throw new Error(`use a separate account, not ${PROTECTED}`);

const state = loadState(NETWORK);
state.root = { accountId: rootId, key: rootKey };
const root = account(state.root, NETWORK);
const code = new Uint8Array(readFileSync(WASM));
const storage = BigInt(code.length) * 10n ** 19n;
const needed = storage + Object.values(SUBS).reduce((s, n) => s + nearToYocto(n), 0n) + nearToYocto("0.5");
const balance = (await exists(rootId, NETWORK)) ? await root.getBalance() : 0n;
const vaultId = `treasury.${rootId}`;

console.log(`${SEND ? "Setting up" : "Dry run:"} a mainnet vault ${vaultId}`);
console.log(`  contract storage  ${yoctoToNear(storage, 2)} NEAR (${Math.round(code.length / 1024)} KB)`);
console.log(`  sub-accounts      ${Object.entries(SUBS).map(([k, v]) => `${k} ${v}`).join(", ")} NEAR`);
console.log(`  needs about       ${yoctoToNear(needed, 2)} NEAR; ${rootId} holds ${yoctoToNear(balance, 2)} NEAR`);
console.log(`  policy            $25 per payment, $50 a week, USDC only`);
console.log(`  route             USDC on NEAR -> USDC on Base, fees up to ${ROUTE.max_fee_bps / 100}%`);
console.log(`  supplier          ${supplier} on Base`);
if (!SEND) {
  console.log("\nNothing was sent. Run with --send to do it.");
  process.exit(0);
}
if (balance < needed) throw new Error(`fund ${rootId} with at least ${yoctoToNear(needed - balance, 2)} more NEAR first`);
const log = (m: string) => console.log(`• ${m}`);

for (const [prefix, fund] of Object.entries(SUBS)) {
  const id = `${prefix}.${rootId}`;
  if (await exists(id, NETWORK)) continue;
  const key = newKey();
  const extra = prefix === "treasury" ? storage : 0n;
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(fund) + extra });
  const dev = { accountId: id, key: key.toString() as KeyPairString };
  if (prefix === "treasury") state.vault = dev;
  else if (prefix === "buyer") state.agent = dev;
  else state.guardian = dev;
  saveState(state);
  log(`created ${id}`);
}

if (!state.initialized) {
  await account(state.vault!, NETWORK).deployContract(code);
  await root.callFunction({
    contractId: vaultId,
    methodName: "new",
    args: {
      owner: rootId,
      guardian: state.guardian!.accountId,
      mandate: MANDATE,
      policies: [[USDC_TOKEN, POLICY]],
      period_anchor_secs: String(Math.floor(Date.now() / 1000)),
      override_delay_secs: "3600",
      raise_delay_secs: "86400",
      screen_timeout_secs: "600",
    },
    gas: teraToGas("100"),
  });
  state.initialized = true;
  saveState(state);
  log(`deployed the vault ${vaultId}`);
}

const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  root.provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } }) as Promise<T>;
const call = (contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
  root.callFunction({ contractId, methodName, args, deposit, gas: teraToGas("30") });

if (!(await view(USDC_TOKEN, "storage_balance_of", { account_id: vaultId }))) {
  await call(USDC_TOKEN, "storage_deposit", { account_id: vaultId, registration_only: true }, nearToYocto("0.00125"));
  log("registered the vault with USDC");
}
if (!(await view<[string, unknown][]>(vaultId, "get_agents")).some(([id]) => id === state.agent!.accountId)) {
  await call(vaultId, "add_agent", { agent: state.agent!.accountId });
}
if (!(await view<{ address: string }[]>(vaultId, "get_payees")).some((p) => p.address === supplier)) {
  await call(vaultId, "add_payee", { name: "Test supplier (Base)", chain: "base", address: supplier });
  log("added the Base supplier");
}
if (!(await view<[string, unknown][]>(vaultId, "get_routes")).some(([chain]) => chain === "base")) {
  await call(vaultId, "set_route", { chain: "base", route: ROUTE });
  log("set the Base route through NEAR Intents");
}
const { nonce, report } = await modelAttestation(DEFAULT_MODEL);
const attested = (report.model_attestations ?? []).filter((m: { request_nonce?: string; signing_algo?: string }) => m.request_nonce === nonce && m.signing_algo === "ecdsa");
if (attested.length !== 1) throw new Error(`expected one attested key for ${DEFAULT_MODEL}`);
state.modelSigner = String(attested[0].signing_address).toLowerCase();
if (!(await view<[string, unknown][]>(vaultId, "get_signers")).some(([a]) => a === state.modelSigner)) {
  await call(vaultId, "add_signer", { address: state.modelSigner, model_id: DEFAULT_MODEL });
  log(`approved the attested ${DEFAULT_MODEL} key ${state.modelSigner}`);
}

async function narrowKey(holder: { accountId: string; key: KeyPairString }, methods: string[]) {
  const key = newKey();
  await account(holder, NETWORK).signAndSendTransaction({
    receiverId: holder.accountId,
    actions: [actions.addFunctionCallAccessKey(PublicKey.from(key.getPublicKey().toString()), vaultId, methods, undefined)],
  });
  return key.toString() as KeyPairString;
}
state.agentProposeKey ??= await narrowKey(state.agent!, ["propose"]);
state.guardianVerdictKey ??= await narrowKey(state.guardian!, ["submit_verdict", "expire", "execute_override"]);
saveState(state);
log("agent and guardian keys are limited to their vault methods");
console.log(`\nMainnet vault ready: https://nearblocks.io/address/${vaultId}\nNext: node scripts/mainnet-fund.ts --amount 10`);

function loadEnv(file: URL) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
