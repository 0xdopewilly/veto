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
}

export interface DemoInfo {
  enabled: boolean;
  network: string;
  vault: string;
  agent: { account: string };
  guardian: { account: string; model: string; test_signer: boolean };
  owner: { account: string } | null;
  scenarios: DemoScenario[];
}

export interface DemoRun {
  scenario: string;
  proposalId?: string;
  tx?: string;
  error?: string;
  startedAt: number;
}

export const OWNER_ACTIONS = [
  "override_veto",
  "cancel_override",
  "execute_override",
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
    const started: DemoRun = { scenario, startedAt: Date.now() };
    setRuns((r) => ({ ...r, [scenario]: started }));
    try {
      const res = await post<{ proposal_id: string; tx: string }>("/api/demo/run", { scenario });
      const done = { ...started, proposalId: res.proposal_id, tx: res.tx };
      setRuns((r) => ({ ...r, [scenario]: done }));
      return done;
    } catch (e) {
      const failed = { ...started, error: e instanceof Error ? e.message : "The demo agent could not propose this payment." };
      setRuns((r) => ({ ...r, [scenario]: failed }));
      return failed;
    }
  }, []);

  const owner = useCallback((action: string, args: Record<string, unknown>) => post<{ tx?: string }>("/api/demo/owner", { action, args }), []);

  const canActAsOwner = useCallback(
    (method: string) => status === "ready" && !!info?.owner && (OWNER_ACTIONS as readonly string[]).includes(method),
    [status, info],
  );

  const value = useMemo(() => ({ status, info, runs, run, owner, canActAsOwner }), [status, info, runs, run, owner, canActAsOwner]);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
