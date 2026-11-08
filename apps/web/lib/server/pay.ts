// Server-only: the demo agent asking to pay. From the vault (propose) or from its OutLayer wallet
// (held for approval, then recorded on the vault); either way the guardian screens it after the
// response is sent and the vault decides on-chain.
import { after } from "next/server";
import { actions, teraToGas } from "near-api-js";
import { canonicalJson, payoutIfSigned, screenAndSubmit, sha256Hex, type PaymentRequest } from "@veto/core";
import type { VaultAccounts } from "./demo";
import { recordOnVault, requestPayment, screenAndVote } from "./outlayer";
import { publishProof } from "./proofs";

export type Evidence = { source: string; from: string; subject: string; body: string };

export async function startPayment(accounts: VaultAccounts, request: PaymentRequest, evidence: Evidence, via?: string) {
  const { vaultId, reader, agent, guardian, screener } = accounts;
  if (via === "outlayer") {
    if (!accounts.outlayer) throw new Error("this vault has no OutLayer wallet");
    if (request.chain !== "near") throw new Error("the OutLayer wallet pays on NEAR only");
    const { approvalId, requestId } = await requestPayment(request);
    const { id, tx } = await recordOnVault(approvalId, evidence);
    after(() => screenAndVote(id, evidence, requestId).catch((e) => console.error(`demo OutLayer payment ${id} failed:`, (e as Error).message)));
    return { proposal_id: id, tx, approval_id: approvalId };
  }
  const outcome = await agent.signAndSendTransaction({
    receiverId: vaultId,
    actions: [actions.functionCall("propose", { request, context_hash: sha256Hex(canonicalJson(evidence)) }, teraToGas("30"), 0n)],
    waitUntil: "FINAL",
  });
  const value = (outcome.status as { SuccessValue?: string }).SuccessValue;
  if (!value) throw new Error("the vault refused the proposal");
  const id: string = JSON.parse(Buffer.from(value, "base64").toString());
  after(async () => {
    try {
      const proposal = await reader.proposal(id);
      if (proposal?.status === "Screening") {
        const screened = await screenAndSubmit({ vault: reader, guardian, screener, proposal, evidence });
        // The sandbox publishes the exact bytes the verdict was signed over; an owned vault keeps them private.
        if (accounts.sandbox) await publishProof(vaultId, id, screened, evidence);
      }
      // A Base payout from the vault's own address: broadcast what the MPC network signed.
      const signed = await reader.proposal(id);
      if (signed?.evm) await payoutIfSigned({ vault: reader, guardian, proposal: signed });
    } catch (e) {
      console.error(`demo screening for proposal ${id} failed:`, (e as Error).message);
    }
  });
  return { proposal_id: id, tx: outcome.transaction.hash };
}

/** The vault's own refusals (caps, frozen, a bad payee) are the demo working, not a server error. */
export function refusal(e: unknown) {
  const message = (e as Error).message;
  const refused = /exceeds|frozen|not allowed|not an active agent|not a valid|payee is not|refused|pays on NEAR only|no OutLayer wallet/.test(message);
  return Response.json(
    { error: refused ? `The vault refused it: ${message.replace(/^.*Smart contract panicked: /, "")}` : message },
    { status: refused ? 422 : 500 },
  );
}

/** "0.0005" with 18 decimals -> "500000000000000". */
export function units(amount: string, decimals: number) {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
