// One snapshot per vault, shared by every visitor. Each refreshes at most every few seconds, so
// RPC load stays flat however many people have a vault open.
import { VaultReader } from "@veto/core/vault";
import { EXPLORER, evmBalance, vaultEvmAddress, type EvmRoute } from "@veto/core/evm";
import { NATIVE, type AssetMeta } from "@/lib/format";
import type { AgentInfo, AssetPolicy, PendingPolicy, SpendStatus, VaultState, WalletInfo } from "@/lib/vault";
import { accountBalance, serverRpc } from "./rpc";

const FRESH_MS = 3000;
const STALE_OK_MS = 60_000;
const metas = new Map<string, AssetMeta>([["near", NATIVE]]);
const MAX_VAULTS = 200;
const last = new Map<string, { at: number; state: VaultState }>();
const inflight = new Map<string, Promise<VaultState>>();

async function load(vaultId: string): Promise<VaultState> {
  const rpc = serverRpc();
  const reader = new VaultReader(vaultId, rpc);
  const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
    rpc.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } }) as Promise<T>;

  const [config, proposals, payees, agents, wallets, policies, pending, account, evmRoutes] = await Promise.all([
    reader.config(),
    reader.proposals(0, 100),
    reader.payees(),
    reader.view<[string, AgentInfo][]>("get_agents"),
    // Vaults deployed before external wallets existed don't have this view.
    reader.view<[string, WalletInfo][]>("get_wallets").catch(() => [] as [string, WalletInfo][]),
    reader.view<[string, AssetPolicy][]>("get_policies"),
    reader.view<[string, PendingPolicy][]>("get_pending_policies"),
    rpc.viewAccount({ accountId: vaultId }),
    reader.view<[string, EvmRoute][]>("get_evm_routes").catch(() => [] as [string, EvmRoute][]),
  ]);

  const assetIds = [...new Set(["near", ...policies.map(([asset]) => asset)])];
  // "<chain>:<coin>" assets live on an EVM chain, paid from the vault's Chain Signatures address.
  for (const [, route] of evmRoutes) metas.set(route.asset, { symbol: route.asset.split(":")[1].toUpperCase(), decimals: 18 });
  await Promise.all(
    assetIds
      .filter((id) => !metas.has(id) && !id.includes(":"))
      .map(async (id) => {
        const m = await view<{ symbol: string; decimals: number }>(id, "ft_metadata");
        metas.set(id, { symbol: m.symbol, decimals: m.decimals });
      }),
  );
  const assets = Object.fromEntries(assetIds.map((id) => [id, metas.get(id)!]));

  // Native balance net of the NEAR locked for contract storage (1 NEAR per 100 KB).
  const spendableNear = account.amount - BigInt(account.storage_usage) * 10n ** 19n;
  const tokenIds = assetIds.filter((id) => id !== "near" && !id.includes(":"));
  const [tokenBalances, spendList, evm] = await Promise.all([
    Promise.all(tokenIds.map((id) => view<string>(id, "ft_balance_of", { account_id: vaultId }).then(BigInt))),
    Promise.all(policies.map(([asset]) => reader.view<SpendStatus>("get_spend", { asset }))),
    Promise.all(
      evmRoutes.map(async ([chain, route]) => {
        const address = await vaultEvmAddress(reader, route);
        const balance = await evmBalance(route.chain_id, address).catch(() => 0n);
        return { chain, asset: route.asset, chainId: route.chain_id, address, balance, explorer: EXPLORER[route.chain_id] ?? "" };
      }),
    ),
  ]);
  const balances: Record<string, bigint> = { near: spendableNear > 0n ? spendableNear : 0n };
  tokenIds.forEach((id, i) => (balances[id] = tokenBalances[i]));
  for (const e of evm) balances[e.asset] = e.balance;
  const spend = Object.fromEntries(spendList.map((s) => [s.asset, s]));

  const evmAccounts = evm.map(({ balance: _balance, ...rest }) => rest);
  return { config, proposals, payees, agents, wallets, policies, pending, spend, assets, balances, evmAccounts, primaryAsset: tokenIds[0] ?? "near" };
}

/** The account isn't there: a mistyped link, or a vault that was never created. */
export class NoSuchVault extends Error {}

/** The latest snapshot; a stale one (up to a minute old) if the RPCs are briefly unavailable. */
export async function vaultSnapshot(vaultId: string): Promise<{ state: VaultState; stale: boolean }> {
  const prev = last.get(vaultId);
  if (prev && Date.now() - prev.at < FRESH_MS) return { state: prev.state, stale: false };
  let pending = inflight.get(vaultId);
  if (!pending) {
    pending = load(vaultId).finally(() => inflight.delete(vaultId));
    inflight.set(vaultId, pending);
  }
  try {
    const state = await pending;
    last.delete(vaultId);
    last.set(vaultId, { at: Date.now(), state });
    // Forget the least recently read vaults.
    while (last.size > MAX_VAULTS) last.delete(last.keys().next().value!);
    return { state, stale: false };
  } catch (e) {
    if (prev && Date.now() - prev.at < STALE_OK_MS) return { state: prev.state, stale: true };
    if (await missing(vaultId)) throw new NoSuchVault(`${vaultId} doesn't exist`);
    throw e;
  }
}

/** Asks one RPC directly: the failover provider reports a missing account as a failed request. */
async function missing(accountId: string): Promise<boolean> {
  return (await accountBalance(accountId)) === null;
}
