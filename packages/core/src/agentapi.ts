// NEAR Intents Agent API (api.agentsonintents.com): agent wallets on NEAR Intents that move money
// only inside an owner-signed policy. A partner backend holds the API key; each actor that may
// spend holds a grant token. Veto is that actor: it holds the agent's only grant, so the AI agent
// can't move money itself. The agent asks, Veto screens, and only a pass becomes a transfer.
//
// Plain HTTP (no SDK), following the API's skill: https://github.com/NEAR-Intents-Agent-API/skills
import { createHash, randomBytes } from "node:crypto";
import { SigningKey, TypedDataEncoder, Wallet, type TypedDataField } from "ethers";

export type OperationStatus =
  | "PENDING_SIGNATURE"
  | "QUEUED"
  | "PENDING_APPROVAL"
  | "PENDING_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED"
  | "UNCERTAIN"
  | "NEEDS_REVIEW";

export interface StatusResponse {
  correlation_id: string;
  agent_id: string | null;
  type: string;
  status: OperationStatus;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  dispatch_committed_at: string | null;
  grant: { id: string; label: string } | null;
  details: Record<string, unknown> & { tx_hash?: string; agent_id?: string; grant?: { grant_id: string } | null };
}

export interface EvmOwner {
  type: "evm";
  address: string;
  chain_id: number;
  public_key: string;
}

/** A payout target the policy may allow: a NEAR Intents account, or an address on another chain. */
export type Destination =
  | { action: "transfer"; address: string; confidential: boolean }
  | { action: "withdraw"; chain: string; address: string; memo: string | null };

export interface AgentPolicy {
  frozen: boolean;
  actions: ("swap" | "transfer" | "withdraw")[];
  confidential: boolean;
  owner_approval: boolean;
  assets: "any" | string[];
  limits: Partial<Record<"per_transaction" | "hourly" | "daily" | "monthly", Record<string, string>>>;
  max_actions_per_hour: number | null;
  destinations: { mode: "any" | "only" | "except"; list: Destination[] };
  budget: { daily_usd: string | null; weekly_usd: string | null; monthly_usd: string | null } | null;
  timelock_ms: number;
}

export interface GeneratedIntent {
  correlation_id: string;
  type: string;
  agent_id: string | null;
  expires_at: string;
  intent: { standard: "nep413" | "nep366" | "eip712" | "webauthn"; payload: unknown };
  preview: { summary: string } & Record<string, unknown>;
}

export class AgentApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Whose rule refused: request, auth, grant, policy, budget, balance, provider or api. */
  readonly layer: string | undefined;
  readonly meta?: Record<string, unknown>;

  constructor(status: number, code: string, layer: string | undefined, message: string, meta?: Record<string, unknown>) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.code = code;
    this.layer = layer;
    this.meta = meta;
  }
}

/** Statuses that are still moving; anything else is settled or needs a person. */
const MOVING = new Set<OperationStatus>(["PROCESSING", "QUEUED"]);

export class AgentApi {
  readonly baseUrl: string;
  readonly #apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.#apiKey = apiKey;
  }

  async request<T>(method: string, path: string, opts: { body?: unknown; grant?: string; idempotencyKey?: string; timeoutMs?: number } = {}): Promise<T> {
    const headers: Record<string, string> = { "X-API-Key": this.#apiKey, Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.grant) headers["X-Grant-Token"] = opts.grant;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 65_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const err = (json.errors as { code?: string; layer?: string; title?: string; detail?: string; meta?: Record<string, unknown> }[] | undefined)?.[0];
      throw new AgentApiError(res.status, err?.code ?? `http_${res.status}`, err?.layer, err?.detail ?? err?.title ?? `Agent API answered ${res.status}`, err?.meta);
    }
    return json as T;
  }

  network() {
    return this.request<{ network: string; contract_id: string; supported_owner_types: string[]; status: { overall: string } }>("GET", "/v1/network");
  }

  tokens() {
    return this.request<{ data: { asset_id: string; symbol: string; decimals: number; blockchain: string; price: number | null }[] }>("GET", "/v1/tokens");
  }

  agent(agentId: string) {
    return this.request<{ id: string; name: string; status: string; owner: EvmOwner | null; wallet: { wallet_id: string; near_account_id: string } | null }>("GET", `/v1/agents/${agentId}`);
  }

  policy(agentId: string) {
    return this.request<{ revision: number | null; status: string; provider_policy_synced: boolean; policy: AgentPolicy | null; usage: Record<string, unknown> }>("GET", `/v1/agents/${agentId}/policy`);
  }

  balances(agentId: string) {
    return this.request<{ near_account_id: string; balances: { asset_id: string; symbol: string; decimals: number; balance_raw: string; available_raw: string }[] }>(
      "GET",
      `/v1/agents/${agentId}/balances?source=public`,
    );
  }

  generateIntent(body: Record<string, unknown>, idempotencyKey?: string) {
    return this.request<GeneratedIntent>("POST", "/v1/generate-intent", { body, idempotencyKey });
  }

  submitIntent(type: string, correlationId: string, signedData: unknown) {
    return this.request<StatusResponse>("POST", "/v1/submit-intent", { body: { type, correlation_id: correlationId, signed_data: signedData } });
  }

  status(correlationId: string, waitMs = 0) {
    return this.request<StatusResponse>("GET", `/v1/status?correlation_id=${encodeURIComponent(correlationId)}&wait_ms=${waitMs}`, { timeoutMs: waitMs + 35_000 });
  }

  /** Long-polls until the operation stops moving (settled, or waiting on a person or a deposit). */
  async settle(correlationId: string, deadlineMs = 150_000): Promise<StatusResponse> {
    const until = Date.now() + deadlineMs;
    for (;;) {
      const s = await this.status(correlationId, 25_000);
      if (!MOVING.has(s.status) || Date.now() > until) return s;
    }
  }

  /** A transfer to another NEAR Intents account. The key makes a retry return the same operation. */
  transfer(agentId: string, grant: string, body: { asset: string; amount: string; recipient: string }, idempotencyKey: string) {
    return this.request<StatusResponse>("POST", `/v1/agents/${agentId}/transfer`, { body, grant, idempotencyKey, timeoutMs: 150_000 });
  }

  /** A withdrawal off NEAR Intents; `dry: true` previews it with the live request's would-be refusals as warnings. */
  withdraw(
    agentId: string,
    grant: string,
    body: { asset: string; amount: string; chain: string; recipient: string; memo?: string; dry?: boolean },
    idempotencyKey: string,
  ) {
    return this.request<StatusResponse & { dry?: boolean; quote?: unknown; warnings?: { code: string; detail?: string }[] }>("POST", `/v1/agents/${agentId}/withdraw`, {
      body,
      grant,
      idempotencyKey,
      timeoutMs: 150_000,
    });
  }

  /** A deposit address for funding the agent from another chain (no grant needed). */
  deposit(agentId: string, body: { origin_asset: string; destination_asset?: string; amount?: string }, idempotencyKey: string) {
    return this.request<StatusResponse>("POST", `/v1/agents/${agentId}/deposit`, { body, idempotencyKey });
  }
}

/** A grant token and the commitment the owner signs. The API only ever sees the commitment. */
export function createGrantCredential(seed: Uint8Array = randomBytes(32)) {
  const token = `ngt_${Buffer.from(seed).toString("base64url")}`;
  return { token, commitment: createHash("sha256").update(token, "utf8").digest("hex") };
}

/** The owner descriptor `agent_create` takes for an EVM key: lowercase address, public key without the 04 prefix. */
export function evmOwner(privateKey: string, chainId = 1): EvmOwner {
  const wallet = new Wallet(privateKey);
  return { type: "evm", address: wallet.address.toLowerCase(), chain_id: chainId, public_key: `0x${SigningKey.computePublicKey(wallet.signingKey.publicKey, false).slice(4)}` };
}

type TypedPayload = { types: Record<string, TypedDataField[]>; primaryType: string; domain: Record<string, unknown>; message: Record<string, unknown> };

/** Signs a generated EIP-712 intent exactly as eth_signTypedData_v4 would, payload unchanged. */
export async function signEvmIntent(privateKey: string, generated: Pick<GeneratedIntent, "intent">) {
  const { intent } = generated;
  if (intent.standard !== "eip712") throw new Error(`expected an eip712 intent, got ${intent.standard}`);
  const payload = intent.payload as TypedPayload;
  // ethers infers the primary type from the types it is given, so pass only what it reaches.
  const types = reachableTypes(payload.types, payload.primaryType);
  const signature = await new Wallet(privateKey).signTypedData(payload.domain, types, payload.message);
  return { ...intent, signature };
}

function reachableTypes(all: Record<string, TypedDataField[]>, primary: string): Record<string, TypedDataField[]> {
  const out: Record<string, TypedDataField[]> = {};
  const visit = (name: string) => {
    if (out[name] || !all[name]) return;
    out[name] = all[name];
    for (const field of all[name]) visit(field.type.replace(/\[\d*\]$/, ""));
  };
  visit(primary);
  return out;
}

/** The EIP-712 digest of a payload (for tests and audits). */
export function evmIntentDigest(payload: TypedPayload) {
  return TypedDataEncoder.hash(payload.domain, reachableTypes(payload.types, payload.primaryType), payload.message);
}
