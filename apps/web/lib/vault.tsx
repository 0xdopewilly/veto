"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { JsonRpcProvider } from "near-api-js";
import { VaultReader } from "@veto/core/vault";
import type { Payee, Proposal, VaultConfig } from "@veto/core/proposal";
import { POLL_MS, RPC_URL, VAULT_ID } from "./config";
import { NATIVE, type AssetMeta } from "./format";

export interface AssetPolicy {
  period_limit: string;
  max_single: string;
}

export interface PendingPolicy {
  policy: AssetPolicy;
  effective_at: string;
}

export interface SpendStatus {
  asset: string;
  period: string;
  spent: string;
  period_limit: string;
  remaining: string;
  resets_at: string;
}

export interface AgentInfo {
  active: boolean;
  added_at: string;
}

/** An external agent wallet (e.g. OutLayer) whose payments the vault screens. */
export interface WalletInfo {
  provider: string;
  name: string;
  added_at: string;
}

export interface VaultState {
  config: VaultConfig;
  proposals: Proposal[];
  payees: Payee[];
  agents: [string, AgentInfo][];
  wallets: [string, WalletInfo][];
  /** The vault's own addresses on EVM chains (NEAR Chain Signatures), when it has routes there. */
  evmAccounts?: { chain: string; asset: string; chainId: string; address: string; explorer: string }[];
  policies: [string, AssetPolicy][];
  pending: [string, PendingPolicy][];
  spend: Record<string, SpendStatus>;
  assets: Record<string, AssetMeta>;
  balances: Record<string, bigint>;
  /** The asset the app leads with: the first allowed token, else native NEAR. */
  primaryAsset: string;
}

interface VaultContextValue {
  state: VaultState | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const rpc = new JsonRpcProvider({ url: RPC_URL });
export const reader = new VaultReader(VAULT_ID, rpc);

const metaCache = new Map<string, AssetMeta>([["near", NATIVE]]);

/** Optimistic view call on any contract. */
export function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return rpc.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } }) as Promise<T>;
}

export async function assetMeta(asset: string): Promise<AssetMeta> {
  const cached = metaCache.get(asset);
  if (cached) return cached;
  const meta = await view<{ symbol: string; decimals: number }>(asset, "ft_metadata");
  const value = { symbol: meta.symbol, decimals: meta.decimals };
  metaCache.set(asset, value);
  return value;
}

export async function accessKeys(accountId: string) {
  return rpc.viewAccessKeyList({ accountId, finalityQuery: { finality: "optimistic" } });
}

/** Reads the shared server snapshot; falls back to reading the chain directly. */
async function load(): Promise<VaultState> {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      data.balances = Object.fromEntries(Object.entries(data.balances as Record<string, string>).map(([k, v]) => [k, BigInt(v)]));
      for (const [id, meta] of Object.entries(data.assets as Record<string, AssetMeta>)) metaCache.set(id, meta);
      return data as VaultState;
    }
  } catch {
    // fall through to a direct read
  }
  return loadDirect();
}

async function loadDirect(): Promise<VaultState> {
  const [config, proposals, payees, agents, wallets, policies, pending, account] = await Promise.all([
    reader.config(),
    reader.proposals(0, 100),
    reader.payees(),
    reader.view<[string, AgentInfo][]>("get_agents"),
    // Vaults deployed before external wallets existed don't have this view.
    reader.view<[string, WalletInfo][]>("get_wallets").catch(() => []),
    reader.view<[string, AssetPolicy][]>("get_policies"),
    reader.view<[string, PendingPolicy][]>("get_pending_policies"),
    rpc.viewAccount({ accountId: VAULT_ID }),
  ]);

  // EVM-chain assets ("<chain>:<coin>") need the server's snapshot; the direct read skips them.
  const assetIds = [...new Set(["near", ...policies.map(([asset]) => asset)])].filter((id) => !id.includes(":"));
  const metas = await Promise.all(assetIds.map(assetMeta));
  const assets = Object.fromEntries(assetIds.map((id, i) => [id, metas[i]]));

  // Native balance net of the NEAR locked for contract storage (1 NEAR per 100 KB).
  const spendableNear = account.amount - BigInt(account.storage_usage) * 10n ** 19n;
  const tokenIds = assetIds.filter((id) => id !== "near");
  const tokenBalances = await Promise.all(
    tokenIds.map((id) => view<string>(id, "ft_balance_of", { account_id: VAULT_ID }).then(BigInt)),
  );
  const balances: Record<string, bigint> = { near: spendableNear > 0n ? spendableNear : 0n };
  tokenIds.forEach((id, i) => (balances[id] = tokenBalances[i]));

  const spendList = await Promise.all(policies.map(([asset]) => reader.view<SpendStatus>("get_spend", { asset })));
  const spend = Object.fromEntries(spendList.map((s) => [s.asset, s]));

  const primaryAsset = tokenIds[0] ?? "near";
  return { config, proposals, payees, agents, wallets, policies, pending, spend, assets, balances, primaryAsset };
}

const VaultContext = createContext<VaultContextValue>({ state: null, error: null, refresh: async () => {} });

const sig = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/**
 * Keeps the previous objects wherever a fresh read brings nothing new: an idle poll returns the
 * same state (no re-render at all), and when one payment changes only its row re-renders.
 */
function reconcile(prev: VaultState | null, next: VaultState): VaultState {
  if (!prev) return next;
  if (sig(prev) === sig(next)) return prev;
  const old = new Map(prev.proposals.map((p) => [p.id, p]));
  const proposals = next.proposals.map((p) => {
    const o = old.get(p.id);
    return o && sig(o) === sig(p) ? o : p;
  });
  const same = proposals.length === prev.proposals.length && proposals.every((p, i) => p === prev.proposals[i]);
  const keep = <T,>(a: T, b: T) => (sig(a) === sig(b) ? a : b);
  return {
    ...next,
    proposals: same ? prev.proposals : proposals,
    config: keep(prev.config, next.config),
    payees: keep(prev.payees, next.payees),
    agents: keep(prev.agents, next.agents),
    wallets: keep(prev.wallets, next.wallets),
    policies: keep(prev.policies, next.policies),
    pending: keep(prev.pending, next.pending),
    spend: keep(prev.spend, next.spend),
    assets: keep(prev.assets, next.assets),
    balances: keep(prev.balances, next.balances),
  };
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await load();
      setState((prev) => reconcile(prev, next));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the vault");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo(() => ({ state, error, refresh }), [state, error, refresh]);
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export const useVault = () => useContext(VaultContext);

/** Metadata for an asset id, falling back to native NEAR while it loads. */
export function metaOf(state: VaultState | null, asset: string): AssetMeta {
  return state?.assets[asset] ?? metaCache.get(asset) ?? NATIVE;
}

/** Proposals that need the owner: vetoed ones not yet dismissed, and pending overrides. */
export function needsDecision(proposals: Proposal[], dismissed: Set<string>): Proposal[] {
  return proposals.filter(
    (p) => p.status === "OverridePending" || (p.status === "Vetoed" && !dismissed.has(p.id)),
  );
}
