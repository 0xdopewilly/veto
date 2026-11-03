use super::*;
use near_sdk::serde_json::Value;
use k256::ecdsa::SigningKey;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use sha3::{Digest, Keccak256};

const USDC: &str = "usdc.testnet";
const MODEL: &str = "zai-org/GLM-5.3-Flash";
const DOLLAR: u128 = 1_000_000; // USDC has 6 decimals
const HOUR: u64 = 3600 * NANOS_PER_SEC;

fn owner() -> AccountId { "owner.testnet".parse().unwrap() }
fn guardian() -> AccountId { "guardian.testnet".parse().unwrap() }
fn agent() -> AccountId { "buyer.testnet".parse().unwrap() }
fn vault_id() -> AccountId { "vault.testnet".parse().unwrap() }
fn stranger() -> AccountId { "stranger.testnet".parse().unwrap() }

fn model_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32].into()).unwrap()
}

fn address_of(key: &SigningKey) -> String {
    let point = key.verifying_key().to_encoded_point(false);
    let digest = Keccak256::digest(&point.as_bytes()[1..]);
    format!("0x{}", hex::encode(&digest[12..]))
}

fn context(caller: AccountId, now: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(caller)
        .block_timestamp(now)
        .build();
    testing_env!(ctx);
}

fn context_with_result(now: u64, ok: bool) {
    let ctx = VMContextBuilder::new()
        .current_account_id(vault_id())
        .predecessor_account_id(vault_id())
        .block_timestamp(now)
        .build();
    let result = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
    testing_env!(ctx, near_sdk::test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

/// A vault with a $500 weekly / $500 single USDC policy, one agent and one approved model key.
fn setup() -> Vault {
    context(owner(), HOUR);
    let mut vault = Vault::new(
        owner(),
        guardian(),
        "Pay listed suppliers only, in USDC, up to $500 a week.".into(),
        vec![(USDC.into(), AssetPolicy { period_limit: U128(500 * DOLLAR), max_single: U128(500 * DOLLAR) })],
        U64(0),
        None,
        None,
        None,
        None,
        None,
    );
    vault.add_agent(agent());
    vault.add_signer(address_of(&model_key()), MODEL.into());
    vault
}

fn request(amount_dollars: u128) -> PaymentRequest {
    PaymentRequest {
        chain: "near".into(),
        asset: USDC.into(),
        payee: "kano-cotton.testnet".into(),
        amount: U128(amount_dollars * DOLLAR),
        memo: Some("INV-2291".into()),
    }
}

/// A chat completion body carrying `content`, signed the way NEAR AI Cloud signs it.
fn signed_completion(key: &SigningKey, content: &str) -> (Vec<u8>, String, String) {
    let request_bytes = br#"{"model":"zai-org/GLM-5.3-Flash","messages":[]}"#;
    let request_hash = hex::encode(env::sha256_array(request_bytes));
    let response = json!({
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "model": MODEL,
        "choices": [{ "index": 0, "message": { "role": "assistant", "content": content } }]
    })
    .to_string()
    .into_bytes();
    let text = format!("{MODEL}:{request_hash}:{}", hex::encode(env::sha256_array(&response)));
    let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let digest = Keccak256::digest(prefixed.as_bytes());
    let (signature, recovery) = key.sign_prehash_recoverable(&digest).unwrap();
    let mut bytes = signature.to_bytes().to_vec();
    bytes.push(27 + recovery.to_byte());
    (response, request_hash, format!("0x{}", hex::encode(bytes)))
}

fn verdict_content(id: u64, hash: &str, verdict: &str, reasons: &[&str]) -> String {
    json!({ "proposal_id": id, "proposal_hash": hash, "verdict": verdict, "reasons": reasons }).to_string()
}

fn submit(vault: &mut Vault, id: u64, verdict: &str, now: u64) -> Status {
    let hash = vault.get_proposal_hash(U64(id));
    let (response, request_hash, signature) =
        signed_completion(&model_key(), &verdict_content(id, &hash, verdict, &["LOOKALIKE_ADDRESS"]));
    context(guardian(), now);
    vault.submit_verdict(U64(id), MODEL.into(), "chatcmpl-test".into(), request_hash, response.into(), signature, None)
}

fn propose(vault: &mut Vault, amount_dollars: u128, now: u64) -> u64 {
    context(agent(), now);
    vault.propose(request(amount_dollars), None).0
}

#[test]
fn pass_pays_and_records_spend() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    assert_eq!(submit(&mut vault, id, "PASS", HOUR + 1), Status::Executing);
    assert_eq!(vault.get_spend(USDC.into()).spent.0, 300 * DOLLAR);

    context_with_result(HOUR + 2, true);
    assert!(vault.on_payment_settled(U64(id)));
    let proposal = vault.get_proposal(U64(id)).unwrap();
    assert_eq!(proposal.status, Status::Paid);
    let record = proposal.verdict.unwrap();
    assert!(record.pass);
    assert_eq!(record.signer, address_of(&model_key()));
}

#[test]
fn veto_blocks_and_spends_nothing() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    assert_eq!(submit(&mut vault, id, "VETO", HOUR + 1), Status::Vetoed);
    let proposal = vault.get_proposal(U64(id)).unwrap();
    assert_eq!(proposal.verdict.unwrap().reasons, vec!["LOOKALIKE_ADDRESS".to_string()]);
    assert_eq!(vault.get_spend(USDC.into()).spent.0, 0);
}

/// The demo scenario: $180 already paid this week, a $300 payment still fits the $500 cap,
/// so only the AI screen can stop it.
#[test]
fn demo_payment_fits_inside_the_cap() {
    let mut vault = setup();
    let first = propose(&mut vault, 180, HOUR);
    submit(&mut vault, first, "PASS", HOUR + 1);
    let second = propose(&mut vault, 300, HOUR + 2);
    assert_eq!(submit(&mut vault, second, "VETO", HOUR + 3), Status::Vetoed);
    assert_eq!(vault.get_spend(USDC.into()).remaining.0, 320 * DOLLAR);
}

#[test]
#[should_panic(expected = "amount exceeds what is left of the period limit")]
fn caps_block_before_screening() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    submit(&mut vault, id, "PASS", HOUR + 1);
    propose(&mut vault, 250, HOUR + 2);
}

#[test]
fn spend_resets_next_period() {
    let mut vault = setup();
    let id = propose(&mut vault, 500, HOUR);
    submit(&mut vault, id, "PASS", HOUR + 1);
    let next_week = DEFAULT_PERIOD_SECS * NANOS_PER_SEC + HOUR;
    let id = propose(&mut vault, 500, next_week);
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::Screening);
}

#[test]
#[should_panic(expected = "signer is not an approved model key")]
fn rejects_unapproved_signer() {
    let mut vault = setup();
    let id = propose(&mut vault, 100, HOUR);
    let hash = vault.get_proposal_hash(U64(id));
    let other = SigningKey::from_bytes(&[9u8; 32].into()).unwrap();
    let (response, request_hash, signature) =
        signed_completion(&other, &verdict_content(id, &hash, "PASS", &[]));
    context(guardian(), HOUR + 1);
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature, None);
}

#[test]
#[should_panic(expected = "signer is not an approved model key")]
fn rejects_tampered_response() {
    let mut vault = setup();
    let id = propose(&mut vault, 100, HOUR);
    let hash = vault.get_proposal_hash(U64(id));
    let (_, request_hash, signature) = signed_completion(&model_key(), &verdict_content(id, &hash, "VETO", &[]));
    let (forged, _, _) = signed_completion(&model_key(), &verdict_content(id, &hash, "PASS", &[]));
    context(guardian(), HOUR + 1);
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, forged.into(), signature, None);
}

#[test]
#[should_panic(expected = "verdict does not match this proposal")]
fn rejects_verdict_for_other_payment() {
    let mut vault = setup();
    let id = propose(&mut vault, 100, HOUR);
    let (response, request_hash, signature) =
        signed_completion(&model_key(), &verdict_content(id, &"ab".repeat(32), "PASS", &[]));
    context(guardian(), HOUR + 1);
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature, None);
}

#[test]
#[should_panic(expected = "only the guardian submits verdicts")]
fn only_guardian_submits() {
    let mut vault = setup();
    let id = propose(&mut vault, 100, HOUR);
    let hash = vault.get_proposal_hash(U64(id));
    let (response, request_hash, signature) =
        signed_completion(&model_key(), &verdict_content(id, &hash, "PASS", &[]));
    context(agent(), HOUR + 1);
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature, None);
}

#[test]
#[should_panic(expected = "caller is not an active agent")]
fn strangers_cannot_propose() {
    let mut vault = setup();
    context(stranger(), HOUR);
    vault.propose(request(10), None);
}

#[test]
#[should_panic(expected = "caller is not an active agent")]
fn paused_agent_cannot_propose() {
    let mut vault = setup();
    vault.set_agent_active(agent(), false);
    propose(&mut vault, 10, HOUR);
}

#[test]
fn override_waits_then_pays() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    submit(&mut vault, id, "VETO", HOUR + 1);
    context(owner(), HOUR + 2);
    vault.override_veto(U64(id));
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::OverridePending);

    context(stranger(), HOUR + 2 + 24 * HOUR);
    vault.execute_override(U64(id), None);
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::Executing);
}

#[test]
#[should_panic(expected = "override delay has not passed")]
fn override_cannot_pay_early() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    submit(&mut vault, id, "VETO", HOUR + 1);
    context(owner(), HOUR + 2);
    vault.override_veto(U64(id));
    context(stranger(), HOUR + 3);
    vault.execute_override(U64(id), None);
}

#[test]
fn freeze_cancels_pending_overrides() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    submit(&mut vault, id, "VETO", HOUR + 1);
    context(owner(), HOUR + 2);
    vault.override_veto(U64(id));
    vault.freeze();
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::Cancelled);
    assert!(vault.get_config().frozen);
}

#[test]
#[should_panic(expected = "vault is frozen")]
fn frozen_vault_takes_no_proposals() {
    let mut vault = setup();
    vault.freeze();
    propose(&mut vault, 10, HOUR);
}

#[test]
fn raising_a_limit_waits_lowering_does_not() {
    let mut vault = setup();
    let raise = AssetPolicy { period_limit: U128(800 * DOLLAR), max_single: U128(500 * DOLLAR) };
    vault.set_policy(USDC.into(), raise.clone());
    assert_eq!(vault.policies.get(USDC).unwrap().period_limit.0, 500 * DOLLAR);
    assert_eq!(vault.get_pending_policies().len(), 1);

    let lower = AssetPolicy { period_limit: U128(400 * DOLLAR), max_single: U128(400 * DOLLAR) };
    vault.set_policy(USDC.into(), lower.clone());
    assert_eq!(vault.policies.get(USDC).unwrap(), &lower);
    assert!(vault.get_pending_policies().is_empty());

    vault.set_policy(USDC.into(), raise.clone());
    context(stranger(), HOUR + 24 * HOUR);
    vault.apply_policy(USDC.into());
    assert_eq!(vault.policies.get(USDC).unwrap(), &raise);
}

#[test]
#[should_panic(expected = "raise delay has not passed")]
fn raise_cannot_apply_early() {
    let mut vault = setup();
    vault.set_policy(USDC.into(), AssetPolicy { period_limit: U128(800 * DOLLAR), max_single: U128(500 * DOLLAR) });
    context(stranger(), HOUR + 1);
    vault.apply_policy(USDC.into());
}

#[test]
fn unanswered_screening_expires() {
    let mut vault = setup();
    let id = propose(&mut vault, 100, HOUR);
    context(stranger(), HOUR + DEFAULT_SCREEN_TIMEOUT_SECS * NANOS_PER_SEC + 1);
    vault.expire(U64(id));
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::Expired);
}

#[test]
fn failed_transfer_releases_spend() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    submit(&mut vault, id, "PASS", HOUR + 1);
    context_with_result(HOUR + 2, false);
    assert!(!vault.on_payment_settled(U64(id)));
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::Failed);
    assert_eq!(vault.get_spend(USDC.into()).spent.0, 0);
}

#[test]
fn parses_fenced_model_output() {
    context(owner(), HOUR);
    let content = "```json\n{\"proposal_id\":\"4\",\"proposal_hash\":\"AB\",\"verdict\":\"veto\",\"reasons\":[\"changed payout details!\"]}\n```";
    let body = json!({ "choices": [{ "message": { "content": content } }] }).to_string();
    let parsed = verdict::parse_completion(body.as_bytes()).unwrap();
    assert_eq!(parsed.proposal_id, 4);
    assert_eq!(parsed.proposal_hash, "ab");
    assert_eq!(parsed.decision, verdict::Decision::Veto);
    assert_eq!(parsed.reasons, vec!["CHANGED_PAYOUT_DETAILS".to_string()]);
}

/// Pinned so the TypeScript guardian (packages/core/src/proposal.ts) can't drift from the contract.
#[test]
fn proposal_hash_is_stable() {
    let mut vault = setup();
    let id = propose(&mut vault, 300, HOUR);
    assert_eq!(
        vault.get_proposal_hash(U64(id)),
        "b834b56725f712fb48348615f1591cd9b136ab43e384138e4592b5435dd5f5d5"
    );
}

// ----------------------------------------------------------- cross-chain via NEAR Intents

const BASE_USDC: &str = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const KANO_BASE: &str = "0xa11ce57b2f0c88de41a9b3c07e6d1f45a3c0d9f2";
const DEPOSIT: &str = "5f3c2a9e1b7d4c6a8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d";

fn oneclick_test_key() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&[5u8; 32])
}

/// A vault that pays Base suppliers in USDC through Intents, trusting a test 1Click key.
fn setup_cross_chain() -> Vault {
    let mut vault = setup();
    let key = bs58::encode(oneclick_test_key().verifying_key().to_bytes()).into_string();
    vault.set_oneclick_key(format!("ed25519:{key}"));
    vault.set_route(
        "base".into(),
        Route {
            token: USDC.parse().unwrap(),
            origin_asset: format!("nep141:{USDC}"),
            destination_asset: BASE_USDC.into(),
            max_fee_bps: 100,
        },
    );
    vault
}

fn base_request(amount_dollars: u128) -> PaymentRequest {
    PaymentRequest {
        chain: "base".into(),
        asset: USDC.into(),
        payee: KANO_BASE.into(),
        amount: U128(amount_dollars * DOLLAR),
        memo: Some("INV-2291".into()),
    }
}

/// A live (non-dry) 1Click quote, serialized with sorted keys and signed like 1Click does.
fn quote(edit: impl FnOnce(&mut Value)) -> SignedQuote {
    let mut v = json!({
        "amount": (300 * DOLLAR).to_string(),
        "amountIn": "301567849",
        "amountInFormatted": "301.567849",
        "amountOut": (300 * DOLLAR).to_string(),
        "amountOutFormatted": "300.0",
        "deadline": "2026-11-05T12:00:00.000Z",
        "depositAddress": DEPOSIT,
        "depositType": "ORIGIN_CHAIN",
        "destinationAsset": BASE_USDC,
        "dry": false,
        "minAmountIn": "300060009",
        "minAmountOut": (300 * DOLLAR).to_string(),
        "originAsset": format!("nep141:{USDC}"),
        "recipient": KANO_BASE,
        "recipientType": "DESTINATION_CHAIN",
        "refundTo": vault_id().to_string(),
        "refundType": "ORIGIN_CHAIN",
        "slippageTolerance": 50,
        "swapType": "EXACT_OUTPUT",
        "timestamp": "2026-11-05T11:50:00.000Z"
    });
    edit(&mut v);
    let json = v.to_string();
    use ed25519_dalek::Signer;
    let sig = oneclick_test_key().sign(quote::message(&json).as_bytes());
    SignedQuote { json, signature: format!("ed25519:{}", bs58::encode(sig.to_bytes()).into_string()) }
}

fn pass_with_quote(vault: &mut Vault, id: u64, q: Option<SignedQuote>) -> Status {
    let hash = vault.get_proposal_hash(U64(id));
    let (response, request_hash, signature) =
        signed_completion(&model_key(), &verdict_content(id, &hash, "PASS", &[]));
    context(guardian(), HOUR + 1);
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature, q)
}

fn propose_base(vault: &mut Vault, amount_dollars: u128) -> u64 {
    context(agent(), HOUR);
    vault.propose(base_request(amount_dollars), None).0
}

/// The real 1Click signature on a live dry quote (captured 2026-10-30) verifies on-chain
/// against 1Click's published key, and any edit breaks it.
#[test]
fn verifies_a_real_1click_signature() {
    context(owner(), HOUR);
    let fixture: Value = near_sdk::serde_json::from_str(include_str!("fixtures/oneclick_dry_quote_signed.json")).unwrap();
    let json = fixture["json"].as_str().unwrap();
    let signature = fixture["signature"].as_str().unwrap();
    let key = quote::decode_key(ONE_CLICK_MANAGER_KEY).unwrap();
    assert!(quote::signed_by(json, signature, &key));
    assert!(!quote::signed_by(&json.replace("0xa11ce57b", "0xdeadbeef"), signature, &key));
}

/// A real executable quote from 1Click (scripts/oneclick-live-fixture.ts): every on-chain check
/// passes against 1Click's actual output, and the terms the vault pays from come out of it.
#[test]
fn accepts_a_real_executable_1click_quote() {
    context(owner(), HOUR);
    let f: Value = near_sdk::serde_json::from_str(include_str!("fixtures/oneclick_live_quote_signed.json")).unwrap();
    let s = |k: &str| f[k].as_str().unwrap().to_string();
    let (origin, destination) = (f["route"]["origin_asset"].as_str().unwrap(), f["route"]["destination_asset"].as_str().unwrap());
    let (payee, vault) = (s("payee"), s("vault"));
    let want = quote::Expected {
        origin_asset: origin,
        destination_asset: destination,
        recipient: &payee,
        amount: s("amount").parse().unwrap(),
        refund_to: &vault,
        max_fee_bps: 200,
    };
    let key = quote::decode_key(ONE_CLICK_MANAGER_KEY).unwrap();
    let terms = quote::check(&s("json"), &s("signature"), &key, &want).unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(terms.amount_out, 5_000_000);
    assert!(terms.amount_in > terms.amount_out);
    // The same quote for a different payee, or under a tighter fee cap, is refused.
    let other = quote::Expected { recipient: "0x000000000000000000000000000000000000dead", ..want };
    assert_eq!(quote::check(&s("json"), &s("signature"), &key, &other).err(), Some("quote recipient is not the payee"));
    let tight = quote::Expected { max_fee_bps: 50, ..want };
    assert_eq!(quote::check(&s("json"), &s("signature"), &key, &tight).err(), Some("quote costs more than the fee limit"));
}

#[test]
fn pays_a_base_supplier_through_intents() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    assert_eq!(pass_with_quote(&mut vault, id, Some(quote(|_| {}))), Status::Executing);
    let p = vault.get_proposal(U64(id)).unwrap();
    let q = p.quote.unwrap();
    assert_eq!(q.deposit_address.as_str(), DEPOSIT);
    assert_eq!(q.amount_in.0, 301_567_849);
    // The cap counts what left the vault, fees included.
    assert_eq!(vault.get_spend(USDC.into()).spent.0, 301_567_849);
}

#[test]
#[should_panic(expected = "quote recipient is not the payee")]
fn rejects_a_quote_to_someone_else() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    pass_with_quote(&mut vault, id, Some(quote(|v| v["recipient"] = json!("0x000000000000000000000000000000000000dead"))));
}

#[test]
#[should_panic(expected = "quote is not signed by 1Click")]
fn rejects_an_unsigned_quote() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    let mut q = quote(|_| {});
    q.json = q.json.replace("301567849", "301567850");
    pass_with_quote(&mut vault, id, Some(q));
}

#[test]
#[should_panic(expected = "quote refunds somewhere other than the vault")]
fn rejects_refunds_to_another_account() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    pass_with_quote(&mut vault, id, Some(quote(|v| v["refundTo"] = json!("attacker.testnet"))));
}

#[test]
#[should_panic(expected = "quote costs more than the fee limit")]
fn rejects_an_expensive_quote() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    pass_with_quote(&mut vault, id, Some(quote(|v| v["amountIn"] = json!("310000000"))));
}

#[test]
#[should_panic(expected = "quote is a preview, not executable")]
fn rejects_a_dry_quote() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    pass_with_quote(&mut vault, id, Some(quote(|v| v["dry"] = json!(true))));
}

#[test]
#[should_panic(expected = "a cross-chain payment needs a signed 1Click quote")]
fn cross_chain_needs_a_quote() {
    let mut vault = setup_cross_chain();
    let id = propose_base(&mut vault, 300);
    pass_with_quote(&mut vault, id, None);
}

#[test]
#[should_panic(expected = "the vault has no route to this chain")]
fn unknown_chains_are_refused_at_proposal() {
    let mut vault = setup();
    propose_base(&mut vault, 100);
}

// ------------------------------------------------------------- external agent wallets

const WALLET: &str = "9717ac438a948ce5a42f766ea07352892f76fefc9346adfde3ff57d407350988";
const OP_HASH: &str = "87427b8b0c1f3a5e9d2b4c6a8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f";

fn external(approval: &str) -> ExternalPayment {
    ExternalPayment {
        provider: "outlayer".into(),
        wallet: WALLET.into(),
        approval_id: approval.into(),
        op_hash: OP_HASH.into(),
        tx_hash: None,
    }
}

fn setup_external() -> Vault {
    let mut vault = setup();
    context(owner(), HOUR);
    vault.add_wallet("outlayer".into(), WALLET.parse().unwrap(), "Buyer agent (OutLayer)".into());
    vault
}

fn propose_ext(vault: &mut Vault, amount_dollars: u128, approval: &str) -> u64 {
    context(guardian(), HOUR);
    vault.propose_external(request(amount_dollars), None, external(approval)).0
}

#[test]
fn external_pass_waits_for_the_wallet_then_settles() {
    let mut vault = setup_external();
    let id = propose_ext(&mut vault, 300, "appr-1");
    assert_eq!(vault.get_proposal(U64(id)).unwrap().agent.as_str(), WALLET);
    assert_eq!(submit(&mut vault, id, "PASS", HOUR + 1), Status::Executing);
    // Approved here, so the spend counts and the guardian can still find it to vote.
    assert_eq!(vault.get_spend(USDC.into()).spent.0, 300 * DOLLAR);
    assert_eq!(vault.get_open_proposals().len(), 1);

    context(guardian(), HOUR + 2);
    assert_eq!(vault.settle_external(U64(id), true, Some("H9gwYcjFFpVF".into())), Status::Paid);
    let p = vault.get_proposal(U64(id)).unwrap();
    assert_eq!(p.external.unwrap().tx_hash.as_deref(), Some("H9gwYcjFFpVF"));
    assert!(vault.get_open_proposals().is_empty());
}

#[test]
fn external_failure_releases_spend() {
    let mut vault = setup_external();
    let id = propose_ext(&mut vault, 300, "appr-1");
    submit(&mut vault, id, "PASS", HOUR + 1);
    context(guardian(), HOUR + 2);
    assert_eq!(vault.settle_external(U64(id), false, None), Status::Failed);
    assert_eq!(vault.get_spend(USDC.into()).spent.0, 0);
}

#[test]
fn external_veto_can_be_overridden_after_the_delay() {
    let mut vault = setup_external();
    let id = propose_ext(&mut vault, 300, "appr-1");
    assert_eq!(submit(&mut vault, id, "VETO", HOUR + 1), Status::Vetoed);
    assert!(vault.get_open_proposals().is_empty());

    context(owner(), HOUR + 2);
    vault.override_veto(U64(id));
    context(stranger(), HOUR + 2 + DEFAULT_DELAY_SECS * NANOS_PER_SEC);
    vault.execute_override(U64(id), None);
    let p = vault.get_proposal(U64(id)).unwrap();
    assert_eq!(p.status, Status::Executing);
    assert_eq!(vault.get_open_proposals().len(), 1);
}

#[test]
#[should_panic(expected = "only the guardian records external payments")]
fn only_the_guardian_records_external_payments() {
    let mut vault = setup_external();
    context(agent(), HOUR);
    vault.propose_external(request(100), None, external("appr-1"));
}

#[test]
#[should_panic(expected = "wallet is not registered")]
fn unregistered_wallets_are_refused() {
    let mut vault = setup();
    propose_ext(&mut vault, 100, "appr-1");
}

#[test]
#[should_panic(expected = "this approval is already recorded")]
fn an_approval_is_recorded_once() {
    let mut vault = setup_external();
    propose_ext(&mut vault, 100, "appr-1");
    propose_ext(&mut vault, 100, "appr-1");
}

#[test]
#[should_panic(expected = "amount exceeds the single-payment limit")]
fn external_payments_meet_the_same_caps() {
    let mut vault = setup_external();
    propose_ext(&mut vault, 600, "appr-1");
}

#[test]
fn external_hash_binds_the_approval() {
    let mut vault = setup_external();
    let a = propose_ext(&mut vault, 300, "appr-1");
    let b = propose_ext(&mut vault, 300, "appr-2");
    let (ha, hb) = (vault.get_proposal_hash(U64(a)), vault.get_proposal_hash(U64(b)));
    assert_ne!(ha, hb);
    // Mirrored in packages/core/test/core.test.ts.
    assert_eq!(ha, "4206ccce7c38c2caeefafb2ea0073b28234f19eefc61243f48bfbe4ec2cf12af");
}

#[test]
fn keeping_a_veto_closes_it_for_good() {
    let mut vault = setup_external();
    let id = propose_ext(&mut vault, 300, "appr-1");
    submit(&mut vault, id, "VETO", HOUR + 1);
    context(owner(), HOUR + 2);
    vault.keep_blocked(U64(id));
    assert_eq!(vault.get_proposal(U64(id)).unwrap().status, Status::Cancelled);
}

#[test]
#[should_panic(expected = "only a vetoed payment can be overridden")]
fn a_kept_veto_cannot_be_overridden() {
    let mut vault = setup_external();
    let id = propose_ext(&mut vault, 300, "appr-1");
    submit(&mut vault, id, "VETO", HOUR + 1);
    context(owner(), HOUR + 2);
    vault.keep_blocked(U64(id));
    vault.override_veto(U64(id));
}
