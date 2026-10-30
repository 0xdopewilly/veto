import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, computeSignals, lookalike, parseVerdict, proposalHash, type Payee, type Proposal } from "../src/index.ts";

const KANO = "0xA11cE57b2F0c88dE41a9B3c07e6D1f45a3c0D9F2";
const POISONED = "0xA11cE5f09d3B7a21Cc04e8F5b6A0d92e71B1D9F2";

const request = { chain: "near", asset: "usdc.testnet", payee: "kano-cotton.testnet", amount: "300000000", memo: "INV-2291" };

test("proposal hash matches the contract (contract/src/tests.rs proposal_hash_is_stable)", () => {
  assert.equal(
    proposalHash("vault.testnet", { id: "0", request, context_hash: null }),
    "b834b56725f712fb48348615f1591cd9b136ab43e384138e4592b5435dd5f5d5",
  );
});

test("address poisoning is flagged as a lookalike", () => {
  assert.match(lookalike(POISONED.toLowerCase(), KANO.toLowerCase()) ?? "", /first 6 and last 4/);
  assert.equal(lookalike(KANO.toLowerCase(), KANO.toLowerCase()), null);
  assert.equal(lookalike("0x1111111111111111111111111111111111111111", KANO.toLowerCase()), null);
});

test("lookalike NEAR names are flagged", () => {
  assert.ok(lookalike("kano-cottom.testnet", "kano-cotton.testnet"));
  assert.ok(lookalike("kano-c0tton.testnet", "kano-cotton.testnet"));
  assert.equal(lookalike("ibadan-dye.testnet", "kano-cotton.testnet"), null);
});

test("signals for the demo payment", () => {
  const payees: Payee[] = [{ name: "Kano Cotton Mills", chain: "base", address: KANO, added_at: "0" }];
  const paid = (id: string, memo: string): Proposal => ({
    id,
    agent: "buyer.testnet",
    request: { chain: "base", asset: "usdc", payee: KANO, amount: "180000000", memo },
    context_hash: null,
    status: "Paid",
    created_at: "0",
    screen_deadline: "0",
    verdict: null,
    override_executes_at: null,
    settled_at: null,
  });
  const signals = computeSignals(
    { chain: "base", asset: "usdc", payee: POISONED, amount: "300000000", memo: "INV-2288" },
    payees,
    [paid("1", "INV-2288"), paid("2", "INV-2271")],
  );
  assert.deepEqual(signals.map((s) => s.code).sort(), ["DUPLICATE_INVOICE", "LOOKALIKE_ADDRESS", "NEW_PAYEE"]);
});

test("canonical JSON sorts keys and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 0 }], c: undefined } }), '{"a":{"d":[2,{"y":0,"z":1}]},"b":1}');
});

test("verdict parsing tolerates code fences", () => {
  const v = parseVerdict('```json\n{"proposal_id":"4","proposal_hash":"ab","verdict":"VETO","reasons":["NEW_PAYEE"]}\n```');
  assert.deepEqual(v, { proposal_id: "4", proposal_hash: "ab", verdict: "VETO", reasons: ["NEW_PAYEE"] });
  assert.throws(() => parseVerdict('{"verdict":"MAYBE"}'));
});
