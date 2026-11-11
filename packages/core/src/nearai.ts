import { verifyMessage } from "ethers";
import { sha256Hex } from "./proposal.ts";
import { SYSTEM_PROMPT, VERDICT_SCHEMA } from "./prompt.ts";

export const NEARAI_BASE_URL = "https://cloud-api.near.ai/v1";
// A plain instruct model hosted in NEAR AI's own TEEs: no reasoning phase, so a verdict takes
// about 1.5 s and never runs out of tokens before answering.
export const DEFAULT_MODEL = "Qwen/Qwen3-VL-30B-A3B-Instruct";

/**
 * NEAR AI Cloud can't serve the model right now: a server error, a dropped connection, a timeout, or
 * no provider serving the model (as while its enclaves are offline). Not a refusal and not a bad
 * request, so callers can say so plainly. Nothing is paid either way: no signed verdict, no payment.
 */
export class NearAiUnavailable extends Error {
  // A plain field, not a constructor parameter property: Node runs this file with types stripped.
  readonly detail: string;
  constructor(detail: string) {
    super(`NEAR AI Cloud isn't serving the model right now (${detail})`);
    this.name = "NearAiUnavailable";
    this.detail = detail;
  }
}

/** By name as well as class, so it holds across bundles that each load their own copy of this module. */
export const isNearAiUnavailable = (e: unknown): e is NearAiUnavailable => e instanceof NearAiUnavailable || (e as Error | null)?.name === "NearAiUnavailable";

/** A verdict takes about 1.5 s (3.2 s at most over the 100-scenario bench); 30 s means NEAR AI isn't answering. */
const SCREEN_TIMEOUT_MS = 30_000;

/**
 * NEAR AI's router answering that nothing serves the model right now, e.g. "Model '…' not found in
 * any configured provider" (a 400) while the model's enclaves are offline.
 */
const NO_PROVIDER = /not found in any configured provider|no provider found/i;
/** Whether a failed NEAR AI response means the service or the model is unavailable, not that the request was wrong. */
const unavailable = (status: number, text: string) => status >= 500 || NO_PROVIDER.test(text);

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
 * The exact bytes of a screening request. A vault with checked screening rebuilds them itself
 * (contract/src/screening.rs build_request) and only accepts a signature over them, so keep the
 * keys in this order.
 */
export function screeningRequest(model: string, user: string, system: string = SYSTEM_PROMPT): Uint8Array<ArrayBuffer> {
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    // Reasoning models think before answering; keep that short and leave room for the verdict.
    thinking: { type: "disabled" },
    max_tokens: 2000,
    stream: false,
    response_format: { type: "json_schema", json_schema: { name: "veto_verdict", strict: true, schema: VERDICT_SCHEMA } },
  };
  return new TextEncoder().encode(JSON.stringify(body));
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
  const requestBytes = screeningRequest(model, opts.user, opts.system);

  const res = await retryOnce(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "identity",
      "x-no-aliasing": "true",
    },
    body: requestBytes,
  }).catch((e: unknown) => {
    throw new NearAiUnavailable((e as Error).message);
  });
  const responseBytes = new Uint8Array(
    await res.arrayBuffer().catch((e: unknown) => {
      throw new NearAiUnavailable((e as Error).message);
    }),
  );
  if (!res.ok) {
    const text = new TextDecoder().decode(responseBytes).slice(0, 300);
    if (unavailable(res.status, text)) throw new NearAiUnavailable(`${res.status}: ${text}`);
    throw new Error(`NEAR AI completion failed (${res.status}): ${text}`);
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

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends once more after a dropped connection or a gateway error, so a network blip doesn't cost a
 * verdict (an owned vault has no fallback signer: no verdict means the payment expires unpaid).
 * The same bytes go out again, so what the enclave signs is still exactly what was sent. Each try
 * gives up after SCREEN_TIMEOUT_MS, so an outage fails fast instead of hanging the request.
 */
async function retryOnce(url: string, init: RequestInit): Promise<Response> {
  const send = () => fetch(url, { ...init, signal: AbortSignal.timeout(SCREEN_TIMEOUT_MS) });
  try {
    const res = await send();
    if (![502, 503, 504].includes(res.status)) return res;
  } catch {
    // Dropped (or timed out) before a response: try again below.
  }
  await pause(800);
  return send();
}

async function fetchSignature(baseUrl: string, apiKey: string, chatId: string): Promise<SignatureResponse> {
  const url = `${baseUrl}/signature/${encodeURIComponent(chatId)}?signing_algo=ecdsa`;
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }).catch(() => null);
    if (!res) {
      await pause(1000);
      continue;
    }
    if (res.ok) {
      const body = (await res.json()) as SignatureResponse;
      if (!body.error_code && body.signature) return body;
    } else if (res.status >= 500) {
      throw new NearAiUnavailable(`signature lookup ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } else if (res.status !== 404) {
      throw new Error(`signature lookup failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    await pause(1000);
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
  }).catch((e: unknown) => {
    throw new NearAiUnavailable((e as Error).message);
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    if (unavailable(res.status, text)) throw new NearAiUnavailable(`${res.status}: ${text}`);
    throw new Error(`NEAR AI completion failed (${res.status}): ${text}`);
  }
  const content = (await res.json())?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("completion has no text content");
  return JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T;
}
