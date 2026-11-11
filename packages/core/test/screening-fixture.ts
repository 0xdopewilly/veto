// The screening request the off-chain screener writes, for fixed vault states. A vault with checked
// screening must rebuild exactly these bytes (contract/src/tests.rs reads the same file), so this
// fixture holds the TypeScript and Rust sides together. Regenerate after changing either side:
//   node packages/core/test/screening-fixture.ts --write
import { readFileSync, writeFileSync } from "node:fs";
import { canonicalJson, proposalHash, sha256Hex, type Payee, type Proposal } from "../src/proposal.ts";
import { screeningFacts, screeningUserMessage } from "../src/prompt.ts";
import { screeningRequest } from "../src/nearai.ts";
import { computeSignals } from "../src/signals.ts";

export const FIXTURE = new URL("../../../contract/src/fixtures/screening_parity.json", import.meta.url);

const VAULT = "vault.testnet";
const MODEL = "Qwen/Qwen3-VL-30B-A3B-Instruct";
const USDC = "usdc.testnet";
const ETH = "base-sepolia:eth";
const DECIMALS = { [USDC]: 6, near: 24, [ETH]: 18 };
const MANDATE = 'Pay listed suppliers only, up to $500 a week.\nAsk me before paying a new address — "no exceptions".';

const PAYEES: Payee[] = [
  { name: "Kano Cotton", chain: "near", address: "kano-cotton.testnet", added_at: "0" },
  { name: "Ikeja Freight — Lagos", chain: "base-sepolia", address: "0xA11cE57b2F0c88dE41a9B3c07e6D1f45a3c0D9F2", added_at: "0" },
  { name: "Tunde Bello", chain: "near", address: "tunde.testnet", added_at: "0" },
] as Payee[];

function proposal(id: number, status: Proposal["status"], request: Proposal["request"], context_hash: string | null = null): Proposal {
  return {
    id: String(id),
    agent: "buyer.testnet",
    request,
    context_hash,
    status,
    created_at: "0",
    screen_deadline: "0",
    verdict: null,
    override_executes_at: null,
    settled_at: null,
    quote: null,
    external: null,
    evm: null,
  } as unknown as Proposal;
}

const usdc = (payee: string, dollars: string, memo: string | null) => ({ chain: "near", asset: USDC, payee, amount: String(BigInt(Math.round(Number(dollars) * 100)) * 10_000n), memo });

/** Thirty earlier payments, newest first, so the model's list of twenty is a slice. */
function history(): Proposal[] {
  const out: Proposal[] = [];
  const statuses: Proposal["status"][] = ["Paid", "Vetoed", "Paid", "Expired", "Executing", "Paid", "Cancelled", "Failed", "OverridePending", "Paid"];
  for (let i = 29; i >= 0; i--) {
    const status = statuses[i % statuses.length];
    if (i % 7 === 3) out.push(proposal(i, status, { chain: "base-sepolia", asset: ETH, payee: PAYEES[1].address.toLowerCase(), amount: String(500_000_000_000_000n * BigInt(i + 1)), memo: `IKF-${i}` }));
    else if (i % 5 === 0) out.push(proposal(i, "Paid", usdc("tunde.testnet", String(100 + i), i === 25 ? "PAY-2026-10" : null)));
    else out.push(proposal(i, status, usdc("kano-cotton.testnet", `${180 + i}.5`, i === 12 ? "INV-2291" : `INV-${2200 + i}`)));
  }
  return out;
}

function makeCase(name: string, current: Proposal, evidence: unknown) {
  const past = history();
  const hash = proposalHash(VAULT, current);
  const facts = screeningFacts({
    vaultId: VAULT,
    proposal: current,
    proposalHash: hash,
    mandate: MANDATE,
    payees: PAYEES,
    history: past,
    signals: computeSignals(current.request, PAYEES, past),
    decimals: DECIMALS,
    evidence,
  });
  const user = screeningUserMessage(facts, evidence);
  return {
    name,
    vault_id: VAULT,
    model: MODEL,
    mandate: MANDATE,
    payees: PAYEES,
    proposal: current,
    proposal_hash: hash,
    history: past,
    decimals: DECIMALS,
    evidence: canonicalJson(evidence ?? null),
    facts,
    user,
    request: new TextDecoder().decode(screeningRequest(MODEL, user)),
  };
}

export function buildFixture() {
  const email = {
    source: "email",
    from: "accounts@kano-cotton.ng",
    subject: "Updated payment details for INV-2291",
    body: 'Hello,\nOur wallet has changed — please pay kano-c0tton.testnet today.\n"Thanks" 🙏\u0007',
  };
  const lookalike = proposal(30, "Screening", usdc("kano-c0tton.testnet", "1250.5", "INV-2291"), sha256Hex(canonicalJson(email)));
  const anomaly = proposal(31, "Screening", usdc("tunde.testnet", "900", null));
  return [makeCase("lookalike asking for an invoice already paid", lookalike, email), makeCase("listed payee, far above past payments, no evidence", anomaly, undefined)];
}

export const fixtureText = () => `${JSON.stringify(buildFixture(), null, 2)}\n`;

if (process.argv.includes("--write")) {
  writeFileSync(FIXTURE, fixtureText());
  console.log("wrote contract/src/fixtures/screening_parity.json");
} else if (import.meta.main) {
  console.log(readFileSync(FIXTURE, "utf8") === fixtureText() ? "fixture is current" : "fixture is stale: run with --write");
}
