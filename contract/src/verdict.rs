//! Checking a screening verdict signed by a NEAR AI Cloud model enclave.
//!
//! NEAR AI Cloud signs every non-streamed completion with a key that lives in
//! the model's TEE. The signed text is `<model_id>:<sha256(request)>:<sha256(response)>`
//! (hex), signed with Ethereum personal-sign (EIP-191), so the signer is an
//! Ethereum-style address we can recover on-chain with `ecrecover`.
//! See https://docs.near.ai/cloud/verification/cloud-api/response-signatures

use near_sdk::env;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value};

pub const MAX_RESPONSE_BYTES: usize = 16 * 1024;
const MAX_REASONS: usize = 8;
const MAX_REASON_LEN: usize = 64;

#[derive(Debug, PartialEq)]
pub enum Decision {
    Pass,
    Veto,
}

#[derive(Debug)]
pub struct ParsedVerdict {
    pub proposal_id: u64,
    pub proposal_hash: String,
    pub decision: Decision,
    pub reasons: Vec<String>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RawVerdict {
    proposal_id: Value,
    proposal_hash: String,
    verdict: String,
    #[serde(default)]
    reasons: Vec<String>,
}

/// keccak256 of the EIP-191 personal-sign message for `text`.
pub fn eip191_hash(text: &[u8]) -> [u8; 32] {
    let mut msg = Vec::with_capacity(28 + text.len());
    msg.extend_from_slice(b"\x19Ethereum Signed Message:\n");
    msg.extend_from_slice(text.len().to_string().as_bytes());
    msg.extend_from_slice(text);
    env::keccak256_array(&msg)
}

/// Recovers the Ethereum-style signer address from a 65-byte r||s||v signature.
pub fn recover_signer(hash: &[u8; 32], signature: &[u8]) -> Option<[u8; 20]> {
    if signature.len() != 65 {
        return None;
    }
    let v = match signature[64] {
        27 | 28 => signature[64] - 27,
        0 | 1 => signature[64],
        _ => return None,
    };
    let public_key = env::ecrecover(hash, &signature[..64], v, false)?;
    let digest = env::keccak256_array(&public_key);
    let mut address = [0u8; 20];
    address.copy_from_slice(&digest[12..]);
    Some(address)
}

/// The exact text NEAR AI Cloud signs for a `provider_tee` signature.
pub fn signed_text(model_id: &str, request_hash_hex: &str, response: &[u8]) -> String {
    let response_hash = hex::encode(env::sha256_array(response));
    format!("{model_id}:{request_hash_hex}:{response_hash}")
}

/// Pulls the screening verdict out of an OpenAI-format chat completion body.
/// The model is asked for a single JSON object; code fences around it are tolerated.
pub fn parse_completion(response: &[u8]) -> Result<ParsedVerdict, &'static str> {
    let body: Value = serde_json::from_slice(response).map_err(|_| "response is not JSON")?;
    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("response has no message content")?;
    let start = content.find('{').ok_or("verdict JSON not found")?;
    let end = content.rfind('}').ok_or("verdict JSON not found")?;
    if end < start {
        return Err("verdict JSON not found");
    }
    let raw: RawVerdict =
        serde_json::from_str(&content[start..=end]).map_err(|_| "verdict JSON is malformed")?;

    let proposal_id = match &raw.proposal_id {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    }
    .ok_or("proposal_id is not an integer")?;

    let decision = match raw.verdict.trim().to_ascii_uppercase().as_str() {
        "PASS" => Decision::Pass,
        "VETO" => Decision::Veto,
        _ => return Err("verdict must be PASS or VETO"),
    };

    let reasons = raw
        .reasons
        .into_iter()
        .take(MAX_REASONS)
        .map(|r| {
            r.trim()
                .chars()
                .map(|c| if c == ' ' || c == '-' { '_' } else { c })
                .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                .take(MAX_REASON_LEN)
                .collect::<String>()
                .to_ascii_uppercase()
        })
        .filter(|r| !r.is_empty())
        .collect();

    Ok(ParsedVerdict {
        proposal_id,
        proposal_hash: raw.proposal_hash.trim().to_ascii_lowercase(),
        decision,
        reasons,
    })
}

pub fn normalize_address(address: &str) -> Option<String> {
    let hex_part = address.trim().trim_start_matches("0x").trim_start_matches("0X");
    let bytes = hex::decode(hex_part).ok()?;
    (bytes.len() == 20).then(|| format!("0x{}", hex::encode(bytes)))
}

pub fn is_hex_32(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
