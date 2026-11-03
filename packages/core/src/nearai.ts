import { verifyMessage } from "ethers";
import { sha256Hex } from "./proposal.ts";
import { VERDICT_SCHEMA } from "./prompt.ts";

export const NEARAI_BASE_URL = "https://cloud-api.near.ai/v1";
// A plain instruct model hosted in NEAR AI's own TEEs: no reasoning phase, so a verdict takes
// about 1.5 s and never runs out of tokens before answering.
export const DEFAULT_MODEL = "Qwen/Qwen3-VL-30B-A3B-Instruct";

export interface ModelVerdict {
  proposal_id: string;
  proposal_hash: string;
  verdict: "PASS" | "VETO";
  reasons: string[];
}

export interface SignedScreening {
  model: string;
  chatId: string;
  requestBytes: Uint8Array;
  responseBytes: Uint8Array;
  requestHash: string;
  responseHash: string;
  signedText: string;
  signature: string;
  signingAddress: string;
  verdict: ModelVerdict;
}

interface SignatureResponse {
  text?: string;
  signature?: string;
  signing_address?: string;
  signing_algo?: string;
  signature_kind?: string;
  error_code?: string;
  message?: string;
}

/**
 * Runs one screening on NEAR AI Cloud and returns the exact bytes plus the model
 * enclave's signature over them. Follows the provider_tee rules in
 * https://docs.near.ai/cloud/verification/cloud-api/response-signatures:
 * non-streamed, canonical model id, no aliasing, uncompressed, bytes hashed as sent.
 */
export async function screen(opts: {
  apiKey: string;
  system: string;
  user: string;
  model?: string;
  baseUrl?: string;
}): Promise<SignedScreening> {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = opts.baseUrl ?? NEARAI_BASE_URL;
  const body = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: 0,
    // Reasoning models think before answering; keep that short and leave room for the verdict.
    thinking: { type: "disabled" },
    max_tokens: 2000,
    stream: false,
    response_format: { type: "json_schema", json_schema: { name: "veto_verdict", strict: true, schema: VERDICT_SCHEMA } },
  };
  const requestBytes = new TextEncoder().encode(JSON.stringify(body));

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "x-no-aliasing": "true",
    },
    body: requestBytes,
  });
  const responseBytes = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`NEAR AI completion failed (${res.status}): ${new TextDecoder().decode(responseBytes).slice(0, 300)}`);
  }
  const completion = JSON.parse(new TextDecoder().decode(responseBytes));
  const chatId: string = completion.id;
  const verdict = parseVerdict(completion?.choices?.[0]?.message?.content);

  const requestHash = sha256Hex(requestBytes);
  const responseHash = sha256Hex(responseBytes);
  const expectedText = `${model}:${requestHash}:${responseHash}`;
  const sig = await fetchSignature(baseUrl, opts.apiKey, chatId);
  if (sig.signature_kind !== "provider_tee") {
    throw new Error(`expected a provider_tee signature, got ${sig.signature_kind ?? "none"}`);
  }
  if (sig.text !== expectedText) throw new Error("signed text does not match the exact request and response bytes");
  const recovered = verifyMessage(sig.text!, sig.signature!);
  if (recovered.toLowerCase() !== sig.signing_address!.toLowerCase()) {
    throw new Error("signature does not recover to signing_address");
  }

  return {
    model,
    chatId,
    requestBytes,
    responseBytes,
    requestHash,
    responseHash,
    signedText: sig.text!,
    signature: sig.signature!,
    signingAddress: sig.signing_address!.toLowerCase(),
    verdict,
  };
}

async function fetchSignature(baseUrl: string, apiKey: string, chatId: string): Promise<SignatureResponse> {
  const url = `${baseUrl}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
    if (res.ok) {
      const body = (await res.json()) as SignatureResponse;
      if (!body.error_code && body.signature) return body;
    } else if (res.status !== 404) {
      throw new Error(`signature lookup failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("no signature was recorded for this completion");
}

export function parseVerdict(content: unknown): ModelVerdict {
  if (typeof content !== "string") throw new Error("completion has no text content");
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("completion has no JSON verdict");
  const v = JSON.parse(content.slice(start, end + 1));
  if (v.verdict !== "PASS" && v.verdict !== "VETO") throw new Error("verdict must be PASS or VETO");
  return { proposal_id: String(v.proposal_id), proposal_hash: String(v.proposal_hash), verdict: v.verdict, reasons: v.reasons ?? [] };
}

/** Public, keyless: the model's attested signing key, used once to approve it on the vault. */
export async function modelAttestation(model: string, baseUrl = NEARAI_BASE_URL) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const url = `${baseUrl}/attestation/report?model=${encodeURIComponent(model)}&provider=near&signing_algo=ecdsa&nonce=${nonce}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "x-no-aliasing": "true" } });
  if (!res.ok) throw new Error(`attestation report failed (${res.status})`);
  return { nonce, report: await res.json() };
}

/**
 * One JSON-only completion with no signature fetch: for the agent's own reasoning (reading an
 * invoice), which proves nothing on-chain. Screening verdicts always go through `screen`.
 */
export async function completeJson<T>(opts: {
  apiKey: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  name: string;
  model?: string;
  baseUrl?: string;
}): Promise<T> {
  const res = await fetch(`${opts.baseUrl ?? NEARAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? DEFAULT_MODEL,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`NEAR AI completion failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const content = (await res.json())?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("completion has no text content");
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}
