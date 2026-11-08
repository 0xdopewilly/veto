// Keeps the public testnet demo able to run all day: reports what every demo account has left
// and, with --fix, mints test USDC, tops up gas and raises the weekly cap so a busy judging week
// never looks like a broken demo. The $500 per-payment cap stays, so the scam story holds.
// It also keeps the vault factory able to sponsor new vaults, refilling it from the faucet.
//   node scripts/demo-health.ts          (report)
//   node scripts/demo-health.ts --fix    (report, then top everything up)
import { nearToYocto, teraToGas } from "near-api-js";
import { evmBalance, MPC_CONTRACT, provider, VaultReader, vaultEvmAddress } from "@veto/core";
process.env.VETO_PROFILE ??= "demo3";
const { account, ensureRootYocto, loadState } = await import("./dev-state.ts");

const FIX = process.argv.includes("--fix");
const USD = 1_000_000n;
const WEEKLY = 50_000n * USD;
const state = loadState("testnet");
const rpc = provider("testnet");
const root = account(state.root!, "testnet");
const vault = new VaultReader(state.vault!.accountId, rpc);
const token = state.token!.accountId;

const near = async (id: string) => BigInt((await rpc.viewAccount({ accountId: id })).amount);
const usdc = async (id: string) => BigInt((await rpc.callFunction({ contractId: token, method: "ft_balance_of", args: { account_id: id } })) as string);
const fmt = (v: bigint, d: number, p = 2) => (Number(v) / 10 ** d).toFixed(p);
/** NEAR an account can spend: its balance less what its storage locks (1e19 yocto a byte). */
const spendable = async (id: string) => {
  const a = await rpc.viewAccount({ accountId: id });
  return BigInt(a.amount) - BigInt(a.storage_usage) * 10n ** 19n;
};

// What the factory sends with each vault: 0.5 for the vault, 0.1 and 0.3 for its agent and guardian.
const PER_VAULT = nearToYocto("0.9");
const FACTORY_LOW = 15n;
const FACTORY_FILL = 30n;
// The sandbox vault pays for its own storage, about 700 bytes a payment (1e19 yocto a byte). Below
// 2 NEAR free (about 280 payments) --fix tops it up to 6 (about 850), so a busy week can't fill it.
const VAULT_LOW = nearToYocto("2");
const VAULT_FILL = nearToYocto("6");
const PAYMENT_BYTES = 700n;

const gas: [string, string, bigint][] = [
  ["agent", state.agent!.accountId, nearToYocto("0.5")],
  ["guardian", state.guardian!.accountId, nearToYocto("1")],
  ["OutLayer wallet", state.outlayer!.account, nearToYocto("0.3")],
];
const funds: [string, string, bigint, bigint][] = [
  ["vault", state.vault!.accountId, 20_000n * USD, 50_000n * USD],
  ["OutLayer wallet", state.outlayer!.account, 5_000n * USD, 20_000n * USD],
];
const spend = await vault.view<{ spent: string; period_limit: string; resets_at: string }>("get_spend", { asset: token });
const baseAddress = await vaultEvmAddress(vault, { mpc: MPC_CONTRACT.testnet, path: "veto-1" });
const baseEth = await evmBalance("84532", baseAddress).catch(() => 0n);

console.log(`vault ${vault.vaultId}, ${(await vault.config()).proposal_count} payments so far`);
for (const [name, id, low] of gas) console.log(`  ${name.padEnd(16)} ${fmt(await near(id), 24, 3)} NEAR gas${(await near(id)) < low ? "  (low)" : ""}`);
for (const [name, id, low] of funds) console.log(`  ${name.padEnd(16)} $${fmt(await usdc(id), 6)} test USDC${(await usdc(id)) < low ? "  (low)" : ""}`);
console.log(`  weekly cap       $${fmt(BigInt(spend.spent), 6)} of $${fmt(BigInt(spend.period_limit), 6)} used, resets ${new Date(Number(spend.resets_at) * 1000).toUTCString()}`);
console.log(`  Base Sepolia     ${fmt(baseEth, 18, 4)} ETH at ${baseAddress} (about ${baseEth / 100_000_000_000_000n} payouts of 0.0001 ETH)`);
const factory = state.factory;
const factoryRoom = factory ? (await spendable(factory)) / PER_VAULT : 0n;
if (factory) {
  const count = await rpc.callFunction({ contractId: factory, method: "count", args: {} });
  console.log(`  vault factory    ${count} vaults created, room for ${factoryRoom} more${factoryRoom < FACTORY_LOW ? "  (low)" : ""}`);
}
const vaultFree = await spendable(vault.vaultId);
console.log(`  vault storage    ${fmt(vaultFree, 24, 3)} NEAR free, room for about ${vaultFree / 10n ** 19n / PAYMENT_BYTES} more payments${vaultFree < VAULT_LOW ? "  (low)" : ""}`);
console.log(`  root             ${fmt(await spendable(state.root!.accountId), 24, 3)} NEAR spendable`);
if (!FIX) process.exit(0);

console.log("\nTopping up:");
for (const [name, id, low] of gas) {
  if ((await near(id)) >= low) continue;
  await root.transfer({ receiverId: id, amount: low * 2n });
  console.log(`  sent ${fmt(low * 2n, 24)} NEAR to the ${name}`);
}
for (const [name, id, low, to] of funds) {
  if ((await usdc(id)) >= low) continue;
  await root.callFunction({ contractId: token, methodName: "mint", args: { account_id: id, amount: String(to) }, gas: teraToGas("30") });
  console.log(`  minted $${fmt(to, 6)} test USDC to the ${name}`);
}
if (BigInt(spend.period_limit) < WEEKLY) {
  const policy = { period_limit: String(WEEKLY), max_single: String(500n * USD) };
  await root.callFunction({ contractId: vault.vaultId, methodName: "set_policy", args: { asset: token, policy }, gas: teraToGas("30") });
  const delay = Number((await vault.config()).raise_delay_secs);
  console.log(`  raising the weekly cap to $${fmt(WEEKLY, 6)}; a raise waits ${delay} s by design`);
  await new Promise((r) => setTimeout(r, (delay + 5) * 1000));
  await root.callFunction({ contractId: vault.vaultId, methodName: "apply_policy", args: { asset: token }, gas: teraToGas("30") });
  console.log("  applied the new weekly cap");
}
if (vaultFree < VAULT_LOW) {
  const need = VAULT_FILL - vaultFree;
  try {
    await ensureRootYocto(state, need + nearToYocto("1"), (s) => console.log(`  ${s}`));
    await root.transfer({ receiverId: vault.vaultId, amount: need });
    console.log(`  sent ${fmt(need, 24)} NEAR to the vault for storage (room for about ${VAULT_FILL / 10n ** 19n / PAYMENT_BYTES} payments)`);
  } catch (e) {
    console.log(`  couldn't top up the vault's storage: ${(e as Error).message}`);
  }
}
if (factory && factoryRoom < FACTORY_LOW) {
  const need = (FACTORY_FILL - factoryRoom) * PER_VAULT;
  try {
    await ensureRootYocto(state, need + nearToYocto("1"), (s) => console.log(`  ${s}`));
    await root.transfer({ receiverId: factory, amount: need });
    console.log(`  sent ${fmt(need, 24)} NEAR to the vault factory (room for ${FACTORY_FILL} vaults)`);
  } catch (e) {
    console.log(`  couldn't refill the vault factory: ${(e as Error).message}`);
  }
}
console.log("Done.");
