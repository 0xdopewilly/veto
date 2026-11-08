// Re-checks a Veto Bench run offline, no API key needed: for every scenario it rehashes the
// stored request and response bytes, rebuilds the signed text, recovers the signer from the
// signature, and checks it is the one key the run recorded for the model.
//   node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json
// With --attested it also verifies NEAR AI's enclave from scratch, with a fresh nonce and no key: the
// Intel TDX quote against Intel's certificates, the NVIDIA GPU evidence with NVIDIA's service, that
// the quote binds the signing key and our nonce, that it runs its published app, the gateway's
// enclave, and that the attested key is the run's signer.
//   node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested
import { readFileSync } from "node:fs";
import { verifyMessage } from "ethers";
import { parseVerdict, sha256Hex } from "@veto/core";
import { verifyEnclave } from "@veto/core/attest";

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
  const enclave = await verifyEnclave(summary.model, { expectSigner: summary.signer, signerFrom: "run" });
  console.log(`\nNEAR AI's enclave for ${summary.model}, checked now with nonce ${enclave.nonce.slice(0, 12)}…:`);
  for (const c of enclave.checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.title}. ${c.detail}`);
  if (!enclave.ok) {
    if (enclave.signer && enclave.signer !== summary.signer) console.log("  An enclave restart rotates its key, so an older run can differ.");
    problems.push("the enclave check failed");
  }
}
process.exitCode = problems.length ? 1 : 0;
