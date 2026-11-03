//! Payouts on EVM chains from the vault's own address, signed with NEAR Chain Signatures.
//!
//! The vault builds the EIP-1559 transaction itself (exact payee, exact amount, gas within the
//! owner's caps) and asks the MPC network to sign its hash under the vault's account. The
//! guardian only broadcasts what came back, so it can never get a signature for anything else.

use near_sdk::serde::Deserialize;
use near_sdk::serde_json;

/// A plain value transfer: exactly 21,000 gas, no calldata.
pub const TRANSFER_GAS: u64 = 21_000;

pub struct Transfer<'a> {
    pub chain_id: u64,
    pub nonce: u64,
    pub max_priority_fee_per_gas: u128,
    pub max_fee_per_gas: u128,
    pub to: &'a [u8; 20],
    pub value: u128,
}

/// keccak256(0x02 || rlp([chainId, nonce, maxPriorityFee, maxFee, gas, to, value, data, accessList])):
/// the hash an EIP-1559 transaction is signed over.
pub fn signing_hash(tx: &Transfer) -> [u8; 32] {
    near_sdk::env::keccak256_array(&unsigned_bytes(tx))
}

pub fn unsigned_bytes(tx: &Transfer) -> Vec<u8> {
    let fields = [
        rlp_uint(tx.chain_id as u128),
        rlp_uint(tx.nonce as u128),
        rlp_uint(tx.max_priority_fee_per_gas),
        rlp_uint(tx.max_fee_per_gas),
        rlp_uint(TRANSFER_GAS as u128),
        rlp_bytes(tx.to),
        rlp_uint(tx.value),
        rlp_bytes(&[]),
        rlp_list(&[]),
    ];
    let mut out = vec![0x02];
    out.extend(rlp_list(&fields));
    out
}

/// "0x" + 40 hex chars, any case.
pub fn parse_address(s: &str) -> Option<[u8; 20]> {
    let hex = s.strip_prefix("0x")?;
    if hex.len() != 40 {
        return None;
    }
    hex::decode(hex).ok()?.try_into().ok()
}

fn rlp_uint(v: u128) -> Vec<u8> {
    let bytes = v.to_be_bytes();
    let first = bytes.iter().position(|b| *b != 0).unwrap_or(bytes.len());
    rlp_bytes(&bytes[first..])
}

fn rlp_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return b.to_vec();
    }
    let mut out = rlp_len(b.len(), 0x80);
    out.extend_from_slice(b);
    out
}

fn rlp_list(items: &[Vec<u8>]) -> Vec<u8> {
    let body: Vec<u8> = items.concat();
    let mut out = rlp_len(body.len(), 0xc0);
    out.extend(body);
    out
}

fn rlp_len(len: usize, offset: u8) -> Vec<u8> {
    if len < 56 {
        return vec![offset + len as u8];
    }
    let bytes = (len as u64).to_be_bytes();
    let first = bytes.iter().position(|b| *b != 0).unwrap_or(7);
    let mut out = vec![offset + 55 + (8 - first) as u8];
    out.extend_from_slice(&bytes[first..]);
    out
}

/// The MPC contract's answer for a secp256k1 request.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct MpcSignature {
    big_r: AffinePoint,
    s: Scalar,
    recovery_id: u8,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct AffinePoint {
    affine_point: String,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Scalar {
    scalar: String,
}

/// (r, s, y-parity) as hex, from the MPC response bytes.
pub fn parse_signature(raw: &[u8]) -> Result<(String, String, u8), &'static str> {
    let sig: MpcSignature = serde_json::from_slice(raw).map_err(|_| "MPC returned an unexpected signature")?;
    let big_r = hex::decode(&sig.big_r.affine_point).map_err(|_| "MPC big_r is not hex")?;
    if big_r.len() != 33 || sig.s.scalar.len() != 64 || sig.recovery_id > 1 {
        return Err("MPC signature has the wrong shape");
    }
    Ok((hex::encode(&big_r[1..]), sig.s.scalar.to_ascii_lowercase(), sig.recovery_id))
}
