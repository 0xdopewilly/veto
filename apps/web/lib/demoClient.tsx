"use client";

import { markTried } from "./hint";
import { useVault } from "./vault";
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
  /** How the email reads on the Agent API path when that differs: a USDC salary paid out on Base through NEAR Intents. */
  agentapi?: { subject: string; preview: string; amount: string; payee: string; chain: string; payee_label?: string };
}

export interface DemoInfo {
  enabled: boolean;
  network: string;
  vault: string;
  /** The shared sandbox, with a demo owner key; false for a vault someone owns. */
  sandbox: boolean;
  agent: { account: string };
  guardian: { account: string; model: string; test_signer: boolean };
  /** Whether NEAR AI Cloud, where the agent and the screening both run, answers right now. */
  nearai?: "up" | "down" | "unknown";
  owner: { account: string } | null;
  /** The agent's OutLayer wallet, when the demo has one: it holds each payment for Veto's approval. */
  outlayer: { wallet: string; approver: string } | null;
  /** A NEAR Intents Agent API wallet on mainnet whose only grant Veto holds; amounts are scaled down by `scale`. */
  agentapi?: { agent_id: string; scale: number } | null;
  /** The vault's own Base Sepolia address (NEAR Chain Signatures), when it has one. */
  evm: { chain: string; address: string; explorer: string; balance: string; funded: boolean } | null;
  scenarios: DemoScenario[];
}

/** Where the demo agent pays from. */
export type PayFrom = "vault" | "outlayer" | "agentapi";

/** What happened to a payment the agent asked its Agent API wallet to make (see lib/server/agentapi). */
export interface AgentApiOutcome {
  id: string;
  /** `chain` is "near" for a transfer inside NEAR Intents, or the chain a withdrawal pays out on. */
  request: { payee: string; payee_name: string | null; amount: string; asset: string; chain: string };
  verdict: { verdict: "PASS" | "VETO"; reasons: string[]; model: string; signer: string; approved_signer: boolean; ms: number };
  execution:
    | { kind: "skipped" }
    | { kind: "refused"; code: string; layer: string | null; message: string }
    | { kind: "sent"; correlation_id: string; status: string; failure_code: string | null; tx_hash: string | null };
}

export interface DemoRun {
  scenario: string;
  via: PayFrom;
  proposalId?: string;
  tx?: string;
  /** Set when the Agent API path finished: it doesn't create a vault proposal. */
  agentapi?: AgentApiOutcome;
  error?: string;
  startedAt: number;
}

export const OWNER_ACTIONS = [
  "override_veto",
  "override_and_save",
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
  /** "off": this copy of the app has no demo agent set up (no `pnpm demo:setup`); "unavailable": it didn't answer. */
  status: "loading" | "ready" | "off" | "unavailable";
  info: DemoInfo | null;
  runs: Record<string, DemoRun>;
  payFrom: PayFrom;
  setPayFrom: (via: PayFrom) => void;
  /** Asks the server's demo agent to propose this scenario's payment. */
  run: (scenario: string) => Promise<DemoRun>;
  /** Emails the visitor wrote to the agent, newest first; each becomes a card like the examples. */
  composed: DemoScenario[];
  /** Sends the agent an email; a real model reads it and proposes what it asks for. */
  compose: (email: { from: string; subject: string; body: string }) => Promise<DemoRun>;
  /** Sends an owner action through the server's testnet demo owner key. */
  owner: (action: string, args: Record<string, unknown>) => Promise<{ tx?: string }>;
  canActAsOwner: (method: string) => boolean;
}

const DemoContext = createContext<DemoContextValue | null>(null);

// The shared sandbox goes back to its default rules (unfrozen, the usual mandate and suppliers) for a
// visitor who hasn't used it in half an hour, so one visitor's changes don't greet the next.
const VISIT_KEY = "veto.sandbox.lastSeen";
const VISIT_MS = 30 * 60_000;
function touchVisit() {
  try {
    localStorage.setItem(VISIT_KEY, String(Date.now()));
  } catch {
    // no storage: every visit starts from the defaults
  }
}
function startVisit() {
  let last = 0;
  try {
    last = Number(localStorage.getItem(VISIT_KEY)) || 0;
  } catch {
    // treated as a new visitor
  }
  touchVisit();
  if (Date.now() - last >= VISIT_MS) fetch("/api/demo/reset", { method: "POST" }).catch(() => {});
}

async function post<T>(url: string, body: unknown): Promise<T> {
  touchVisit();
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `The demo service answered ${res.status}.`);
  return data as T;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const { vaultId } = useVault();
  const [status, setStatus] = useState<DemoContextValue["status"]>("loading");
  const [info, setInfo] = useState<DemoInfo | null>(null);
  const [runs, setRuns] = useState<Record<string, DemoRun>>({});
  const [payFrom, setPayFrom] = useState<PayFrom>("vault");
  const [composed, setComposed] = useState<DemoScenario[]>([]);

  useEffect(() => {
    if (!vaultId) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Another vault: its own agent inbox, from scratch.
    setStatus("loading");
    setInfo(null);
    setRuns({});
    setComposed([]);
    setPayFrom("vault");
    // A busy RPC can fail the first look; try again a few times before giving up.
    const load = (attempt: number) =>
      fetch(`/api/demo?vault=${encodeURIComponent(vaultId)}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error("unavailable");
          return (await res.json()) as DemoInfo;
        })
        .then((data) => {
          if (cancelled) return;
          // A copy without a demo agent answers just { enabled: false }: nothing else in it is there.
          setInfo(data.enabled ? data : null);
          setStatus(data.enabled ? "ready" : "off");
          if (data.enabled && data.sandbox && data.owner) startVisit();
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
  }, [vaultId]);

  const run = useCallback(async (scenario: string) => {
    markTried();
    const via = payFrom;
    const started: DemoRun = { scenario, via, startedAt: Date.now() };
    setRuns((r) => ({ ...r, [scenario]: started }));
    try {
      const res = await post<{ proposal_id?: string; tx?: string; agentapi?: AgentApiOutcome }>("/api/demo/run", { scenario, via, vault: vaultId });
      const done = { ...started, proposalId: res.proposal_id, tx: res.tx, agentapi: res.agentapi };
      setRuns((r) => ({ ...r, [scenario]: done }));
      return done;
    } catch (e) {
      const failed = { ...started, error: e instanceof Error ? e.message : "The demo agent could not propose this payment." };
      setRuns((r) => ({ ...r, [scenario]: failed }));
      return failed;
    }
  }, [payFrom, vaultId]);

  const compose = useCallback(
    async (email: { from: string; subject: string; body: string }) => {
      markTried();
      const id = `mail-${Date.now()}`;
      const via = payFrom;
      const card: DemoScenario = { id, title: "Your email", from: email.from, subject: email.subject || "(no subject)", preview: email.body.slice(0, 160), amount: "…", payee: "the agent is reading it", expect: "pass" };
      const started: DemoRun = { scenario: id, via, startedAt: Date.now() };
      setComposed((c) => [card, ...c]);
      setRuns((r) => ({ ...r, [id]: started }));
      try {
        const res = await post<{ proposal_id?: string; tx?: string; agentapi?: AgentApiOutcome; agent: { payee: string; amount: string; currency: string } }>("/api/demo/compose", { ...email, via, vault: vaultId });
        setComposed((c) => c.map((x) => (x.id === id ? { ...x, amount: res.agent.amount, payee: res.agent.payee, symbol: res.agent.currency === "ETH" ? "ETH" : undefined } : x)));
        const done = { ...started, proposalId: res.proposal_id, tx: res.tx, agentapi: res.agentapi };
        setRuns((r) => ({ ...r, [id]: done }));
        return done;
      } catch (e) {
        setComposed((c) => c.map((x) => (x.id === id ? { ...x, amount: "", payee: "nothing proposed" } : x)));
        const failed = { ...started, error: e instanceof Error ? e.message : "The agent could not read this email." };
        setRuns((r) => ({ ...r, [id]: failed }));
        return failed;
      }
    },
    [payFrom, vaultId],
  );

  const owner = useCallback((action: string, args: Record<string, unknown>) => post<{ tx?: string }>("/api/demo/owner", { action, args, vault: vaultId }), [vaultId]);

  // Only on the sandbox: a vault someone owns takes owner actions from its owner's wallet alone.
  const canActAsOwner = useCallback(
    (method: string) => status === "ready" && !!info?.sandbox && info.vault === vaultId && !!info.owner && (OWNER_ACTIONS as readonly string[]).includes(method),
    [status, info, vaultId],
  );

  const value = useMemo(
    () => ({ status, info, runs, payFrom, setPayFrom, run, composed, compose, owner, canActAsOwner }),
    [status, info, runs, payFrom, run, composed, compose, owner, canActAsOwner],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoContextValue {
  const value = useContext(DemoContext);
  if (!value) throw new Error("useDemo must be used inside DemoProvider");
  return value;
}
