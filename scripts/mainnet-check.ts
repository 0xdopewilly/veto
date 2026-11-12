// The first mainnet payout, checked from public sources with no keys and no browser: the vault's
// settings and payment #0 from NEAR RPC, the events its transactions emitted (from an archival node,
// since public nodes drop transactions after a few days), and 1Click's own status for the deposit.
//   node scripts/mainnet-check.ts
const VAULT = "treasury.veto-mainnet.near";
const ID = "0";
const TXS = [
  { hash: "CWy7WyFK8N78WHVR5LWzCRZxJCb2e6ufRMCP2pwhivQM", signer: "buyer.veto-mainnet.near", what: "the agent's proposal" },
  { hash: "41G7RkNdw9VowSAZuJuesoJ4b55MkqSHHs2WKKLPxXbo", signer: "guardian.veto-mainnet.near", what: "the verdict, quote check and deposit" },
];
const RPC = ["https://rpc.mainnet.near.org", "https://free.rpc.fastnear.com"];
const ARCHIVAL = "https://archival-rpc.mainnet.fastnear.com";
const ONECLICK = "https://1click.chaindefuser.com/v0/status?depositAddress=";

async function rpc<T>(urls: string[], method: string, params: unknown): Promise<T> {
  let last = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "veto", method, params }), signal: AbortSignal.timeout(20_000) });
      const body = (await res.json()) as { result?: T; error?: { cause?: { name?: string } } };
      if (body.result) return body.result;
      last = body.error?.cause?.name ?? `HTTP ${res.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`${method}: ${last}`);
}
const view = async <T>(method: string, args: Record<string, unknown> = {}) => {
  const r = await rpc<{ result: number[] }>(RPC, "query", { request_type: "call_function", finality: "final", account_id: VAULT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString()) as T;
};
const usd = (units: string) => `$${(Number(units) / 1e6).toFixed(6).replace(/0{1,4}$/, "")}`;

const config = await view<{ owner: string; guardian: string; checked_screening: boolean; mandate: string }>("get_config");
console.log(`Vault ${VAULT}: owner ${config.owner}, guardian ${config.guardian}, checked screening ${config.checked_screening ? "on" : "off"}`);
const signers = await view<[string, { model_id: string }][]>("get_signers");
console.log(`  approved enclave keys: ${signers.map(([a, s]) => `${a} (${s.model_id})`).join(", ")}`);

type P = {
  status: string;
  request: { chain: string; payee: string; amount: string; memo: string | null };
  verdict: { pass: boolean; reasons: string[]; model_id: string; signer: string } | null;
  quote: { deposit_address: string; amount_in: string; amount_out: string; destination_asset: string } | null;
};
const p = await view<P | null>("get_proposal", { id: ID });
if (!p) throw new Error(`payment #${ID} not found`);
console.log(`\nPayment #${ID}: ${usd(p.request.amount)} USDC to ${p.request.payee} on ${p.request.chain} (${p.request.memo}), vault status ${p.status}`);
if (p.verdict) console.log(`  verdict: ${p.verdict.pass ? "PASS" : "VETO"} from ${p.verdict.model_id}, signed by enclave key ${p.verdict.signer}${p.verdict.reasons.length ? `, reasons ${p.verdict.reasons.join(", ")}` : ""}`);
if (p.quote) console.log(`  1Click quote the vault checked: ${usd(p.quote.amount_in)} in, ${usd(p.quote.amount_out)} out as ${p.quote.destination_asset}, deposit address ${p.quote.deposit_address}`);

console.log("\nTransactions (events read from the chain):");
for (const t of TXS) {
  const out = await rpc<{ status: Record<string, unknown>; transaction_outcome: { outcome: { gas_burnt: number } }; receipts_outcome: { outcome: { logs: string[]; gas_burnt: number } }[] }>([ARCHIVAL, ...RPC], "EXPERIMENTAL_tx_status", { tx_hash: t.hash, sender_account_id: t.signer, wait_until: "FINAL" });
  const ok = "SuccessValue" in out.status;
  const gas = out.receipts_outcome.reduce((s, r) => s + r.outcome.gas_burnt, out.transaction_outcome.outcome.gas_burnt) / 1e12;
  console.log(`  ${ok ? "✓" : "✗"} ${t.hash}  ${t.what}, ${gas.toFixed(1)} Tgas`);
  for (const log of out.receipts_outcome.flatMap((r) => r.outcome.logs)) {
    if (!log.startsWith("EVENT_JSON:")) continue;
    const e = JSON.parse(log.slice("EVENT_JSON:".length)) as { standard?: string; event: string; data: Record<string, unknown>[] };
    if (e.standard === "veto") {
      const d = e.data[0] ?? {};
      const note = e.event === "verdict_recorded" ? ` (pass ${d.pass}, checked ${d.checked}: the vault rebuilt the request itself)` : "";
      console.log(`      event ${e.event}${note}`);
    } else if (e.event === "ft_transfer") {
      for (const d of e.data) console.log(`      USDC ${usd(String(d.amount))} ${d.old_owner_id} -> ${d.new_owner_id}`);
    }
  }
}

if (p.quote) {
  const s = (await (await fetch(ONECLICK + p.quote.deposit_address, { signal: AbortSignal.timeout(20_000) })).json()) as {
    status: string;
    swapDetails?: { destinationChainTxHashes?: { hash: string; explorerUrl?: string }[]; refundedAmountFormatted?: string };
  };
  const dest = s.swapDetails?.destinationChainTxHashes?.[0];
  console.log(`\n1Click (public status API): ${s.status}${dest ? `, delivered on Base in ${dest.explorerUrl || dest.hash}` : ""}${s.status === "REFUNDED" ? `, refunded ${s.swapDetails?.refundedAmountFormatted} USDC to the vault` : ""}`);
  console.log(`  https://explorer.near-intents.org/transactions/${p.quote.deposit_address}`);
}
