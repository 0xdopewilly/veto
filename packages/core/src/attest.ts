// Verifies, from scratch and with a fresh nonce, that the model key signing Veto's verdicts lives in
// a genuine NEAR AI Cloud enclave: the checks NEAR AI's verification docs describe, after its
// official verifier (github.com/nearai/nearai-cloud-verifier).
//
//   1. Fresh evidence: the report answers a random nonce we just made.
//   2. Intel TDX: the CPU quote verifies against Intel's certificates (dcap-qvl, Intel's collateral).
//   3. The quote's report data holds the signing key and our nonce, so the key is that enclave's.
//   4. NVIDIA: the GPU evidence, made for our nonce, passes NVIDIA's attestation service.
//   5. The enclave's config hash (mr_config) is the hash of the app it publishes (its compose file).
//   6. NEAR AI's gateway, which receives the request first, passes the same quote and binding checks.
//   7. The attested key is the one the caller expects (the key a vault approved).
//
// Server-only (Node): the quote verifier is WebAssembly loaded from disk. Keyless: the attestation
// endpoint, Intel's collateral and NVIDIA's service are all public.
import { createHash, randomBytes } from "node:crypto";
import { NEARAI_BASE_URL } from "./nearai.ts";

const INTEL_PCCS = "https://api.trustedservices.intel.com/tdx/certification/v4";
// Phala's public mirror of Intel's collateral, used when Intel's service doesn't answer. A mirror can
// only serve Intel's collateral, not forge it: js_verify checks every signature in it up to Intel's root.
const MIRROR_PCCS = "https://pccs.phala.network/tdx/certification/v4";
const NVIDIA_NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";

export type EnclaveCheckId = "fresh" | "tdx" | "key_bound" | "nonce_bound" | "gpu" | "software" | "gateway" | "signer";

export interface EnclaveCheck {
  id: EnclaveCheckId;
  ok: boolean;
  /** What was checked, in a sentence. */
  title: string;
  /** What we saw. */
  detail: string;
}

export interface EnclaveVerification {
  model: string;
  /** The random nonce this run asked NEAR AI to attest to. */
  nonce: string;
  checked_at: string;
  /** The model's attested signing key (lowercase 0x address), or null when none answered. */
  signer: string | null;
  checks: EnclaveCheck[];
  ok: boolean;
  /** sha256 of the enclave's published app config, which its quote commits to. */
  compose_hash: string | null;
  tdx_status: string | null;
}

interface Attestation {
  signing_address: string;
  signing_algo?: string;
  request_nonce?: string;
  intel_quote: string;
  nvidia_payload?: string;
  info?: { tcb_info?: string | { app_compose?: string } };
}

const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

/** One more try after a dropped connection or a 5xx: these are public services answering live. */
async function once<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    return attempt();
  }
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} answered ${res.status}`);
  return (await res.json()) as T;
}

type Dcap = { js_get_collateral(url: string, quote: Uint8Array): Promise<unknown>; js_verify(quote: Uint8Array, collateral: unknown, now: bigint): unknown };
let dcap: Promise<Dcap> | null = null;
const loadDcap = () => (dcap ??= import("@phala/dcap-qvl-node").then((m) => ((m as { default?: Dcap }).default ?? (m as unknown as Dcap))));

/** dcap-qvl rejects with plain strings ("Failed to get collateral"); keep the reason readable. */
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** Intel's collateral couldn't be fetched: the quote wasn't checked, which is not the same as failing. */
class Unavailable extends Error {}
/** What a failed quote check says: why it couldn't be checked, or why it didn't verify. */
const quoteFailure = (e: Error | null) => (e instanceof Unavailable ? e.message : `The quote didn't verify: ${e?.message}`);

/**
 * Intel's signed collateral (certificates, revocation lists, TCB info) for a quote's platform, from
 * Intel, or from the mirror when Intel's service is down.
 */
export async function quoteCollateral(quoteHex: string): Promise<unknown> {
  const dcap = await loadDcap();
  const quote = Buffer.from(quoteHex, "hex");
  try {
    return await once(() => dcap.js_get_collateral(INTEL_PCCS, quote));
  } catch (intel) {
    try {
      return await dcap.js_get_collateral(MIRROR_PCCS, quote);
    } catch (mirror) {
      throw new Unavailable(`Intel's certificate service and its mirror didn't answer (${reason(intel)}; ${reason(mirror)}), so the quote couldn't be checked. Try again in a minute.`);
    }
  }
}

/**
 * Verifies an Intel TDX quote against Intel's collateral at time `now` (unix seconds): the quote's
 * signature chain up to Intel's root. Throws on a tampered or forged quote.
 */
export async function checkQuote(quoteHex: string, collateral: unknown, now = BigInt(Math.floor(Date.now() / 1000))) {
  const result = (await loadDcap()).js_verify(Buffer.from(quoteHex, "hex"), collateral, now) as {
    status?: string;
    report?: { TD10?: { report_data?: string; mr_config_id?: string } };
  };
  const status = result.status ?? "unknown";
  return {
    // UpToDate is ideal; OutOfDate still verifies (Intel's platform advisory, not a broken quote).
    ok: status === "UpToDate" || status === "OutOfDate",
    status,
    reportData: Buffer.from((result.report?.TD10?.report_data ?? "").replace(/^0x/i, ""), "hex"),
    mrConfig: (result.report?.TD10?.mr_config_id ?? "").toLowerCase(),
  };
}

const verifyQuote = async (quoteHex: string) => checkQuote(quoteHex, await quoteCollateral(quoteHex));

/** Whether a verified quote's report data is this signing address (left-aligned in 32 bytes) followed by this nonce. */
export function quoteBinding(reportData: Buffer, address: string, nonce: string) {
  const key = Buffer.alloc(32);
  Buffer.from(address.replace(/^0x/i, ""), "hex").copy(key);
  return { key: reportData.subarray(0, 32).equals(key), nonce: reportData.subarray(32, 64).equals(Buffer.from(nonce, "hex")) };
}
const binding = quoteBinding;

/** Whether a verified quote's mr_config commits to this app config (dstack: 0x01 || sha256(app_compose)). */
export const composeMatches = (mrConfig: string, compose: string) => mrConfig.startsWith(`01${createHash("sha256").update(compose).digest("hex")}`);

function appCompose(a: Attestation): string | null {
  const tcb = a.info?.tcb_info;
  const parsed = typeof tcb === "string" ? (JSON.parse(tcb) as { app_compose?: string }) : tcb;
  return parsed?.app_compose ?? null;
}

/** NVIDIA's attestation service on the GPU evidence; its overall result, and whether the evidence used our nonce. */
async function verifyGpu(payloadJson: string, nonce: string) {
  const payload = JSON.parse(payloadJson) as { nonce?: string; evidence_list?: unknown[] };
  const body = await once(async () =>
    json<[[string, string], ...unknown[]]>(
      await fetch(NVIDIA_NRAS, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: payloadJson, signal: AbortSignal.timeout(30_000) }),
      "NVIDIA's attestation service",
    ),
  );
  const claims = JSON.parse(Buffer.from(body[0][1].split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
  return {
    pass: claims["x-nvidia-overall-att-result"] === true,
    nonceMatches: (payload.nonce ?? "").toLowerCase() === nonce.toLowerCase(),
    gpus: payload.evidence_list?.length ?? 0,
  };
}

/**
 * One full, fresh verification of the model's enclave. `expectSigner` is the key the caller trusts:
 * the key a vault approved (`signerFrom: "vault"`, the default) or the key that signed a bench run.
 */
export async function verifyEnclave(model: string, opts: { expectSigner?: string; signerFrom?: "vault" | "run"; baseUrl?: string } = {}): Promise<EnclaveVerification> {
  const nonce = randomBytes(32).toString("hex");
  const checked_at = new Date().toISOString();
  const want = opts.expectSigner?.toLowerCase();
  const url = `${opts.baseUrl ?? NEARAI_BASE_URL}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`;
  const get = (u: string) => once(() => fetch(u, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) }));
  // Ask for the expected key's server first; NEAR AI answers an error when no server holds it, and
  // the plain report then shows which key it does attest.
  let res = want ? await get(`${url}&signing_address=${want}`) : null;
  if (!res?.ok) res = await get(url);
  const report = await json<{ model_attestations?: Attestation[]; gateway_attestation?: Attestation }>(res, "NEAR AI's attestation endpoint");
  const all = report.model_attestations ?? [];
  const attested = (want ? all.find((m) => m.signing_address.toLowerCase() === want) : undefined) ?? all[0];
  const checks: EnclaveCheck[] = [];
  const add = (id: EnclaveCheckId, ok: boolean, title: string, detail: string) => checks.push({ id, ok, title, detail });

  if (!attested) {
    add("fresh", false, "NEAR AI attested the model's key", `No attestation for ${model} came back.`);
    return { model, nonce, checked_at, signer: null, checks, ok: false, compose_hash: null, tdx_status: null };
  }
  const signer = attested.signing_address.toLowerCase();

  add(
    "fresh",
    (attested.request_nonce ?? "").toLowerCase() === nonce,
    "Fresh evidence, made for this check",
    `NEAR AI answered our random nonce ${short(nonce)}, so the report was made just now and can't be replayed.`,
  );

  // Intel (model and gateway quotes) and NVIDIA answer independently, so ask them at once.
  const gateway = report.gateway_attestation;
  const settle = <T,>(p: Promise<T>) => p.then((value) => ({ value, error: null }), (error: unknown) => ({ value: null, error: error instanceof Error ? error : new Error(reason(error)) }));
  const [quoted, gpu, gate] = await Promise.all([
    settle(verifyQuote(attested.intel_quote)),
    attested.nvidia_payload ? settle(verifyGpu(attested.nvidia_payload, nonce)) : Promise.resolve(null),
    gateway ? settle(verifyQuote(gateway.intel_quote)) : Promise.resolve(null),
  ]);

  let tdxStatus: string | null = null;
  let composeHash: string | null = null;
  if (quoted.value) {
    const quote = quoted.value;
    tdxStatus = quote.status;
    add("tdx", quote.ok, "A genuine Intel TDX enclave", `The CPU quote verifies against Intel's certificates (status ${quote.status}).`);
    const bound = binding(quote.reportData, signer, nonce);
    add("key_bound", bound.key, "The signing key belongs to that enclave", `The quote's report data holds the key ${short(signer)}, so only code in this enclave can sign with it.`);
    add("nonce_bound", bound.nonce, "The quote itself answers our nonce", "Our nonce sits in the quote's report data, which the hardware signs.");
    const compose = appCompose(attested);
    composeHash = compose ? createHash("sha256").update(compose).digest("hex") : null;
    add(
      "software",
      !!composeHash && quote.mrConfig.startsWith(`01${composeHash}`),
      "Running the software it publishes",
      composeHash ? `The enclave's config hash commits to its published app (sha256 ${short(composeHash)}).` : "The enclave published no app config.",
    );
  } else {
    add("tdx", false, "A genuine Intel TDX enclave", quoteFailure(quoted.error));
  }

  if (!gpu) add("gpu", false, "Genuine NVIDIA confidential-computing GPUs", "The report carried no GPU evidence.");
  else if (gpu.value)
    add(
      "gpu",
      gpu.value.pass && gpu.value.nonceMatches,
      "Genuine NVIDIA confidential-computing GPUs",
      `NVIDIA's attestation service verified evidence from ${gpu.value.gpus} GPU${gpu.value.gpus === 1 ? "" : "s"}${gpu.value.nonceMatches ? ", made for our nonce" : ", but not for our nonce"}.`,
    );
  else add("gpu", false, "Genuine NVIDIA confidential-computing GPUs", `NVIDIA's check failed: ${gpu.error?.message}`);

  if (gateway && gate) {
    if (gate.value) {
      const bound = binding(gate.value.reportData, gateway.signing_address, nonce);
      add(
        "gateway",
        gate.value.ok && bound.key && bound.nonce,
        "The gateway runs in an enclave too",
        `NEAR AI's gateway, which receives the request first, passes the same checks (Intel TDX ${gate.value.status}, key and nonce bound).`,
      );
    } else add("gateway", false, "The gateway runs in an enclave too", quoteFailure(gate.error).replace("The quote", "Its quote"));
  }

  if (want) {
    const run = opts.signerFrom === "run";
    add(
      "signer",
      signer === want,
      run ? "It's the key that signed this run" : "It's the key the vault approved",
      signer === want
        ? run
          ? `The attested key ${short(signer)} is the one that signed every verdict in this run.`
          : `The attested key ${short(signer)} is the one the vault checks every verdict against.`
        : `NEAR AI attests ${short(signer)}, not ${run ? "this run's" : "the vault's"} key ${short(want)}.`,
    );
  }

  return { model, nonce, checked_at, signer, checks, ok: checks.every((c) => c.ok), compose_hash: composeHash, tdx_status: tdxStatus };
}
