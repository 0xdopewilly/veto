import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Transaction, Wallet } from "ethers";
import { blockingIncident, canonicalJson, computeSignals, lookalike, lookalikeEvmAddress, parseVerdict, paymentFromApproval, proposalHash, sha256Hex, signedPayout, USDC, type Approval, type Payee, type Proposal } from "../src/index.ts";
import { checkQuote, composeMatches, quoteBinding } from "../src/attest.ts";

const KANO = "0xA11cE57b2F0c88dE41a9B3c07e6D1f45a3c0D9F2";
const POISONED = "0xA11cE5f09d3B7a21Cc04e8F5b6A0d92e71B1D9F2";

const request = { chain: "near", asset: "usdc.testnet", payee: "kano-cotton.testnet", amount: "300000000", memo: "INV-2291" };

test("proposal hash matches the contract (contract/src/tests.rs proposal_hash_is_stable)", () => {
  assert.equal(
    proposalHash("vault.testnet", { id: "0", request, context_hash: null }),
    "b834b56725f712fb48348615f1591cd9b136ab43e384138e4592b5435dd5f5d5",
  );
});

test("external payment hash matches the contract (contract/src/tests.rs external_hash_binds_the_approval)", () => {
  const external = {
    provider: "outlayer",
    wallet: "9717ac438a948ce5a42f766ea07352892f76fefc9346adfde3ff57d407350988",
    approval_id: "appr-1",
    op_hash: "87427b8b0c1f3a5e9d2b4c6a8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f",
    tx_hash: null,
  };
  assert.equal(
    proposalHash("vault.testnet", { id: "0", request, context_hash: null, external }),
    "4206ccce7c38c2caeefafb2ea0073b28234f19eefc61243f48bfbe4ec2cf12af",
  );
});

test("address poisoning is flagged as a lookalike", () => {
  assert.match(lookalike(POISONED.toLowerCase(), KANO.toLowerCase()) ?? "", /first 6 and last 4/);
  assert.equal(lookalike(KANO.toLowerCase(), KANO.toLowerCase()), null);
  assert.equal(lookalike("0x1111111111111111111111111111111111111111", KANO.toLowerCase()), null);
});

test("the payroll scam's address is a lookalike of the worker's, never the same", () => {
  const worker = "0x3d9772bcE39B2896DA9954d851173032B41519B8";
  const decoy = lookalikeEvmAddress(worker);
  assert.notEqual(decoy.toLowerCase(), worker.toLowerCase());
  assert.equal(decoy.slice(0, 8).toLowerCase(), worker.slice(0, 8).toLowerCase());
  assert.equal(decoy.slice(-6).toLowerCase(), worker.slice(-6).toLowerCase());
  assert.ok(lookalike(decoy.toLowerCase(), worker.toLowerCase()));
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

const WALLET_PUBKEY = "ed25519:583d89b1a496f19ea9d11888b77b1cd3a62bb8d2a495eeaf35a72004e6dffae2";
function approvalFor(op: Record<string, unknown>): Approval {
  const op_canonical = canonicalJson(op);
  return {
    id: "8a5202ac-91bf-472d-9f51-7c189763aa03",
    wallet_id: "w",
    status: "pending",
    required_approvals: 1,
    request_hash: sha256Hex(op_canonical),
    op: op as Approval["op"],
    op_canonical,
    wallet_pubkey: WALLET_PUBKEY,
    expires_at: "",
  };
}

test("an OutLayer ft_transfer approval decodes to the payment it would make", () => {
  const args = { receiver_id: "kano-cotton.testnet", amount: "180000000", memo: "INV-2290" };
  const approval = approvalFor({
    kind: "call",
    to: "usdc.testnet",
    method: "ft_transfer",
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    deposit: "1",
    gas: "30000000000000",
  });
  assert.deepEqual(paymentFromApproval(approval), { chain: "near", asset: "usdc.testnet", payee: "kano-cotton.testnet", amount: "180000000", memo: "INV-2290" });
});

test("an OutLayer native transfer decodes, and a doctored operation is refused", () => {
  const approval = approvalFor({ kind: "transfer", to: "kano-cotton.testnet", amount: "10000000000000000000000" });
  assert.equal(paymentFromApproval(approval).asset, "near");
  const doctored = { ...approval, op_canonical: approval.op_canonical.replace("kano-cotton", "kano-cottom") };
  assert.throws(() => paymentFromApproval(doctored), /does not match/);
  const other = approvalFor({ kind: "call", to: "usdc.testnet", method: "ft_transfer_call", args_base64: "e30=", deposit: "1" });
  assert.throws(() => paymentFromApproval(other), /unsupported/);
});

test("a Shield incident on the payout's route holds it; unrelated ones don't", () => {
  const route = { token: "usdc.near", origin_asset: USDC.near, destination_asset: USDC.base, max_fee_bps: 100 };
  const payout = { chain: "base", asset: "usdc.near", payee: "0xa11ce57b2f0c88de41a9b3c07e6d1f45a3c0d9f2", amount: "5000000", memo: null };
  const hit = (scopeType: string, scopeValue: string, direction?: string) => blockingIncident([{ scopeType, scopeValue, direction }], route, payout);
  assert.ok(hit("chain", "base", "withdraw"));
  assert.ok(hit("token", USDC.base));
  assert.ok(hit("bridge", "poa"));
  assert.ok(hit("address", "0xA11CE57B2F0C88DE41A9B3C07E6D1F45A3C0D9F2"));
  assert.equal(hit("chain", "eth", "withdraw"), undefined);
  assert.equal(hit("chain", "base", "deposit"), undefined);
});

test("a Chain Signatures payout rebuilds into a valid transaction, high-s or not", () => {
  // Stand-in for the MPC network: a known key signs the hash the vault computed.
  const vaultKey = new Wallet("0x" + "42".repeat(32));
  const to = "0xa11ce57b2f0c88de41a9b3c07e6d1f45a3c0d9f2";
  const unsigned = Transaction.from({ type: 2, chainId: 84532, nonce: 7, maxPriorityFeePerGas: 1000000n, maxFeePerGas: 2000000000n, gasLimit: 21000, to, value: 500000000000000n, data: "0x", accessList: [] });
  // Pinned in contract/src/tests.rs (evm_signing_hash_matches_ethers).
  assert.equal(unsigned.unsignedHash, "0x7ae3a6a90694a58a8cdad8a8a62b0bd681ccf3d2bf8e375d8b6f7645a775e57f");
  const sig = vaultKey.signingKey.sign(unsigned.unsignedHash);
  const proposal = (r: string, s: string, y: number) =>
    ({
      id: "0",
      request: { chain: "base-sepolia", asset: "base-sepolia:eth", payee: to, amount: "500000000000000", memo: null },
      status: "Executing",
      evm: { chain_id: "84532", nonce: "7", max_fee_per_gas: "2000000000", max_priority_fee_per_gas: "1000000", signing_hash: unsigned.unsignedHash.slice(2), r, s, y_parity: y, tx_hash: null },
    }) as unknown as Proposal;
  const tx = signedPayout(proposal(sig.r.slice(2), sig.s.slice(2), sig.yParity), vaultKey.address);
  assert.equal(tx.from, vaultKey.address);
  // The same signature in its high-s form (as an MPC network may return it) is normalised.
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = (n - BigInt(sig.s)).toString(16).padStart(64, "0");
  const flipped = signedPayout(proposal(sig.r.slice(2), highS, sig.yParity ^ 1), vaultKey.address);
  assert.equal(flipped.serialized, tx.serialized);
  assert.throws(() => signedPayout(proposal(sig.r.slice(2), sig.s.slice(2), sig.yParity), "0x000000000000000000000000000000000000dEaD"), /vault's address/);
});

// NEAR Intents Agent API: the official test vectors from github.com/NEAR-Intents-Agent-API/skills.
test("agent api grant credentials match the official vector", async () => {
  const { createGrantCredential } = await import("../src/agentapi.ts");
  const { token, commitment } = createGrantCredential(new Uint8Array(32).fill(9));
  assert.equal(token, "ngt_CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk");
  assert.equal(commitment, "d632d3d1f5df65812a61000fa4cca20cce14fe14a2e3fe5d3e6bab1a445fc43f");
});

test("agent api EVM owner and EIP-712 signature match the official vector", async () => {
  const { evmOwner, signEvmIntent } = await import("../src/agentapi.ts");
  const v = {"private_key": "0x1111111111111111111111111111111111111111111111111111111111111111", "address": "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a", "public_key": "0x4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa385b6b1b8ead809ca67454d9683fcf2ba03456d6fe2c4abe2b07f0fbdbb2f1c1", "payload": {"types": {"EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"}], "WalletMessage": [{"name": "chainId", "type": "string"}, {"name": "signerId", "type": "string"}, {"name": "nonce", "type": "uint32"}, {"name": "createdAt", "type": "string"}, {"name": "timeoutSecs", "type": "uint32"}, {"name": "ops", "type": "string"}, {"name": "out", "type": "string"}]}, "primaryType": "WalletMessage", "domain": {"name": "NEAR Wallet Contract", "version": "1"}, "message": {"chainId": "mainnet", "signerId": "0s1234.near", "nonce": 42, "createdAt": "2026-10-07T00:00:00.000Z", "timeoutSecs": 300, "ops": "[]", "out": "{\"after\":[]}"}}, "signature": "0x011bb890ad576627ab6dbce119777912693a1bb16ef0dcd673d08198108cb5b245a4db114560088db56b209680788b4b5d02fcd933947b01912f59da6c1d62111c"};
  const owner = evmOwner(v.private_key);
  assert.equal(owner.address, v.address);
  assert.equal(owner.public_key, v.public_key);
  const signed = await signEvmIntent(v.private_key, { intent: { standard: "eip712", payload: v.payload } });
  assert.equal(signed.signature, v.signature);
});

// A real NEAR AI Cloud attestation for the model key the vaults approve, captured with our nonce,
// with the Intel collateral it verified against: the quote checks run offline at that moment.
const enclave = JSON.parse(readFileSync(new URL("./fixtures/nearai-attestation.json", import.meta.url), "utf8")) as {
  nonce: string;
  checked_at: number;
  signing_address: string;
  intel_quote: string;
  app_compose: string;
  collateral: unknown;
};

test("a real NEAR AI enclave quote verifies against Intel's collateral and binds the model key and our nonce", async () => {
  const quote = await checkQuote(enclave.intel_quote, enclave.collateral, BigInt(enclave.checked_at));
  assert.ok(quote.ok, quote.status);
  assert.deepEqual(quoteBinding(quote.reportData, enclave.signing_address, enclave.nonce), { key: true, nonce: true });
  assert.ok(composeMatches(quote.mrConfig, enclave.app_compose), "mr_config commits to the published app");
  // Another key, another nonce or another app config is not what the hardware signed.
  assert.deepEqual(quoteBinding(quote.reportData, "0x3b7500000000000000000000000000000000fa0c", enclave.nonce), { key: false, nonce: true });
  assert.deepEqual(quoteBinding(quote.reportData, enclave.signing_address, "00".repeat(32)), { key: true, nonce: false });
  assert.ok(!composeMatches(quote.mrConfig, `${enclave.app_compose} `));
});

test("a tampered enclave quote is rejected", async () => {
  // Byte 600 sits in the TD report's report_data, which the quote's signature covers.
  const bytes = Buffer.from(enclave.intel_quote, "hex");
  bytes[600] ^= 1;
  await assert.rejects(checkQuote(bytes.toString("hex"), enclave.collateral, BigInt(enclave.checked_at)));
});
