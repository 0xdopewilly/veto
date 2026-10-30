// Adds the testnet USDC stand-in to the demo: deploys the token, funds the vault with
// $12,480, registers the payees, and gives the vault a $500-a-week USDC policy.
// Safe to re-run.   node scripts/testnet-token.ts
import { readFileSync } from "node:fs";
import { nearToYocto, teraToGas, yoctoToNear } from "near-api-js";
import { account, exists, loadState, newKey, saveState } from "./dev-state.ts";

const NETWORK = "testnet";
const WASM = new URL("../test-token/target/wasm32-unknown-unknown/release/veto_test_usdc.wasm", import.meta.url);
const USD = 1_000_000n; // 6 decimals
const POLICY = { period_limit: String(500n * USD), max_single: String(500n * USD) };

const state = loadState(NETWORK) as ReturnType<typeof loadState> & { token?: { accountId: string; key: `ed25519:${string}` }; tokenReady?: boolean };
if (!state.initialized) throw new Error("run scripts/testnet-setup.ts first");
const root = account(state.root!, NETWORK);
const vaultId = state.vault!.accountId;
const log = (m: string) => console.log(`• ${m}`);
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  root.provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } }) as Promise<T>;

// 1. Token account + contract.
const tokenId = `usdc.${state.root!.accountId}`;
if (!state.token || !(await exists(tokenId, NETWORK))) {
  const key = newKey();
  const code = new Uint8Array(readFileSync(WASM));
  const storage = BigInt(code.length) * 10n ** 19n + nearToYocto("0.3");
  await root.createSubAccount({ accountOrPrefix: "usdc", publicKey: key.getPublicKey(), nearToTransfer: storage });
  state.token = { accountId: tokenId, key: key.toString() };
  saveState(state);
  log(`created ${tokenId} with ${yoctoToNear(storage, 2)} NEAR for storage`);
}
const token = account(state.token!, NETWORK);
if (!state.tokenReady) {
  await token.deployContract(new Uint8Array(readFileSync(WASM)));
  await token.callFunction({ contractId: tokenId, methodName: "new", args: { owner_id: state.root!.accountId }, gas: teraToGas("30") });
  state.tokenReady = true;
  saveState(state);
  log("deployed and initialised the test USDC token");
}

// 2. Fund the vault and register the payees so they can receive.
const balance = BigInt(await view<string>(tokenId, "ft_balance_of", { account_id: vaultId }));
if (balance === 0n) {
  await root.callFunction({ contractId: tokenId, methodName: "mint", args: { account_id: vaultId, amount: String(12_480n * USD) }, gas: teraToGas("30") });
  log("minted $12,480.00 test USDC to the vault");
}
for (const payee of Object.values(state.payees ?? {})) {
  const registered = await view<unknown>(tokenId, "storage_balance_of", { account_id: payee.accountId });
  if (registered) continue;
  await root.callFunction({
    contractId: tokenId,
    methodName: "storage_deposit",
    args: { account_id: payee.accountId, registration_only: true },
    deposit: nearToYocto("0.00125"),
    gas: teraToGas("30"),
  });
  log(`registered ${payee.accountId} with the token`);
}

// 3. A $500-a-week USDC policy. New assets wait out the raise delay (180 s on this demo vault).
const policies = await view<[string, unknown][]>(vaultId, "get_policies");
if (!policies.some(([asset]) => asset === tokenId)) {
  const pending = await view<[string, { effective_at: string }][]>(vaultId, "get_pending_policies");
  let entry = pending.find(([asset]) => asset === tokenId);
  if (!entry) {
    await root.callFunction({ contractId: vaultId, methodName: "set_policy", args: { asset: tokenId, policy: POLICY }, gas: teraToGas("30") });
    log("scheduled the $500-a-week USDC policy");
    entry = (await view<[string, { effective_at: string }][]>(vaultId, "get_pending_policies")).find(([a]) => a === tokenId);
  }
  const waitMs = Number(BigInt(entry![1].effective_at) / 1_000_000n) - Date.now() + 3000;
  if (waitMs > 0) {
    log(`waiting ${Math.ceil(waitMs / 1000)} s for the raise delay`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  await root.callFunction({ contractId: vaultId, methodName: "apply_policy", args: { asset: tokenId }, gas: teraToGas("30") });
  log("applied the USDC policy");
}
const spend = await view<{ spent: string; period_limit: string }>(vaultId, "get_spend", { asset: tokenId });
console.log(`\nVault holds $${(Number(await view<string>(tokenId, "ft_balance_of", { account_id: vaultId })) / 1e6).toFixed(2)} test USDC; weekly limit $${Number(spend.period_limit) / 1e6}.`);
