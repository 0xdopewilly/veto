// Runs every demo flow against a deployment and checks each ends the way it should: the vault
// path, the OutLayer path, the Base payout and the NEAR Intents Agent API wallet, passes and
// vetoes, every verdict signed by the model in its enclave (not the fallback test key). Exits
// non-zero if anything is off. An Agent API pass counts once Veto has sent it with its grant: paid,
// or refused only for lack of funds while the wallet holds no USDC.
//   node scripts/demo-check.ts [https://veto-beta.vercel.app] [--vault <id>] [--only payroll,payroll-diverted] [--agentapi-only]
// With --vault it checks a vault the factory created (the agent's inbox only; owned vaults have
// no OutLayer wallet or Base route).
const args = process.argv.slice(2);
const vaultArg = args.includes("--vault") ? args[args.indexOf("--vault") + 1] : undefined;
// --only runs just these inbox scenarios; --agentapi-only runs only the Agent API path.
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const agentApiOnly = args.includes("--agentapi-only");
const base = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--vault" && args[i - 1] !== "--only") ?? "http://localhost:3000";
const query = vaultArg ? `?vault=${encodeURIComponent(vaultArg)}` : "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Proposal {
  id: string;
  status: string;
  verdict: { model_id: string; signer: string; reasons: string[] } | null;
  external?: { tx_hash: string | null } | null;
  evm?: { tx_hash: string | null } | null;
}

const info = (await (await fetch(`${base}/api/demo${query}`)).json()) as {
  vault: string;
  guardian: { model: string };
  outlayer: unknown;
  agentapi?: unknown;
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
for (const s of info.scenarios) if (!agentApiOnly && (!only || only.includes(s.id))) plan.push([s.id, "vault", s.expect]);
if (only && !agentApiOnly && plan.length < only.length) {
  console.log(`✗ not in the inbox: ${only.filter((id) => !plan.some(([s]) => s === id)).join(", ")}`);
  process.exit(1);
}
if (info.outlayer && !only && !agentApiOnly) {
  plan.push(["invoice", "outlayer", "pass"]);
  plan.push(["injected-page", "outlayer", "veto"]);
}

let failures = 0;
for (const [scenario, via, expect] of plan) {
  const started = Date.now();
  const res = await fetch(`${base}/api/demo/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, via, vault: info.vault }) });
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
// The Agent API wallet (sandbox only): its result comes back in the response, no vault proposal.
if (info.agentapi && (!only || agentApiOnly)) {
  // The payroll pair runs here as a USDC salary withdrawn to Base through NEAR Intents.
  const aaPlan = (
    [
      ["invoice", "pass"],
      ["wallet-changed", "veto"],
      ["duplicate", "veto"],
      ["payroll", "pass"],
      ["payroll-diverted", "veto"],
    ] as const
  ).filter(([id]) => {
    // The same emails the inbox offers on this path: a payout on another chain only when it has an Agent API
    // version (once this month's salary is paid, the repeat runs on the vault path only).
    const s = info.scenarios.find((x) => x.id === id) as { symbol?: string; agentapi?: unknown } | undefined;
    return !!s && (!s.symbol || !!s.agentapi) && (!only || only.includes(id));
  });
  for (const [scenario, expect] of aaPlan) {
    const started = Date.now();
    const res = await fetch(`${base}/api/demo/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, via: "agentapi", vault: info.vault }) });
    const body = (await res.json()) as {
      error?: string;
      agentapi?: {
        verdict: { verdict: string; reasons: string[]; model: string; approved_signer: boolean };
        execution: { kind: string; code?: string; status?: string };
        request: { amount: string };
      };
    };
    const a = body.agentapi;
    if (!res.ok || !a) {
      console.log(`✗ ${scenario} via agentapi: ${body.error ?? res.status}`);
      failures++;
      continue;
    }
    // A withdrawal to another chain can still be on its way when the call returns.
    const sent = a.execution.kind === "sent" && ["SUCCESS", "PROCESSING", "QUEUED"].includes(a.execution.status ?? "");
    const unfunded = a.execution.kind === "refused" && a.execution.code === "insufficient_balance";
    const ok = a.verdict.approved_signer && (expect === "pass" ? a.verdict.verdict === "PASS" && (sent || unfunded) : a.verdict.verdict === "VETO" && a.execution.kind === "skipped");
    if (!ok) failures++;
    const what = a.execution.kind === "sent" ? `sent: ${a.execution.status}` : a.execution.kind === "refused" ? `refused: ${a.execution.code}` : "not sent";
    const why = a.verdict.reasons.length ? ` (${a.verdict.reasons.join(", ")})` : "";
    console.log(`${ok ? "✓" : "✗"} ${`${scenario} via agentapi`.padEnd(30)} ${a.verdict.verdict.padEnd(8)}${why} $${(Number(a.request.amount) / 1e6).toFixed(6).replace(/0{1,4}$/, "")}, ${what} ${((Date.now() - started) / 1000).toFixed(1)} s${unfunded ? "  [the wallet holds no USDC]" : ""}`);
  }
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nEvery flow behaved as expected.");
process.exit(failures ? 1 : 0);
