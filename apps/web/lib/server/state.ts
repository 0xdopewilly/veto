// One snapshot of the vault, shared by every visitor. It refreshes at most every couple of
// seconds, so RPC load stays flat however many people have the app open.
import { VaultReader } from "@veto/core/vault";
import { VAULT_ID } from "@/lib/config";
import { NATIVE, type AssetMeta } from "@/lib/format";
import type { AgentInfo, AssetPolicy, PendingPolicy, SpendStatus, VaultState, WalletInfo } from "@/lib/vault";
import { serverRpc } from "./rpc";

const FRESH_MS = 3000;
const STALE_OK_MS = 60_000;
const metas = new Map<string, AssetMeta>([["near", NATIVE]]);
let last: { at: number; state: VaultState } | null = null;
let inflight: Promise<VaultState> | null = null;

async function load(): Promise<VaultState> {
  const rpc = serverRpc();
  const reader = new VaultReader(VAULT_ID, rpc);
  const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
    rpc.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } }) as Promise<T>;

  const [config, proposals, payees, agents, wallets, policies, pending, account] = await Promise.all([
    reader.config(),
    reader.proposals(0, 100),
    reader.payees(),
    reader.view<[string, AgentInfo][]>("get_agents"),
    // Vaults deployed before external wallets existed don't have this view.
    reader.view<[string, WalletInfo][]>("get_wallets").catch(() => [] as [string, WalletInfo][]),
    reader.view<[string, AssetPolicy][]>("get_policies"),
    reader.view<[string, PendingPolicy][]>("get_pending_policies"),
    rpc.viewAccount({ accountId: VAULT_ID }),
  ]);

  const assetIds = [...new Set(["near", ...policies.map(([asset]) => asset)])];
  await Promise.all(
    assetIds
      .filter((id) => !metas.has(id))
      .map(async (id) => {
        const m = await view<{ symbol: string; decimals: number }>(id, "ft_metadata");
        metas.set(id, { symbol: m.symbol, decimals: m.decimals });
      }),
  );
  const assets = Object.fromEntries(assetIds.map((id) => [id, metas.get(id)!]));

  // Native balance net of the NEAR locked for contract storage (1 NEAR per 100 KB).
  const spendableNear = account.amount - BigInt(account.storage_usage) * 10n ** 19n;
  const tokenIds = assetIds.filter((id) => id !== "near");
  const [tokenBalances, spendList] = await Promise.all([
    Promise.all(tokenIds.map((id) => view<string>(id, "ft_balance_of", { account_id: VAULT_ID }).then(BigInt))),
    Promise.all(policies.map(([asset]) => reader.view<SpendStatus>("get_spend", { asset }))),
  ]);
  const balances: Record<string, bigint> = { near: spendableNear > 0n ? spendableNear : 0n };
  tokenIds.forEach((id, i) => (balances[id] = tokenBalances[i]));
  const spend = Object.fromEntries(spendList.map((s) => [s.asset, s]));

  return { config, proposals, payees, agents, wallets, policies, pending, spend, assets, balances, primaryAsset: tokenIds[0] ?? "near" };
}

/** The latest snapshot; a stale one (up to a minute old) if the RPCs are briefly unavailable. */
export async function vaultSnapshot(): Promise<{ state: VaultState; stale: boolean }> {
  if (last && Date.now() - last.at < FRESH_MS) return { state: last.state, stale: false };
  inflight ??= load().finally(() => (inflight = null));
  try {
    const state = await inflight;
    last = { at: Date.now(), state };
    return { state, stale: false };
  } catch (e) {
    if (last && Date.now() - last.at < STALE_OK_MS) return { state: last.state, stale: true };
    throw e;
  }
}
