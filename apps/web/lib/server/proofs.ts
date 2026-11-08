// Server-only: the shared sandbox publishes the exact bytes each verdict was signed over, so anyone
// can rehash them against the hashes the enclave signed and the vault checked, and read the email
// the model judged. Only the sandbox, whose emails are made up or written by visitors who are told:
// a vault someone owns keeps them private, and only their hashes go on-chain.
//
// Three public files per decision, under proofs/<vault>/<id>/:
//   request.json   the exact request bytes sent to NEAR AI (sha256 = the verdict's request hash)
//   response.json  the exact response bytes (sha256 = the verdict's response hash)
//   meta.json      the evidence the agent committed to (sha256 of its canonical JSON = the
//                  proposal's context hash), the chat id, signature and the verdict transaction
import { put } from "@vercel/blob";
import type { SignedScreening } from "@veto/core";
import { PROOF_BASE } from "@/lib/config";

export interface ProofMeta {
  vault: string;
  id: string;
  model: string;
  chat_id: string;
  signature: string;
  request_hash: string;
  response_hash: string;
  evidence: unknown;
  /** The submit_verdict transaction. */
  tx: string;
  published_at: string;
}

const dir = (vault: string, id: string) => `proofs/${vault}/${id}`;
export const proofUrl = (vault: string, id: string, file: "request.json" | "response.json" | "meta.json") => `${PROOF_BASE}/${dir(vault, id)}/${file}`;

const enabled = () => !!process.env.BLOB_READ_WRITE_TOKEN?.trim();

/** Publishes one sandbox verdict's bytes. Never throws: a missing proof must not fail the payment. */
export async function publishProof(vault: string, id: string, screened: { result: SignedScreening; tx: string }, evidence: unknown) {
  if (!enabled()) return;
  const { result, tx } = screened;
  const meta: ProofMeta = {
    vault,
    id,
    model: result.model,
    chat_id: result.chatId,
    signature: result.signature,
    request_hash: result.requestHash,
    response_hash: result.responseHash,
    evidence,
    tx,
    published_at: new Date().toISOString(),
  };
  const opts = { access: "public" as const, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" };
  try {
    await Promise.all([
      put(`${dir(vault, id)}/request.json`, Buffer.from(result.requestBytes), opts),
      put(`${dir(vault, id)}/response.json`, Buffer.from(result.responseBytes), opts),
      put(`${dir(vault, id)}/meta.json`, JSON.stringify(meta, null, 2), opts),
    ]);
  } catch (e) {
    console.error(`publishing the proof for ${vault}#${id} failed:`, (e as Error).message);
  }
}
