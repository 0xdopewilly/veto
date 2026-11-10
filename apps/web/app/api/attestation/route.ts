// Verifies NEAR AI's enclave for a model, from scratch and with a fresh nonce: the Intel TDX quote
// against Intel's certificates, NVIDIA's GPU evidence, that the quote binds the signing key and the
// nonce, the published app, the gateway, and that the attested key is the one a verdict was signed
// by. Keyless; the proof page calls it. A result is shared for a minute, so a crowd of viewers asks
// Intel and NVIDIA once; `fresh=1` (the panel's Check again) always runs a new check with a new nonce.
import { isNearAiUnavailable } from "@veto/core";
import { verifyEnclave, type EnclaveVerification } from "@veto/core/attest";
import { allow, visitor } from "@/lib/server/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; result: Promise<EnclaveVerification> }>();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const model = url.searchParams.get("model") ?? "";
  const signer = (url.searchParams.get("signer") ?? "").toLowerCase();
  if (!/^[\w.-]+\/[\w.-]+$/.test(model) || model.length > 100) return Response.json({ error: "Give a model id, like Qwen/Qwen3-VL-30B-A3B-Instruct." }, { status: 400 });
  if (signer && !/^0x[0-9a-f]{40}$/.test(signer)) return Response.json({ error: "The signer must be a 0x address." }, { status: 400 });

  const key = `${model}|${signer}`;
  const hit = cache.get(key);
  const fresh = url.searchParams.get("fresh") === "1";
  if (fresh && !allow(`attest:${visitor(req)}`, 6, 10 * 60_000)) {
    return Response.json({ error: "You've run several fresh checks just now. Try again in a few minutes." }, { status: 429 });
  }
  if (fresh || !hit || Date.now() - hit.at > FRESH_MS) {
    const result = verifyEnclave(model, { expectSigner: signer || undefined });
    cache.set(key, { at: Date.now(), result });
    // A failed run shouldn't be served to the next viewer.
    result.catch(() => cache.delete(key));
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
  }
  try {
    return Response.json(await cache.get(key)!.result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isNearAiUnavailable(e)) {
      return Response.json(
        { error: "NEAR AI Cloud isn't serving this enclave right now, so it can't be checked live. Each verdict's signature still checks out against the key the vault approved." },
        { status: 503 },
      );
    }
    return Response.json({ error: `Couldn't reach NEAR AI's attestation service: ${(e as Error).message}` }, { status: 502 });
  }
}
