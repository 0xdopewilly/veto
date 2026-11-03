// Runs every demo flow against a deployment and checks each ends the way it should: the vault
// path, the OutLayer path and the Base payout, passes and vetoes, every verdict signed by the
// model in its enclave (not the fallback test key). Exits non-zero if anything is off.
//   node scripts/demo-check.ts [https://veto-beta.vercel.app]
const base = process.argv[2] ?? "http://localhost:3000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Proposal {
  id: string;
  status: string;
  verdict: { model_id: string; signer: string; reasons: string[] } | null;
  external?: { tx_hash: string | null } | null;
  evm?: { tx_hash: string | null } | null;
}

const info = (await (await fetch(`${base}/api/demo`)).json()) as {
  vault: string;
  guardian: { model: string };
  outlayer: unknown;
  scenarios: { id: string; expect: "pass" | "veto"; symbol?: string }[];
};
const rpc = async (method: string, args: Record<string, unknown>) => {
  const res = await fetch(`${base}/api/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "query",
      params: { request_type: "call_function", finality: "optimistic", account_id: info.vault, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
    }),
  });
  const body = (await res.json()) as { result: { result: number[] } };
  return JSON.parse(Buffer.from(body.result.result).toString());
};

console.log(`${base}: vault ${info.vault}, screened by ${info.guardian.model}`);
const plan: [string, "vault" | "outlayer", "pass" | "veto"][] = [];
for (const s of info.scenarios) plan.push([s.id, "vault", s.expect]);
if (info.outlayer) {
  plan.push(["invoice", "outlayer", "pass"]);
  plan.push(["injected-page", "outlayer", "veto"]);
}

let failures = 0;
for (const [scenario, via, expect] of plan) {
  const started = Date.now();
  const res = await fetch(`${base}/api/demo/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, via }) });
  const body = (await res.json()) as { proposal_id?: string; error?: string };
  if (!res.ok || !body.proposal_id) {
    console.log(`✗ ${scenario} via ${via}: ${body.error ?? res.status}`);
    failures++;
    continue;
  }
  let p: Proposal = await rpc("get_proposal", { id: body.proposal_id });
  for (let i = 0; i < 120 && ["Screening", "Executing"].includes(p.status); i++) {
    await sleep(1000);
    p = await rpc("get_proposal", { id: body.proposal_id });
  }
  const want = expect === "pass" ? "Paid" : "Vetoed";
  const enclave = p.verdict && !p.verdict.model_id.startsWith("veto-dev/");
  const settled = want !== "Paid" || via === "vault" ? (p.evm ? Boolean(p.evm.tx_hash) : true) : Boolean(p.external?.tx_hash);
  const ok = p.status === want && enclave && settled;
  if (!ok) failures++;
  const why = p.verdict?.reasons.length ? ` (${p.verdict.reasons.join(", ")})` : "";
  console.log(
    `${ok ? "✓" : "✗"} ${`${scenario} via ${via}`.padEnd(30)} #${p.id} ${p.status.padEnd(8)}${why} ${((Date.now() - started) / 1000).toFixed(1)} s` +
      `${enclave ? "" : "  [signed by the fallback test key]"}${settled ? "" : "  [not settled]"}`,
  );
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nEvery flow behaved as expected.");
process.exit(failures ? 1 : 0);
