// Re-checks a Veto Bench run offline, no API key needed: for every scenario it rehashes the
// stored request and response bytes, rebuilds the signed text, recovers the signer from the
// signature, and checks it is the one key the run recorded for the model.
//   node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json
// With --attested it also asks NEAR AI's public attestation endpoint (no key needed) which key the
// model's enclave holds now, and checks the run's signer is that key.
//   node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested
import { readFileSync } from "node:fs";
import { verifyMessage } from "ethers";
import { modelAttestation, parseVerdict, sha256Hex } from "@veto/core";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const checkAttested = process.argv.includes("--attested");
if (!file) throw new Error("usage: node bench/verify.ts <results file> [--attested]");
const { summary, results } = JSON.parse(readFileSync(file, "utf8"));
if (!summary.signer) {
  console.log(`${summary.display}: a deterministic baseline with no model, so there are no signatures to verify.`);
  process.exit(0);
}
let ok = 0;
const problems: string[] = [];

for (const r of results) {
  if (!r.signature) {
    problems.push(`${r.id}: no signature (${r.verdict})`);
    continue;
  }
  const request = Buffer.from(r.request_b64, "base64");
  const response = Buffer.from(r.response_b64, "base64");
  const text = `${summary.model}:${sha256Hex(request)}:${sha256Hex(response)}`;
  if (text !== r.signed_text) {
    problems.push(`${r.id}: bytes do not match the signed text`);
    continue;
  }
  if (verifyMessage(text, r.signature).toLowerCase() !== summary.signer) {
    problems.push(`${r.id}: signature is not from the run's signer`);
    continue;
  }
  const content = JSON.parse(response.toString()).choices?.[0]?.message?.content;
  if (parseVerdict(content).verdict !== r.verdict) {
    problems.push(`${r.id}: recorded verdict differs from the signed response`);
    continue;
  }
  ok++;
}

console.log(`${ok}/${results.length} verdicts verified against ${summary.signer} (${summary.model})`);
for (const p of problems) console.log(`  ${p}`);

if (checkAttested) {
  // The attestation report binds the enclave's signing key to a TEE quote for this nonce.
  const { nonce, report } = await modelAttestation(summary.model);
  const keys = (report.model_attestations ?? []).filter((m: { request_nonce?: string; signing_algo?: string }) => m.request_nonce === nonce && m.signing_algo === "ecdsa");
  const attested = keys.map((k: { signing_address: string }) => String(k.signing_address).toLowerCase());
  if (attested.includes(summary.signer)) {
    console.log(`NEAR AI's attestation for ${summary.model} reports ${summary.signer} now: the run's signer is the enclave's key.`);
  } else {
    console.log(`NEAR AI now attests ${attested.join(", ") || "no ecdsa key"} for ${summary.model}, not ${summary.signer}. An enclave restart rotates its key, so an older run can differ.`);
    problems.push("signer is not the key attested now");
  }
}
process.exitCode = problems.length ? 1 : 0;
