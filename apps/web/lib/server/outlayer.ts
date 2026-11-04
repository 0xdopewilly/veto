// Server-only: the demo's OutLayer path. The agent asks its OutLayer wallet to pay; the
// wallet's policy holds the payment for approval; the guardian records it on the vault,
// screens it, and votes yes on OutLayer only if the vault passes it.
import { actions, teraToGas } from "near-api-js";
import {
  approvePassed,
  canonicalJson,
  paymentFromApproval,
  screenAndSubmit,
  settleFromTx,
  sha256Hex,
  walletAccount,
  type PaymentRequest,
  type Proposal,
} from "@veto/core";
import { demo, demoAccounts } from "./demo";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The agent's side: ask the wallet for an ft_transfer. Returns the pending approval. */
export async function requestPayment(request: PaymentRequest) {
  const { outlayer } = demoAccounts();
  if (!outlayer) throw new Error("the OutLayer wallet is not configured");
  const res = await outlayer.client.call<{ status: string; approval_id?: string; request_id: string }>("POST", "/wallet/v1/call", {
    key: outlayer.walletKey,
    body: {
      receiver_id: request.asset,
      method_name: "ft_transfer",
      args: { receiver_id: request.payee, amount: request.amount, memo: request.memo },
      deposit: "1",
      gas: "30000000000000",
    },
  });
  if (res.status !== "pending_approval" || !res.approval_id) throw new Error(`the wallet did not hold the payment for approval (${res.status})`);
  return { approvalId: res.approval_id, requestId: res.request_id };
}

/** The guardian's side: record the held payment on the vault. Returns the proposal id and tx. */
export async function recordOnVault(approvalId: string, evidence: unknown) {
  const { outlayer, guardian, reader } = demoAccounts();
  if (!outlayer) throw new Error("the OutLayer wallet is not configured");
  const approval = await outlayer.client.approval(approvalId);
  if (walletAccount(approval) !== outlayer.wallet) throw new Error("the approval is for a different wallet");
  const outcome = await guardian.signAndSendTransaction({
    receiverId: reader.vaultId,
    actions: [
      actions.functionCall(
        "propose_external",
        {
          request: paymentFromApproval(approval),
          context_hash: sha256Hex(canonicalJson(evidence)),
          external: { provider: "outlayer", wallet: outlayer.wallet, approval_id: approval.id, op_hash: approval.request_hash, tx_hash: null },
        },
        teraToGas("50"),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const value = (outcome.status as { SuccessValue?: string }).SuccessValue;
  if (!value) throw new Error("the vault refused the payment");
  return { id: JSON.parse(Buffer.from(value, "base64").toString()) as string, tx: outcome.transaction.hash };
}

/** Screens a recorded payment; if the vault passes it, votes yes on OutLayer and settles it. */
export async function screenAndVote(id: string, evidence: unknown, requestId?: string) {
  const { reader, guardian, screener } = demoAccounts();
  const proposal = await reader.proposal(id);
  if (proposal?.status === "Screening") await screenAndSubmit({ vault: reader, guardian, screener, proposal, evidence });
  const after = await reader.proposal(id);
  if (after?.status === "Executing") await approveAndSettle(after, requestId);
}

/**
 * The wallet request an approval holds. OutLayer creates the two together but an approval doesn't
 * name its request, so a retry (when the first vote's answer was lost) finds it by creation time.
 * settleFromTx then checks the transaction itself, so a wrong match can't settle anything.
 */
async function requestFor(createdAt: string | undefined): Promise<string | undefined> {
  const { outlayer } = demoAccounts();
  if (!outlayer || !createdAt) return undefined;
  const at = Date.parse(createdAt);
  const { requests } = await outlayer.client.call<{ requests: { request_id: string; type: string; created_at: string }[] }>("GET", "/wallet/v1/requests?limit=50", { key: outlayer.walletKey });
  return requests.find((r) => r.type === "call" && Math.abs(Date.parse(r.created_at) - at) < 3000)?.request_id;
}

/** Votes yes for a payment the vault has approved (a pass, or an override that came due), then settles it. */
export async function approveAndSettle(proposal: Proposal, requestId?: string) {
  const { outlayer, reader, guardian } = demoAccounts();
  if (!outlayer || !proposal.external) return;
  const vote = await approvePassed({ outlayer: outlayer.client, proposal, approver: outlayer.approver });
  const rid = requestId ?? ("request_id" in vote ? vote.request_id : undefined) ?? (await requestFor("created_at" in vote ? (vote.created_at as string) : undefined));
  if (!rid) throw new Error("OutLayer did not say which request the vote released");
  // The agent can read its own request; the guardian then checks the transaction on NEAR itself.
  for (let i = 0; i < 40; i++) {
    const r = await outlayer.client.call<{ status: string; result?: { tx_hash?: string } }>("GET", `/wallet/v1/requests/${rid}`, { key: outlayer.walletKey });
    if (r.result?.tx_hash) return settleFromTx({ vault: reader, guardian, proposal, txHash: r.result.tx_hash });
    if (r.status === "failed") {
      return guardian.callFunction({ contractId: reader.vaultId, methodName: "settle_external", args: { id: proposal.id, paid: false, tx_hash: null }, gas: teraToGas("30") });
    }
    await sleep(1500);
  }
  throw new Error(`OutLayer request ${rid} did not finish`);
}

/** The owner kept a veto: Veto's approver rejects the held payment, so OutLayer drops it for good. */
export async function rejectHeld(proposal: Proposal) {
  const { outlayer } = demoAccounts();
  if (!outlayer || !proposal.external) return;
  const approval = await outlayer.client.approval(proposal.external.approval_id);
  if (approval.status !== "pending" || approval.request_hash !== proposal.external.op_hash) return;
  await outlayer.client.vote("reject", approval, outlayer.approver, "The owner kept Veto's veto.");
}

export const outlayerEnabled = () => Boolean(demo.enabled && demo.outlayerWallet && demoAccounts().outlayer);
