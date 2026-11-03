// Re-checks a Veto Bench run offline, no API key needed: for every scenario it rehashes
// the stored request and response bytes, rebuilds the signed text, recovers the signer
// from the signature and checks it matches the model's attested key.
//   node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json
import { readFileSync } from "node:fs";
import { verifyMessage } from "ethers";
import { parseVerdict, sha256Hex } from "@veto/core";

const file = process.argv[2];
if (!file) throw new Error("usage: node bench/verify.ts <results file>");
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
    problems.push(`${r.id}: signature is not from the attested key`);
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
process.exitCode = problems.length ? 1 : 0;
