use super::*;
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
        U64(0),
        None,
        None,
        None,
        None,
    );
    vault.policies.insert(
        USDC.into(),
        AssetPolicy { period_limit: U128(500 * DOLLAR), max_single: U128(500 * DOLLAR) },
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
    vault.submit_verdict(U64(id), MODEL.into(), "chatcmpl-test".into(), request_hash, response.into(), signature)
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
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature);
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
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, forged.into(), signature);
}

#[test]
#[should_panic(expected = "verdict does not match this proposal")]
fn rejects_verdict_for_other_payment() {
    let mut vault = setup();
    let id = propose(&mut vault, 100, HOUR);
    let (response, request_hash, signature) =
        signed_completion(&model_key(), &verdict_content(id, &"ab".repeat(32), "PASS", &[]));
    context(guardian(), HOUR + 1);
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature);
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
    vault.submit_verdict(U64(id), MODEL.into(), "c".into(), request_hash, response.into(), signature);
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
    vault.execute_override(U64(id));
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
    vault.execute_override(U64(id));
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
