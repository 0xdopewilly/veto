// Own-vault mode: an agent account on your vault proposes payments through @veto/sdk, and the
// guardian you run screens them. Configured only from the environment; the key never leaves it.
import type { Payee, Proposal, VaultConfig } from "@veto/core/proposal";
import { DECIDED, EXPLORER, knownAsset, type AssetMeta, type AssetPolicy, type Links, type SpendStatus } from "./describe.ts";
import { sleep } from "./sandbox.ts";

export type Network = "testnet" | "mainnet";

export interface VaultEnv {
  vaultId: string;
  agentAccountId: string;
  agentKey: string;
  guardianUrl: string;
  network: Network;
}

const REQUIRED = ["VETO_VAULT_ID", "VETO_AGENT_ACCOUNT", "VETO_AGENT_KEY", "VETO_GUARDIAN_URL"] as const;

/** Own-vault mode when all four are set; sandbox mode when none are; an error naming what's missing otherwise. */
export function vaultEnv(env: Record<string, string | undefined>): VaultEnv | null {
  const set = REQUIRED.filter((k) => env[k]?.trim());
  if (set.length === 0) return null;
  const missing = REQUIRED.filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Own-vault mode needs all of ${REQUIRED.join(", ")}; missing ${missing.join(", ")}. Unset them all to use the hosted sandbox instead.`);
  const network = (env.VETO_NETWORK?.trim() || "testnet") as Network;
  if (network !== "testnet" && network !== "mainnet") throw new Error(`VETO_NETWORK must be testnet or mainnet, not "${env.VETO_NETWORK}".`);
  const agentKey = env.VETO_AGENT_KEY!.trim();
  // Checked by shape only, and never echoed.
  if (!/^(ed25519|secp256k1):[1-9A-HJ-NP-Za-km-z]{32,}$/.test(agentKey)) throw new Error("VETO_AGENT_KEY must be a NEAR key pair string, ed25519:<base58 secret key>.");
  return {
    vaultId: env.VETO_VAULT_ID!.trim(),
    agentAccountId: env.VETO_AGENT_ACCOUNT!.trim(),
    agentKey,
    guardianUrl: env.VETO_GUARDIAN_URL!.trim().replace(/\/+$/, ""),
    network,
  };
}

/** The parts of @veto/sdk and the vault the tools use; tests pass a fake. */
export interface VaultBackend {
  vaultId: string;
  network: Network;
  propose(p: { payee: string; amount: string; asset: string; chain: string; memo?: string; evidence?: unknown }): Promise<{ id: string; tx: string }>;
  proposal(id: string): Promise<Proposal | null>;
  view<T>(method: string, args?: Record<string, unknown>): Promise<T>;
  ftMetadata(token: string): Promise<{ symbol: string; decimals: number }>;
}

/** The real backend: `Veto` from @veto/sdk, loaded only in this mode. */
export async function sdkBackend(env: VaultEnv): Promise<VaultBackend> {
  const { Veto } = await import("@veto/sdk");
  const veto = new Veto({
    vaultId: env.vaultId,
    agentAccountId: env.agentAccountId,
    agentKey: env.agentKey as `ed25519:${string}`,
    guardianUrl: env.guardianUrl,
    network: env.network,
  });
  const reader = veto.vault;
  return {
    vaultId: env.vaultId,
    network: env.network,
    propose: async (p) => {
      const { id, tx } = await veto.propose(p);
      return { id, tx };
    },
    proposal: (id) => reader.proposal(id),
    view: (method, args = {}) => reader.view(method, args),
    ftMetadata: (token) =>
      reader.rpc.callFunction({ contractId: token, method: "ft_metadata", args: {}, blockQuery: { finality: "optimistic" } }) as Promise<{ symbol: string; decimals: number }>,
  };
}

/** The hosted app opens the sandbox and vaults its factory created; others have no app pages there. */
const HOSTED_FACTORY = /\.vaults\.veto-rhwe0krb\.testnet$/;
const HOSTED_SANDBOX = "treasury.veto-rhwe0krb.testnet";

export class OwnVault {
  readonly backend: VaultBackend;
  readonly appUrl: string;
  readonly #pollMs: number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  readonly #assets = new Map<string, AssetMeta>();

  constructor(backend: VaultBackend, opts: { appUrl?: string; pollMs?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number } = {}) {
    this.backend = backend;
    this.appUrl = (opts.appUrl ?? "https://veto-beta.vercel.app").replace(/\/+$/, "");
    this.#pollMs = opts.pollMs ?? 1500;
    this.#sleep = opts.sleep ?? sleep;
    this.#now = opts.now ?? Date.now;
  }

  get explorer() {
    return EXPLORER[this.backend.network];
  }

  async asset(asset: string): Promise<AssetMeta> {
    const known = knownAsset(asset) ?? this.#assets.get(asset);
    if (known) return known;
    const m = await this.backend.ftMetadata(asset);
    const meta = { symbol: m.symbol, decimals: m.decimals };
    this.#assets.set(asset, meta);
    return meta;
  }

  policies = () => this.backend.view<[string, AssetPolicy][]>("get_policies");

  /** The asset a payment defaults to: the vault's first token with caps, else native NEAR (as the app leads with). */
  async defaultAsset(): Promise<string> {
    const policies = await this.policies();
    return policies.map(([a]) => a).find((a) => a !== "near" && !a.includes(":")) ?? "near";
  }

  async wait(id: string, timeoutMs: number, opts: { signal?: AbortSignal; onPoll?: (p: Proposal | null) => void } = {}) {
    const until = this.#now() + timeoutMs;
    for (;;) {
      const p = await this.backend.proposal(id);
      opts.onPoll?.(p);
      if (p && DECIDED.includes(p.status)) return { proposal: p, decided: true };
      if (this.#now() >= until) return { proposal: p, decided: false };
      await this.#sleep(this.#pollMs, opts.signal);
    }
  }

  links(id: string, proposalTx?: string): Links {
    const { vaultId, network } = this.backend;
    const hosted = network === "testnet" && (vaultId === HOSTED_SANDBOX || HOSTED_FACTORY.test(vaultId));
    const q = `?vault=${encodeURIComponent(vaultId)}`;
    return {
      ...(proposalTx && { proposal_tx: `${this.explorer}/txns/${proposalTx}` }),
      ...(hosted && { decision_page: `${this.appUrl}/app/decisions/${id}${q}`, proof_page: `${this.appUrl}/app/decisions/${id}/proof${q}` }),
      vault: `${this.explorer}/address/${vaultId}`,
    };
  }

  async rules() {
    const [config, payees, policies, pending] = await Promise.all([
      this.backend.view<VaultConfig>("get_config"),
      this.backend.view<Payee[]>("get_payees"),
      this.policies(),
      this.backend.view<[string, { policy: AssetPolicy; effective_at: string }][]>("get_pending_policies").catch(() => []),
    ]);
    const [spendList, metas] = await Promise.all([
      Promise.all(policies.map(([asset]) => this.backend.view<SpendStatus>("get_spend", { asset }))),
      Promise.all(policies.map(([asset]) => this.asset(asset).catch(() => ({ symbol: asset, decimals: 0 })))),
    ]);
    return {
      vaultId: this.backend.vaultId,
      network: this.backend.network,
      config,
      payees,
      policies,
      pending,
      spend: Object.fromEntries(spendList.map((s) => [s.asset, s])),
      assets: Object.fromEntries(policies.map(([asset], i) => [asset, metas[i]])),
    };
  }
}
