// Drives the hosted testnet demo the way its browser app does: POST /api/demo/compose has the demo
// agent read an email and propose the payment, then GET /api/state is polled until the vault
// decides. Reading /api/state also lets the app finish what the browser's polling finishes (an
// overdue screening expires, a stalled payout is sent), so a decision here ends the same way.
import type { Payee, Proposal, VaultConfig } from "@veto/core/proposal";
import { DECIDED, EXPLORER, type AssetMeta, type AssetPolicy, type Links, type SpendStatus } from "./describe.ts";

export const SANDBOX_URL = "https://veto-beta.vercel.app";
export const SANDBOX_VAULT = "treasury.veto-rhwe0krb.testnet";
/** The public store where the sandbox publishes each verdict's exact bytes (apps/web/lib/server/proofs.ts). */
export const PROOF_BASE = "https://axon0nurb8ormdne.public.blob.vercel-storage.com";
/** Public NEAR testnet RPCs, for a payment older than the newest 100 the app's state holds. */
const PUBLIC_RPCS = ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"];
/** The browser's poll interval (apps/web/lib/config.ts POLL_MS); the app's snapshot refreshes no faster. */
const POLL_MS = 3000;
/** The browser resets the shared sandbox's rules for a visitor who hasn't been back in this long. */
const VISIT_MS = 30 * 60_000;

export interface Email {
  from: string;
  subject: string;
  body: string;
}

/** What the demo agent understood from the email. */
export interface AgentReading {
  payee: string;
  amount: string;
  currency: string;
  reference: string | null;
}

export type ComposeOutcome =
  | { kind: "proposed"; id: string; tx: string; agent: AgentReading }
  /** The vault contract refused the proposal before any screening (caps, frozen, a malformed payee). */
  | { kind: "refused"; message: string }
  /** The agent read the email and proposed nothing (no payment asked for, no amount, an address it can't pay). */
  | { kind: "not_proposed"; message: string }
  | { kind: "error"; status: number; message: string };

export interface SandboxState {
  config: VaultConfig;
  proposals: Proposal[];
  payees: Payee[];
  policies: [string, AssetPolicy][];
  pending: [string, { policy: AssetPolicy; effective_at: string }][];
  spend: Record<string, SpendStatus>;
  assets: Record<string, AssetMeta>;
}

export interface DemoScenario {
  id: string;
  title: string;
  from: string;
  subject: string;
  preview: string;
  amount: string;
  payee: string;
  expect: "pass" | "veto";
  symbol?: string;
  chain?: string;
}

export interface DemoInfo {
  enabled: boolean;
  vault: string;
  agent: { account: string };
  guardian: { account: string; model: string; test_signer: boolean };
  nearai?: "up" | "down" | "unknown";
  scenarios: DemoScenario[];
}

export interface SandboxOptions {
  baseUrl?: string;
  vaultId?: string;
  proofBase?: string;
  rpcs?: string[];
  fetch?: typeof fetch;
  pollMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Waits `ms`, or rejects as soon as `signal` aborts (the client cancelled the tool call). */
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class Sandbox {
  readonly baseUrl: string;
  readonly vaultId: string;
  readonly #proofBase: string;
  readonly #rpcs: string[];
  readonly #fetch: typeof fetch;
  readonly #pollMs: number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  #lastReset = Number.NEGATIVE_INFINITY;

  constructor(opts: SandboxOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? SANDBOX_URL).replace(/\/+$/, "");
    this.vaultId = opts.vaultId ?? SANDBOX_VAULT;
    this.#proofBase = opts.proofBase ?? PROOF_BASE;
    this.#rpcs = opts.rpcs ?? PUBLIC_RPCS;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#pollMs = opts.pollMs ?? POLL_MS;
    this.#sleep = opts.sleep ?? sleep;
    this.#now = opts.now ?? Date.now;
  }

  async #json<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<{ status: number; ok: boolean; body: T & { error?: string } }> {
    const { timeoutMs = 30_000, signal, ...rest } = init ?? {};
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await this.#fetch(`${this.baseUrl}${path}`, {
      ...rest,
      headers: { Accept: "application/json", ...(rest.body ? { "Content-Type": "application/json" } : {}) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    let body: T & { error?: string };
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: `The hosted demo answered ${res.status} without JSON.` } as T & { error?: string };
    }
    return { status: res.status, ok: res.ok, body };
  }

  /** The demo's inbox examples and who screens: GET /api/demo. */
  async info(): Promise<DemoInfo> {
    const { ok, status, body } = await this.#json<DemoInfo>(`/api/demo?vault=${encodeURIComponent(this.vaultId)}`);
    if (!ok) throw new Error(body.error ?? `The hosted demo answered ${status}.`);
    if (!body.enabled) throw new Error("The hosted demo has no demo agent configured.");
    return body;
  }

  /** The vault as the app shows it: GET /api/state (the newest 100 payments, caps, payees). */
  async state(signal?: AbortSignal): Promise<SandboxState> {
    const { ok, status, body } = await this.#json<SandboxState>(`/api/state?vault=${encodeURIComponent(this.vaultId)}`, { signal });
    if (!ok) throw new Error(body.error ?? `The hosted demo answered ${status}.`);
    return body;
  }

  /**
   * What the browser does for a visitor who hasn't been back in half an hour: puts the shared
   * sandbox's owner settings back to their defaults (unfrozen, the usual mandate and suppliers).
   * The app skips it while someone is acting as the owner. Best effort.
   */
  async resetIfNewVisit(): Promise<void> {
    if (this.#now() - this.#lastReset < VISIT_MS) return;
    this.#lastReset = this.#now();
    await this.#json("/api/demo/reset", { method: "POST", body: "{}", timeoutMs: 20_000 }).catch(() => {});
  }

  /** POST /api/demo/compose: the hosted agent reads the email and proposes what it asks for. */
  async compose(email: Email): Promise<ComposeOutcome> {
    const { ok, status, body } = await this.#json<{ proposal_id?: string; tx?: string; agent?: AgentReading }>("/api/demo/compose", {
      method: "POST",
      body: JSON.stringify({ ...email, vault: this.vaultId }),
      // The route may take up to two minutes (its maxDuration) when NEAR AI or the RPC is slow.
      timeoutMs: 130_000,
    });
    if (ok && body.proposal_id && body.tx && body.agent) return { kind: "proposed", id: body.proposal_id, tx: body.tx, agent: body.agent };
    const message = body.error ?? `The hosted demo answered ${status}.`;
    if (status === 422) return message.startsWith("The vault refused it") ? { kind: "refused", message } : { kind: "not_proposed", message };
    return { kind: "error", status, message: ok ? "The hosted demo answered without a proposal id." : message };
  }

  /** One payment and the vault's assets and payees: from the app's state, or straight from the chain if it's older. */
  async proposal(id: string, signal?: AbortSignal): Promise<{ proposal: Proposal | null; state: SandboxState }> {
    const state = await this.state(signal);
    const listed = state.proposals.find((p) => p.id === id);
    if (listed) return { proposal: listed, state };
    return { proposal: await this.#view<Proposal | null>(this.vaultId, "get_proposal", { id }), state };
  }

  /** Polls until the vault decides or `timeoutMs` passes; `onPoll` hears each status seen. */
  async wait(id: string, timeoutMs: number, opts: { signal?: AbortSignal; onPoll?: (p: Proposal | null) => void } = {}) {
    const until = this.#now() + timeoutMs;
    for (;;) {
      const { proposal, state }: { proposal?: Proposal | null; state?: SandboxState } = await this.proposal(id, opts.signal).catch((e) => {
        // A busy moment at the app or the RPC: try again on the next poll unless time is up.
        if (opts.signal?.aborted || this.#now() >= until) throw e;
        return {};
      });
      if (proposal !== undefined) opts.onPoll?.(proposal);
      if (proposal && state && DECIDED.includes(proposal.status)) return { proposal, state, decided: true };
      if (this.#now() >= until) {
        if (proposal === undefined || !state) {
          const last = await this.proposal(id, opts.signal);
          return { ...last, decided: false };
        }
        return { proposal, state, decided: false };
      }
      await this.#sleep(this.#pollMs, opts.signal);
    }
  }

  /** The submit_verdict transaction, from the decision's published proof. Published moments after the verdict lands. */
  async verdictTx(id: string, attempts = 1, signal?: AbortSignal): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await this.#sleep(2000, signal);
      try {
        const res = await this.#fetch(`${this.#proofBase}/proofs/${this.vaultId}/${id}/meta.json`, { signal: signal ?? AbortSignal.timeout(10_000) });
        if (res.ok) {
          const meta = (await res.json()) as { tx?: string };
          if (typeof meta.tx === "string" && meta.tx) return meta.tx;
        }
      } catch {
        // missing or unreachable: the Proof page still has the rest
      }
    }
    return null;
  }

  links(id: string, opts: { proposalTx?: string; verdictTx?: string | null; payoutTx?: string | null } = {}): Links {
    const q = `?vault=${encodeURIComponent(this.vaultId)}`;
    return {
      ...(opts.proposalTx && { proposal_tx: `${EXPLORER.testnet}/txns/${opts.proposalTx}` }),
      ...(opts.verdictTx && { verdict_tx: `${EXPLORER.testnet}/txns/${opts.verdictTx}` }),
      ...(opts.payoutTx && { payout_tx: opts.payoutTx }),
      decision_page: `${this.baseUrl}/app/decisions/${id}${q}`,
      proof_page: `${this.baseUrl}/app/decisions/${id}/proof${q}`,
    };
  }

  /** A view call to a public NEAR RPC, trying the next one if it fails. */
  async #view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
    let last = "no RPC answered";
    for (const url of this.#rpcs) {
      try {
        const res = await this.#fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "veto-mcp",
            method: "query",
            params: { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json()) as { result?: { result: number[] }; error?: { message?: string; cause?: { name?: string } } };
        if (body.result) return JSON.parse(Buffer.from(body.result.result).toString()) as T;
        last = body.error?.cause?.name ?? body.error?.message ?? String(res.status);
      } catch (e) {
        last = (e as Error).message;
      }
    }
    throw new Error(`NEAR's RPC: ${last}`);
  }
}
