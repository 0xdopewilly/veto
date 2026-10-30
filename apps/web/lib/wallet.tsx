"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK, VAULT_ID } from "./config";
import { useVault } from "./vault";

interface WalletContextValue {
  accountId: string | null;
  ready: boolean;
  isOwner: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Calls a vault method from the connected wallet. */
  callVault: (methodName: string, args: Record<string, unknown>, gasTgas?: number) => Promise<unknown>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const { state } = useVault();
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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

  const connect = useCallback(async () => {
    await connector.current?.connect();
  }, []);

  const disconnect = useCallback(async () => {
    await connector.current?.disconnect();
    setAccountId(null);
  }, []);

  const callVault = useCallback(async (methodName: string, args: Record<string, unknown>, gasTgas = 100) => {
    const instance = connector.current;
    if (!instance) throw new Error("The wallet is still loading. Try again in a moment.");
    const wallet = await instance.wallet();
    return wallet.signAndSendTransaction({
      receiverId: VAULT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: { methodName, args, gas: (BigInt(gasTgas) * 10n ** 12n).toString(), deposit: "0" },
        },
      ],
    });
  }, []);

  const isOwner = !!accountId && accountId === state?.config.owner;
  const value = useMemo(
    () => ({ accountId, ready, isOwner, connect, disconnect, callVault }),
    [accountId, ready, isOwner, connect, disconnect, callVault],
  );
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}

export type TxStatus = "idle" | "pending" | "done" | "error";

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
