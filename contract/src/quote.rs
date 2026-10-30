//! Checking a NEAR Intents 1Click quote before paying a supplier on another chain.
//!
//! 1Click signs base58(sha256(json)) with ed25519, where `json` is the quote request and
//! quote fields serialized with sorted keys. The vault verifies that signature itself and
//! then reads the payout terms from the same JSON, so a quote can't be swapped or edited
//! between the AI screen and the payment.
//! See https://docs.near-intents.org/integration/distribution-channels/1click-api/verify-quote-signature

use near_sdk::serde_json::{self, Value};
use near_sdk::{env, AccountId};

pub struct QuoteTerms {
    pub deposit_address: AccountId,
    pub amount_in: u128,
    pub amount_out: u128,
    pub message: String,
}

pub struct Expected<'a> {
    pub origin_asset: &'a str,
    pub destination_asset: &'a str,
    pub recipient: &'a str,
    pub amount: u128,
    pub refund_to: &'a str,
    pub max_fee_bps: u128,
}

pub fn decode_key(key: &str) -> Option<[u8; 32]> {
    let bytes = bs58::decode(key.trim().trim_start_matches("ed25519:")).into_vec().ok()?;
    bytes.try_into().ok()
}

/// The message 1Click signs for this JSON.
pub fn message(json: &str) -> String {
    bs58::encode(env::sha256_array(json.as_bytes())).into_string()
}

pub fn signed_by(json: &str, signature: &str, key: &[u8; 32]) -> bool {
    let Ok(sig) = bs58::decode(signature.trim().trim_start_matches("ed25519:")).into_vec() else {
        return false;
    };
    let Ok(sig) = <[u8; 64]>::try_from(sig.as_slice()) else {
        return false;
    };
    env::ed25519_verify(&sig, message(json).as_bytes(), key)
}

/// Verifies the signature and that the quote pays exactly what was screened. Returns the
/// deposit address and how much the vault must send.
pub fn check(json: &str, signature: &str, key: &[u8; 32], want: &Expected) -> Result<QuoteTerms, &'static str> {
    if json.len() > 4096 {
        return Err("quote is too large");
    }
    if !signed_by(json, signature, key) {
        return Err("quote is not signed by 1Click");
    }
    let v: Value = serde_json::from_str(json).map_err(|_| "quote is not JSON")?;
    let s = |k: &str| v[k].as_str().unwrap_or_default();
    let n = |k: &str| s(k).parse::<u128>().map_err(|_| "quote amount is not a number");

    if v["dry"].as_bool() != Some(false) {
        return Err("quote is a preview, not executable");
    }
    if s("swapType") != "EXACT_OUTPUT" {
        return Err("quote must fix the amount the payee receives");
    }
    if s("originAsset") != want.origin_asset || s("depositType") != "ORIGIN_CHAIN" {
        return Err("quote spends a different asset");
    }
    if s("destinationAsset") != want.destination_asset || s("recipientType") != "DESTINATION_CHAIN" {
        return Err("quote pays out a different asset or chain");
    }
    if !s("recipient").eq_ignore_ascii_case(want.recipient) {
        return Err("quote recipient is not the payee");
    }
    if s("refundTo") != want.refund_to || s("refundType") != "ORIGIN_CHAIN" {
        return Err("quote refunds somewhere other than the vault");
    }
    if n("amount")? != want.amount {
        return Err("quote amount differs from the proposal");
    }
    let amount_out = n("amountOut")?;
    if amount_out < want.amount {
        return Err("quote pays out less than the proposal");
    }
    let amount_in = n("amountIn")?;
    if amount_in > want.amount * (10_000 + want.max_fee_bps) / 10_000 {
        return Err("quote costs more than the fee limit");
    }
    let deposit_address: AccountId = s("depositAddress").parse().map_err(|_| "quote has no NEAR deposit address")?;
    Ok(QuoteTerms { deposit_address, amount_in, amount_out, message: message(json) })
}
