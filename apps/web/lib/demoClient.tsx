"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/** One email in the demo agent's inbox. */
export interface DemoScenario {
  id: string;
  title: string;
  from: string;
  subject: string;
  preview: string;
  amount: string;
  payee: string;
  expect: "pass" | "veto";
  /** Set when the payout is in another coin, e.g. ETH on Base Sepolia. */
  symbol?: string;
}

export interface DemoInfo {
  enabled: boolean;
  network: string;
  vault: string;
  agent: { account: string };
  guardian: { account: string; model: string; test_signer: boolean };
  owner: { account: string } | null;
  /** The agent's OutLayer wallet, when the demo has one: it holds each payment for Veto's approval. */
  outlayer: { wallet: string; approver: string } | null;
  /** The vault's own Base Sepolia address (NEAR Chain Signatures), when it has one. */
  evm: { chain: string; address: string; explorer: string; balance: string; funded: boolean } | null;
  scenarios: DemoScenario[];
}

/** Where the demo agent pays from. */
export type PayFrom = "vault" | "outlayer";

export interface DemoRun {
  scenario: string;
  via: PayFrom;
  proposalId?: string;
  tx?: string;
  error?: string;
  startedAt: number;
}

export const OWNER_ACTIONS = [
  "override_veto",
  "cancel_override",
  "execute_override",
  "keep_blocked",
  "freeze",
  "unfreeze",
  "set_mandate",
  "add_payee",
  "remove_payee",
  "set_agent_active",
] as const;

interface DemoContextValue {
  status: "loading" | "ready" | "unavailable";
  info: DemoInfo | null;
  runs: Record<string, DemoRun>;
  payFrom: PayFrom;
  setPayFrom: (via: PayFrom) => void;
  /** Asks the server's demo agent to propose this scenario's payment. */
  run: (scenario: string) => Promise<DemoRun>;
  /** Sends an owner action through the server's testnet demo owner key. */
  owner: (action: string, args: Record<string, unknown>) => Promise<{ tx?: string }>;
  canActAsOwner: (method: string) => boolean;
}

const DemoContext = createContext<DemoContextValue | null>(null);

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `The demo service answered ${res.status}.`);
  return data as T;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DemoContextValue["status"]>("loading");
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [runs, setRuns] = useState<Record<string, DemoRun>>({});
  const [payFrom, setPayFrom] = useState<PayFrom>("vault");

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A busy RPC can fail the first look; try again a few times before giving up.
    const load = (attempt: number) =>
      fetch("/api/demo", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("unavailable");
          return (await res.json()) as DemoInfo;
        })
        .then((data) => {
          if (cancelled) return;
          setInfo(data);
          setStatus(data.enabled ? "ready" : "unavailable");
        })
        .catch(() => {
          if (cancelled) return;
          setStatus("unavailable");
          if (attempt < 4) retry = setTimeout(() => load(attempt + 1), 4000 * 2 ** attempt);
        });
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, []);

  const run = useCallback(async (scenario: string) => {
    const via = payFrom;
    const started: DemoRun = { scenario, via, startedAt: Date.now() };
    setRuns((r) => ({ ...r, [scenario]: started }));
    try {
      const res = await post<{ proposal_id: string; tx: string }>("/api/demo/run", { scenario, via });
      const done = { ...started, proposalId: res.proposal_id, tx: res.tx };
      setRuns((r) => ({ ...r, [scenario]: done }));
      return done;
    } catch (e) {
      const failed = { ...started, error: e instanceof Error ? e.message : "The demo agent could not propose this payment." };
      setRuns((r) => ({ ...r, [scenario]: failed }));
      return failed;
    }
  }, [payFrom]);

  const owner = useCallback((action: string, args: Record<string, unknown>) => post<{ tx?: string }>("/api/demo/owner", { action, args }), []);

  const canActAsOwner = useCallback(
    (method: string) => status === "ready" && !!info?.owner && (OWNER_ACTIONS as readonly string[]).includes(method),
    [status, info],
  );

  const value = useMemo(
    () => ({ status, info, runs, payFrom, setPayFrom, run, owner, canActAsOwner }),
    [status, info, runs, payFrom, run, owner, canActAsOwner],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
