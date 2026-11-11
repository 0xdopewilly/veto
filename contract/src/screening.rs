//! Checked screening: the vault rebuilds the exact request its screening model must have seen.
//!
//! The guardian doesn't get to say what it asked the model. The vault writes the screening facts
//! itself from its own state (the payment, the owner's mandate, the payee list, the newest
//! payments and the risk signals), adds the evidence the agent committed to when it proposed,
//! and rebuilds the chat request byte for byte around the screening prompt pinned below. NEAR AI
//! Cloud's enclave signs sha256 of the request it actually received, so a verdict counts only if
//! the model saw exactly this request. A guardian that shows the model anything else (another
//! email, a friendlier mandate, a payee list with the scammer on it, a missing duplicate) gets a
//! signature over a different request, and the vault rejects the verdict.
//!
//! The off-chain screener (`packages/core/src/prompt.ts`) writes the same bytes; the fixture test
//! in `tests.rs` holds the two together.

use near_sdk::serde::Serialize;
use near_sdk::serde_json;

use crate::{Payee, PaymentRequest, Proposal, Status};

/// The screening prompt. Changing it changes every request hash, so it ships with the code.
pub const SYSTEM_PROMPT: &str = include_str!("screening_prompt.txt");

/// The structured-output format the model must answer in, exactly as the request sends it.
const RESPONSE_FORMAT: &str = r#"{"type":"json_schema","json_schema":{"name":"veto_verdict","strict":true,"schema":{"type":"object","properties":{"proposal_id":{"type":"string"},"proposal_hash":{"type":"string"},"verdict":{"type":"string","enum":["PASS","VETO"]},"reasons":{"type":"array","items":{"type":"string","enum":["LOOKALIKE_ADDRESS","NEW_PAYEE","CHANGED_PAYOUT_DETAILS","UNTRUSTED_INSTRUCTION","URGENCY_PRESSURE","DUPLICATE_INVOICE","AMOUNT_ANOMALY","UNLIMITED_APPROVAL","MANDATE_VIOLATION","EVIDENCE_MISMATCH"]}}},"required":["proposal_id","proposal_hash","verdict","reasons"],"additionalProperties":false}}}"#;

/// The most evidence a checked verdict carries (an email of a few thousand characters fits).
pub const MAX_EVIDENCE_BYTES: usize = 32 * 1024;
/// How many earlier payments the risk signals look at.
pub const HISTORY_LEN: u64 = 100;
/// How many of those the model sees.
const SHOWN_HISTORY: usize = 20;

/// The exact chat request the guardian must send NEAR AI Cloud for this screening.
pub fn build_request(model: &str, user: &str) -> String {
    format!(
        r#"{{"model":{},"messages":[{{"role":"system","content":{}}},{{"role":"user","content":{}}}],"temperature":0,"thinking":{{"type":"disabled"}},"max_tokens":2000,"stream":false,"response_format":{}}}"#,
        json_string(model),
        json_string(SYSTEM_PROMPT),
        json_string(user),
        RESPONSE_FORMAT
    )
}

/// The user message: the facts, then the agent's evidence as untrusted data.
pub fn user_message(facts: &str, evidence: &str) -> String {
    format!("{facts}\n\n<evidence>\n{evidence}\n</evidence>")
}

/// A string as JSON, escaped the way JavaScript's JSON.stringify escapes it.
fn json_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Facts<'a> {
    proposal_id: String,
    proposal_hash: &'a str,
    requested_by_agent: &'a str,
    payment: Described<'a>,
    owner_mandate: &'a str,
    payee_list: Vec<PayeeFact<'a>>,
    recent_payments: Vec<Recent<'a>>,
    signals: Vec<Signal>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Described<'a> {
    chain: &'a str,
    asset: &'a str,
    payee: &'a str,
    amount: String,
    reference: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct PayeeFact<'a> {
    name: &'a str,
    chain: &'a str,
    address: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Recent<'a> {
    status: &'a Status,
    chain: &'a str,
    asset: &'a str,
    payee: &'a str,
    amount: String,
    reference: Option<&'a str>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Signal {
    pub code: &'static str,
    pub detail: String,
}

/// The screening facts as the model reads them: pretty-printed JSON, newest payments first.
/// `history` is the vault's newest payments other than this one, newest first.
pub fn facts(
    proposal: &Proposal,
    proposal_hash: &str,
    mandate: &str,
    payees: &[Payee],
    history: &[Proposal],
    decimals: impl Fn(&str) -> Option<u8>,
) -> Result<String, String> {
    let describe = |r: &'_ PaymentRequest| -> Result<String, String> {
        let places = decimals(&r.asset).ok_or_else(|| format!("the vault hasn't loaded the decimals of {}; call load_decimals", r.asset))?;
        Ok(format_amount(r.amount.0, places))
    };
    let request = &proposal.request;
    let mut recent = Vec::new();
    for p in history.iter().take(SHOWN_HISTORY) {
        recent.push(Recent {
            status: &p.status,
            chain: &p.request.chain,
            asset: &p.request.asset,
            payee: &p.request.payee,
            amount: describe(&p.request)?,
            reference: p.request.memo.as_deref(),
        });
    }
    let facts = Facts {
        proposal_id: proposal.id.0.to_string(),
        proposal_hash,
        requested_by_agent: proposal.agent.as_str(),
        payment: Described {
            chain: &request.chain,
            asset: &request.asset,
            payee: &request.payee,
            amount: describe(request)?,
            reference: request.memo.as_deref(),
        },
        owner_mandate: mandate,
        payee_list: payees.iter().map(|p| PayeeFact { name: &p.name, chain: &p.chain, address: &p.address }).collect(),
        recent_payments: recent,
        signals: signals(request, payees, history),
    };
    serde_json::to_string_pretty(&facts).map_err(|_| "facts did not serialize".to_string())
}

/// An amount in whole units, the way the model reads it: every significant digit and at least
/// two decimals, thousands grouped (180.00 USDC, 12,480.00 USDC, 0.0005 ETH).
pub fn format_amount(raw: u128, decimals: u8) -> String {
    let base = 10u128.checked_pow(u32::from(decimals)).unwrap_or(u128::MAX);
    let whole = (raw / base).to_string();
    let mut grouped = String::with_capacity(whole.len() + whole.len() / 3);
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let rem = format!("{:0>width$}", raw % base, width = usize::from(decimals));
    let mut frac = rem.trim_end_matches('0').to_string();
    while frac.len() < 2 {
        frac.push('0');
    }
    format!("{grouped}.{frac}")
}

fn norm(s: &str) -> String {
    s.trim().to_lowercase()
}

/// Deterministic risk signals, handed to the model as facts; the model still decides.
/// The same rules as `packages/core/src/signals.ts`.
pub fn signals(request: &PaymentRequest, payees: &[Payee], history: &[Proposal]) -> Vec<Signal> {
    let mut out = Vec::new();
    let target = norm(&request.payee);
    let chain = norm(&request.chain);
    let same_chain: Vec<&Payee> = payees.iter().filter(|p| norm(&p.chain) == chain).collect();

    if let Some(listed) = same_chain.iter().find(|p| norm(&p.address) == target) {
        out.push(Signal { code: "LISTED_PAYEE", detail: format!("Payee is on the list as \"{}\".", listed.name) });
    } else {
        let paid_before = history.iter().any(|p| p.status == Status::Paid && norm(&p.request.payee) == target);
        if !paid_before {
            out.push(Signal {
                code: "NEW_PAYEE",
                detail: "This address is not on the payee list and has never been paid.".into(),
            });
        }
        for p in &same_chain {
            if let Some(why) = lookalike(&target, &norm(&p.address)) {
                out.push(Signal {
                    code: "LOOKALIKE_ADDRESS",
                    detail: format!("Looks like {}'s saved address {} ({}).", p.name, p.address, why),
                });
            }
        }
    }

    if let Some(memo) = request.memo.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        // A payout still in flight counts too, so two quick copies of one invoice can't both pass.
        let dup = history.iter().find(|p| {
            matches!(p.status, Status::Paid | Status::Executing) && p.request.memo.as_deref().map(str::trim) == Some(memo)
        });
        if let Some(dup) = dup {
            out.push(Signal {
                code: "DUPLICATE_INVOICE",
                detail: format!("Reference \"{memo}\" was already paid in proposal {}.", dup.id.0),
            });
        }
    }

    let past: Vec<u128> = history
        .iter()
        .filter(|p| p.status == Status::Paid && norm(&p.request.payee) == target && p.request.asset == request.asset)
        .map(|p| p.request.amount.0)
        .collect();
    if past.len() >= 2 {
        let max = past.iter().copied().max().unwrap_or(0);
        if request.amount.0 > max.saturating_mul(2) {
            out.push(Signal {
                code: "AMOUNT_ANOMALY",
                detail: "More than twice the largest past payment to this payee.".into(),
            });
        }
    }
    out
}

fn is_evm(s: &str) -> bool {
    let s = s.trim();
    s.len() == 42 && s[..2].eq_ignore_ascii_case("0x") && s[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Why `candidate` looks like `saved`, or None. Exact matches are not lookalikes.
pub fn lookalike(candidate: &str, saved: &str) -> Option<String> {
    if candidate == saved {
        return None;
    }
    if is_evm(candidate) && is_evm(saved) {
        let a = &candidate.as_bytes()[2..];
        let b = &saved.as_bytes()[2..];
        let mut prefix = 0;
        while prefix < a.len() && a[prefix] == b[prefix] {
            prefix += 1;
        }
        let mut suffix = 0;
        while suffix < a.len() - prefix && a[a.len() - 1 - suffix] == b[b.len() - 1 - suffix] {
            suffix += 1;
        }
        return (prefix >= 4 && suffix >= 4).then(|| format!("same first {prefix} and last {suffix} characters"));
    }
    let distance = levenshtein(&skeleton(candidate), &skeleton(saved));
    if distance == 0 {
        return Some("visually identical characters".into());
    }
    let shorter = candidate.chars().count().min(saved.chars().count());
    (distance <= 2 && shorter >= 6)
        .then(|| format!("{distance} character{} different", if distance > 1 { "s" } else { "" }))
}

/// Folds characters that are easy to confuse at a glance.
fn skeleton(s: &str) -> Vec<char> {
    s.replace("rn", "m")
        .replace("vv", "w")
        .chars()
        .map(|c| match c {
            '1' | 'i' | 'l' | '|' => 'l',
            '0' => 'o',
            '5' => 's',
            c => c,
        })
        .collect()
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let tmp = row[j];
            row[j] = (row[j] + 1).min(row[j - 1] + 1).min(prev + usize::from(a[i - 1] != b[j - 1]));
            prev = tmp;
        }
    }
    row[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_read_like_the_screener_writes_them() {
        assert_eq!(format_amount(180_000_000, 6), "180.00");
        assert_eq!(format_amount(12_480_000_000, 6), "12,480.00");
        assert_eq!(format_amount(1_234_567_890_123, 6), "1,234,567.890123");
        assert_eq!(format_amount(500_000_000_000_000, 18), "0.0005");
        assert_eq!(format_amount(10u128.pow(24), 24), "1.00");
        assert_eq!(format_amount(7, 0), "7.00");
        assert_eq!(format_amount(999, 6), "0.000999");
    }

    #[test]
    fn lookalikes() {
        assert_eq!(lookalike("kano-cotton.testnet", "kano-cotton.testnet"), None);
        assert_eq!(lookalike("kano-c0tton.testnet", "kano-cotton.testnet").as_deref(), Some("visually identical characters"));
        assert_eq!(lookalike("kano-cottons.testnet", "kano-cotton.testnet").as_deref(), Some("1 character different"));
        assert_eq!(lookalike("acme.testnet", "kano-cotton.testnet"), None);
        assert_eq!(
            lookalike("0x1234aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5678", "0x1234bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb5678").as_deref(),
            Some("same first 4 and last 4 characters")
        );
    }

    #[test]
    fn requests_escape_like_json_stringify() {
        let request = build_request("m", "a \"quote\"\n\u{1b} é");
        assert!(request.contains(r#""content":"a \"quote\"\n\u001b é"}"#));
        assert!(request.starts_with(r#"{"model":"m","messages":[{"role":"system","content":"You are Veto"#));
    }
}
