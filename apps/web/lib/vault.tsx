"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { JsonRpcProvider } from "near-api-js";
import { VaultReader } from "@veto/core/vault";
import type { Payee, Proposal, VaultConfig } from "@veto/core/proposal";
import { FACTORY_ID, isKnownVault, POLL_MS, RPC_URL, SANDBOX_ID, SANDBOX_NAME } from "./config";
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
  /** The open vault; null for the first client render, before the saved choice is read. */
  vaultId: string | null;
  /** The business name: the sandbox's, or what the owner called their vault. */
  vaultName: string;
  /** The shared demo vault anyone can act on, as opposed to a vault someone owns. */
  isSandbox: boolean;
  reader: VaultReader;
  state: VaultState | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Opens another vault (the sandbox, or one the factory made) and remembers the choice. */
  selectVault: (id: string) => void;
}

const rpc = new JsonRpcProvider({ url: RPC_URL });
const readers = new Map<string, VaultReader>();
function readerFor(id: string): VaultReader {
  let r = readers.get(id);
  if (!r) readers.set(id, (r = new VaultReader(id, rpc)));
  return r;
}

const STORE_KEY = "veto.vault";
const labelKey = (id: string) => `veto.label.${id}`;

/** Remembers which vault to open next time (and its name, so it shows before the chain answers). */
export function rememberVault(id: string, label?: string) {
  try {
    if (id === SANDBOX_ID) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, id);
    if (label) localStorage.setItem(labelKey(id), label);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

/** A `?vault=` link, then the saved choice, then the sandbox. */
function savedVault(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("vault");
    if (fromUrl && isKnownVault(fromUrl)) {
      rememberVault(fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(STORE_KEY);
    if (stored && isKnownVault(stored)) return stored;
  } catch {
    // fall through to the sandbox
  }
  return SANDBOX_ID;
}

function savedLabel(id: string): string | null {
  try {
    return localStorage.getItem(labelKey(id));
  } catch {
    return null;
  }
}

/** A vault the factory made, as it records it. */
export interface FactoryVault {
  owner: string;
  label: string;
  created_at: string;
}

class MissingVault extends Error {}

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

/** Whether a NEAR account exists (for checking a vault name is free). */
export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc.viewAccount({ accountId, blockQuery: { finality: "optimistic" } });
    return true;
  } catch (e) {
    if (/does not exist|doesn't exist|UNKNOWN_ACCOUNT/i.test((e as Error).message)) return false;
    throw e;
  }
}

export async function accessKeys(accountId: string) {
  return rpc.viewAccessKeyList({ accountId, finalityQuery: { finality: "optimistic" } });
}

/** Reads the shared server snapshot; falls back to reading the chain directly. */
async function load(vaultId: string): Promise<VaultState> {
  try {
    const res = await fetch(`/api/state?vault=${encodeURIComponent(vaultId)}`, { cache: "no-store" });
    if (res.status === 404) throw new MissingVault("That vault doesn't exist.");
    if (res.ok) {
      const data = await res.json();
      data.balances = Object.fromEntries(Object.entries(data.balances as Record<string, string>).map(([k, v]) => [k, BigInt(v)]));
      for (const [id, meta] of Object.entries(data.assets as Record<string, AssetMeta>)) metaCache.set(id, meta);
      return data as VaultState;
    }
  } catch (e) {
    if (e instanceof MissingVault) throw e;
    // fall through to a direct read
  }
  return loadDirect(vaultId);
}

async function loadDirect(vaultId: string): Promise<VaultState> {
  const reader = readerFor(vaultId);
  const [config, proposals, payees, agents, wallets, policies, pending, account] = await Promise.all([
    reader.config(),
    reader.proposals(0, 100),
    reader.payees(),
    reader.view<[string, AgentInfo][]>("get_agents"),
    // Vaults deployed before external wallets existed don't have this view.
    reader.view<[string, WalletInfo][]>("get_wallets").catch(() => []),
    reader.view<[string, AssetPolicy][]>("get_policies"),
    reader.view<[string, PendingPolicy][]>("get_pending_policies"),
    rpc.viewAccount({ accountId: vaultId }),
  ]);

  // EVM-chain assets ("<chain>:<coin>") need the server's snapshot; the direct read skips them.
  const assetIds = [...new Set(["near", ...policies.map(([asset]) => asset)])].filter((id) => !id.includes(":"));
  const metas = await Promise.all(assetIds.map(assetMeta));
  const assets = Object.fromEntries(assetIds.map((id, i) => [id, metas[i]]));

  // Native balance net of the NEAR locked for contract storage (1 NEAR per 100 KB).
  const spendableNear = account.amount - BigInt(account.storage_usage) * 10n ** 19n;
  const tokenIds = assetIds.filter((id) => id !== "near");
  const tokenBalances = await Promise.all(
    tokenIds.map((id) => view<string>(id, "ft_balance_of", { account_id: vaultId }).then(BigInt)),
  );
  const balances: Record<string, bigint> = { near: spendableNear > 0n ? spendableNear : 0n };
  tokenIds.forEach((id, i) => (balances[id] = tokenBalances[i]));

  const spendList = await Promise.all(policies.map(([asset]) => reader.view<SpendStatus>("get_spend", { asset })));
  const spend = Object.fromEntries(spendList.map((s) => [s.asset, s]));

  const primaryAsset = tokenIds[0] ?? "near";
  return { config, proposals, payees, agents, wallets, policies, pending, spend, assets, balances, primaryAsset };
}

const VaultContext = createContext<VaultContextValue>({
  vaultId: null,
  vaultName: SANDBOX_NAME,
  isSandbox: true,
  reader: readerFor(SANDBOX_ID),
  state: null,
  error: null,
  refresh: async () => {},
  selectVault: () => {},
});

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

/** `idle`: knows which vault is open but doesn't poll it (onboarding needs only the wallet). */
export function VaultProvider({ children, idle = false }: { children: ReactNode; idle?: boolean }) {
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [state, setState] = useState<VaultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The vault a read belongs to: a slow answer for a vault the visitor already left is dropped.
  const current = useRef<string | null>(null);
  const busy = useRef<string | null>(null);

  const selectVault = useCallback((id: string) => {
    if (!isKnownVault(id) || id === current.current) return;
    rememberVault(id);
    current.current = id;
    setState(null);
    setError(null);
    setLabel(id === SANDBOX_ID ? null : savedLabel(id));
    setVaultId(id);
  }, []);

  const refresh = useCallback(async () => {
    const id = current.current;
    if (!id || busy.current === id) return;
    busy.current = id;
    try {
      const next = await load(id);
      if (current.current !== id) return;
      setState((prev) => reconcile(prev, next));
      setError(null);
    } catch (e) {
      if (current.current !== id) return;
      // A link to a vault that doesn't exist (or no longer does) opens the sandbox instead.
      if (e instanceof MissingVault && id !== SANDBOX_ID) return selectVault(SANDBOX_ID);
      setError(e instanceof Error ? e.message : "Could not reach the vault");
    } finally {
      if (busy.current === id) busy.current = null;
    }
  }, [selectVault]);

  useEffect(() => selectVault(savedVault()), [selectVault]);

  useEffect(() => {
    if (!vaultId || idle) return;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [vaultId, idle, refresh]);

  // The owner's name for their vault lives on the factory.
  useEffect(() => {
    if (!vaultId || vaultId === SANDBOX_ID || !FACTORY_ID) return;
    let cancelled = false;
    view<FactoryVault | null>(FACTORY_ID, "get_vault", { vault: vaultId })
      .then((v) => {
        if (cancelled || !v) return;
        setLabel(v.label);
        rememberVault(vaultId, v.label);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [vaultId]);

  const isSandbox = !vaultId || vaultId === SANDBOX_ID;
  const vaultName = isSandbox ? SANDBOX_NAME : (label ?? "Your vault");
  const reader = readerFor(vaultId ?? SANDBOX_ID);
  const value = useMemo(
    () => ({ vaultId, vaultName, isSandbox, reader, state, error, refresh, selectVault }),
    [vaultId, vaultName, isSandbox, reader, state, error, refresh, selectVault],
  );
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
