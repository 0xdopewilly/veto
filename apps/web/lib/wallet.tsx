"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "./config";
import { nearBalance, useVault } from "./vault";

/**
 * Test NEAR for the connected wallet's gas. New testnet wallets often start empty, so on connect
 * an empty wallet is sent 0.3 test NEAR once (see /api/gas) before it has to sign anything.
 */
export type GasStatus =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; amount: string }
  | { state: "ok" }
  | { state: "failed"; reason: string };

/** Below this a wallet can't reserve the gas for creating a vault (see /api/gas). */
const GAS_LOW = 160_000_000_000_000_000_000_000n; // 0.16 NEAR

/** What a wallet's error means, in words; wallets wrap the chain's reason in their own codes. */
export function walletMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (/not enough balance|NotEnoughBalance|insufficient/i.test(raw)) return "Your wallet doesn't have enough test NEAR to pay the gas.";
  if (/reject|cancel|denied|closed/i.test(raw)) return "You closed the wallet before signing. Nothing was sent.";
  const reason = raw.replace(/^.*?during casting:\s*/i, "").replace(/^.*Smart contract panicked: /, "").trim();
  return reason || "The wallet didn't send the transaction.";
}

interface WalletContextValue {
  accountId: string | null;
  ready: boolean;
  isOwner: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Calls a method on the open vault from the connected wallet. */
  callVault: (methodName: string, args: Record<string, unknown>, gasTgas?: number) => Promise<unknown>;
  /** Calls a method on any contract from the connected wallet (e.g. the factory). */
  callContract: (receiverId: string, methodName: string, args: Record<string, unknown>, gasTgas?: number) => Promise<unknown>;
  /** Whether the connected wallet has test NEAR for gas, or is being sent some. */
  gas: GasStatus;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { state, vaultId } = useVault();
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [gas, setGas] = useState<GasStatus>({ state: "idle" });

  useEffect(() => {
    let cancelled = false;
    let instance: NearConnector | null = null;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      instance = new NearConnector({
        network: NETWORK,
        features: NETWORK === "testnet" ? { signAndSendTransaction: true, testnet: true } : { signAndSendTransaction: true },
        footerBranding: null,
        autoConnect: true,
      });
      connector.current = instance;
      instance.on("wallet:signIn", (event) => setAccountId(event.accounts[0]?.accountId ?? null));
      instance.on("wallet:signOut", () => setAccountId(null));
      try {
        const { accounts } = await instance.getConnectedWallet();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // No wallet connected yet.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
      instance?.removeAllListeners();
    };
  }, []);

  // An empty testnet wallet gets test NEAR for gas as soon as it connects, before any signing.
  useEffect(() => {
    setGas({ state: "idle" });
    if (!accountId || NETWORK !== "testnet") return;
    let cancelled = false;
    (async () => {
      const balance = await nearBalance(accountId).catch(() => null);
      if (cancelled) return;
      if (balance === null || balance >= GAS_LOW) return setGas({ state: "ok" });
      setGas({ state: "sending" });
      const res = await fetch("/api/gas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) }).catch(() => null);
      const body = ((await res?.json().catch(() => null)) ?? {}) as { sent?: boolean; enough?: boolean; amount?: string; error?: string };
      if (cancelled) return;
      if (body.enough) return setGas({ state: "ok" });
      if (!res?.ok || !body.sent) return setGas({ state: "failed", reason: body.error ?? "Couldn't send your wallet test NEAR for gas." });
      // Wait until the wallet can see it, so its own balance check passes.
      for (let i = 0; i < 15 && !cancelled; i++) {
        if (((await nearBalance(accountId).catch(() => 0n)) ?? 0n) >= GAS_LOW) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!cancelled) setGas({ state: "sent", amount: body.amount ?? "0.3" });
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const connect = useCallback(async () => {
    await connector.current?.connect();
  }, []);

  const disconnect = useCallback(async () => {
    await connector.current?.disconnect();
    setAccountId(null);
  }, []);

  const callContract = useCallback(async (receiverId: string, methodName: string, args: Record<string, unknown>, gasTgas = 100) => {
    const instance = connector.current;
    if (!instance) throw new Error("The wallet is still loading. Try again in a moment.");
    const wallet = await instance.wallet();
    try {
      return await wallet.signAndSendTransaction({
        receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: { methodName, args, gas: (BigInt(gasTgas) * 10n ** 12n).toString(), deposit: "0" },
          },
        ],
      });
    } catch (e) {
      throw new Error(walletMessage(e));
    }
  }, []);

  const callVault = useCallback(
    async (methodName: string, args: Record<string, unknown>, gasTgas = 100) => {
      if (!vaultId) throw new Error("The vault is still loading. Try again in a moment.");
      return callContract(vaultId, methodName, args, gasTgas);
    },
    [vaultId, callContract],
  );

  const isOwner = !!accountId && accountId === state?.config.owner;
  const value = useMemo(
    () => ({ accountId, ready, isOwner, connect, disconnect, callVault, callContract, gas }),
    [accountId, ready, isOwner, connect, disconnect, callVault, callContract, gas],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}

export type TxStatus = "idle" | "pending" | "done" | "error";

/** The transaction hash from whatever the wallet returned. */
export function txHashOf(result: unknown): string | undefined {
  const r = result as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } } | undefined;
  return r?.transaction?.hash ?? r?.transaction_outcome?.id;
}

/**
 * Runs one vault transaction at a time and tracks its state for the button that sent it.
 * Refreshes vault data when the transaction lands.
 */
export function useTx() {
  const { callVault } = useWallet();
  const { refresh } = useVault();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    async (methodName: string, args: Record<string, unknown> = {}, success = "Done") => {
      setStatus("pending");
      setMessage(null);
      try {
        await callVault(methodName, args);
        setStatus("done");
        setMessage(success);
        await refresh();
        return true;
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "The transaction did not go through.");
        return false;
      }
    },
    [callVault, refresh],
  );

  return { status, message, run, reset: () => setStatus("idle") };
}

/** How to name the open vault for whoever is looking: the sandbox, theirs, or someone else's. */
export function useVaultKind(): { label: string; mine: boolean } {
  const { isSandbox } = useVault();
  const { isOwner } = useWallet();
  if (isSandbox) return { label: "Shared sandbox", mine: false };
  return isOwner ? { label: "Your vault", mine: true } : { label: "Owned vault", mine: true };
}
