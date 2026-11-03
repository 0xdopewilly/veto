// OutLayer Agent Custody wallets with Veto as an approver on the wallet's policy.
// The agent's payment waits on OutLayer as a pending approval. The guardian records it on the
// vault (same caps, screen and on-chain verdict as a vault payment) and votes yes on OutLayer
// only once the vault has passed it. A veto is silence: the payment stays held, and the owner
// can still override it on the vault or approve it on OutLayer directly.
import { base64 } from "@scure/base";
import { KeyPair, KeyPairSigner, teraToGas, type Account, type KeyPairString } from "near-api-js";
import { canonicalJson, sha256Hex, type PaymentRequest, type Proposal } from "./proposal.ts";
import type { VaultReader } from "./vault.ts";

export const OUTLAYER = {
  testnet: { api: "https://testnet-api.outlayer.ai", contract: "outlayer.testnet" },
  mainnet: { api: "https://api.outlayer.ai", contract: "outlayer.near" },
} as const;

/** A pending (or decided) approval, as `GET /wallet/v1/approval/{id}` returns it. No auth needed. */
export interface Approval {
  id: string;
  wallet_id: string;
  status: string;
  required_approvals: number;
  /** sha256 of `op_canonical`. */
  request_hash: string;
  op: { kind: string; to: string; amount?: string; method?: string; args_base64?: string; deposit?: string };
  op_canonical: string;
  /** "ed25519:<64 hex>"; the hex is the wallet's implicit NEAR account. */
  wallet_pubkey: string;
  expires_at: string;
}

export class OutLayer {
  readonly api: string;
  readonly contract: string;

  constructor(network: keyof typeof OUTLAYER = "testnet") {
    ({ api: this.api, contract: this.contract } = OUTLAYER[network]);
  }

  async call<T>(method: string, path: string, opts: { body?: unknown; key?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.key) headers.Authorization = `Bearer ${opts.key}`;
    const res = await fetch(this.api + path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new OutLayerError(res.status, text.slice(0, 300));
    return JSON.parse(text) as T;
  }

  approval = (id: string) => this.call<Approval>("GET", `/wallet/v1/approval/${encodeURIComponent(id)}`);

  /** Votes on an approval as `approver`, who must be named on the wallet's policy with a full-access key. */
  async vote(verb: "approve" | "reject", approval: Approval, approver: { accountId: string; key: KeyPairString }, reason?: string) {
    const signer = new KeyPairSigner(KeyPair.fromString(approver.key));
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const message = `${verb}:${approval.id}:${approval.wallet_pubkey}:${approval.request_hash}`;
    const signed = await signer.signNep413Message(approver.accountId, { message, recipient: this.contract, nonce });
    return this.call<{ status: string; request_id?: string }>("POST", `/wallet/v1/${verb}/${encodeURIComponent(approval.id)}`, {
      body: {
        account_id: approver.accountId,
        public_key: signed.publicKey.toString(),
        signature: base64.encode(signed.signature),
        nonce: base64.encode(nonce),
        ...(reason ? { reason } : {}),
      },
    });
  }
}

export class OutLayerError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(`OutLayer ${status}: ${body}`);
    this.status = status;
  }
}

export const walletAccount = (approval: Approval) => approval.wallet_pubkey.replace(/^ed25519:/, "");

/**
 * The payment an approval would make, checked against OutLayer's own hash of the operation.
 * Native NEAR transfers and NEP-141 `ft_transfer` calls; anything else is left alone.
 */
export function paymentFromApproval(approval: Approval): PaymentRequest {
  if (sha256Hex(approval.op_canonical) !== approval.request_hash) throw new Error("approval hash does not match its operation");
  const op = JSON.parse(approval.op_canonical) as Approval["op"];
  if (op.kind === "transfer" && op.amount) {
    return { chain: "near", asset: "near", payee: op.to, amount: op.amount, memo: null };
  }
  if (op.kind === "call" && op.method === "ft_transfer" && op.args_base64 && op.deposit === "1") {
    const args = JSON.parse(new TextDecoder().decode(base64.decode(op.args_base64))) as { receiver_id: string; amount: string; memo?: string | null };
    return { chain: "near", asset: op.to, payee: args.receiver_id, amount: args.amount, memo: args.memo ?? null };
  }
  throw new Error(`unsupported OutLayer operation: ${op.kind}${op.method ? ` ${op.method}` : ""}`);
}

/** Records a pending OutLayer payment on the vault. Returns the new proposal. */
export async function recordApproval(opts: { vault: VaultReader; guardian: Account; approval: Approval; evidence: unknown }): Promise<Proposal> {
  const { vault, guardian, approval } = opts;
  if (approval.status !== "pending") throw new Error(`approval is ${approval.status}`);
  const request = paymentFromApproval(approval);
  const id = await guardian.callFunction<string>({
    contractId: vault.vaultId,
    methodName: "propose_external",
    args: {
      request,
      context_hash: opts.evidence === undefined ? null : sha256Hex(canonicalJson(opts.evidence)),
      external: { provider: "outlayer", wallet: walletAccount(approval), approval_id: approval.id, op_hash: approval.request_hash, tx_hash: null },
    },
    gas: teraToGas("50"),
    waitUntil: "FINAL",
  });
  const proposal = await vault.proposal(id);
  if (!proposal) throw new Error("the vault did not record the payment");
  return proposal;
}

/**
 * Votes yes on OutLayer for a payment the vault has passed (or an override that came due).
 * Re-reads the approval and refuses if the operation changed since it was recorded.
 */
export async function approvePassed(opts: { outlayer: OutLayer; proposal: Proposal; approver: { accountId: string; key: KeyPairString } }) {
  const ext = opts.proposal.external;
  if (!ext || opts.proposal.status !== "Executing") throw new Error("payment has not passed the vault");
  const approval = await opts.outlayer.approval(ext.approval_id);
  if (approval.request_hash !== ext.op_hash || walletAccount(approval) !== ext.wallet) throw new Error("approval no longer matches the recorded payment");
  if (approval.status === "approved") return approval;
  return opts.outlayer.vote("approve", approval, opts.approver);
}

/**
 * Marks an approved OutLayer payment paid once its transaction is final on NEAR: signed by the
 * wallet, paying exactly the recorded payee and amount. A failed transaction releases the spend.
 */
export async function settleFromTx(opts: { vault: VaultReader; guardian: Account; proposal: Proposal; txHash: string }) {
  const { vault, guardian, proposal, txHash } = opts;
  const ext = proposal.external;
  if (!ext) throw new Error("not an external payment");
  const tx = (await vault.rpc.viewTransactionStatus({ txHash, accountId: ext.wallet, waitUntil: "FINAL" })) as unknown as TxResult;
  if (tx.transaction.signer_id !== ext.wallet) throw new Error("transaction was not sent by the wallet");
  if (!matchesRequest(tx, proposal.request)) throw new Error("transaction does not make the recorded payment");
  const paid = "SuccessValue" in (tx.status as object);
  return guardian.callFunction<string>({
    contractId: vault.vaultId,
    methodName: "settle_external",
    args: { id: proposal.id, paid, tx_hash: txHash },
    gas: teraToGas("30"),
    waitUntil: "FINAL",
  });
}

interface TxResult {
  status: unknown;
  transaction: {
    signer_id: string;
    receiver_id: string;
    actions: ({ Transfer?: { deposit: string } } & { FunctionCall?: { method_name: string; args: string; deposit: string } })[];
  };
}

function matchesRequest(tx: TxResult, r: PaymentRequest) {
  const [action] = tx.transaction.actions;
  if (tx.transaction.actions.length !== 1 || !action) return false;
  if (r.asset === "near") return tx.transaction.receiver_id === r.payee && action.Transfer?.deposit === r.amount;
  const call = action.FunctionCall;
  if (tx.transaction.receiver_id !== r.asset || call?.method_name !== "ft_transfer") return false;
  const args = JSON.parse(new TextDecoder().decode(base64.decode(call.args))) as { receiver_id: string; amount: string };
  return args.receiver_id === r.payee && args.amount === r.amount;
}
