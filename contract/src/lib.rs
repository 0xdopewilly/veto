//! Veto vault.
//!
//! Every outgoing payment an agent proposes must clear two gates before money moves:
//!   1. Hard caps enforced here (per-payment and per-period limits per asset).
//!   2. A private AI screen run by the guardian service on NEAR AI Cloud. The model's
//!      verdict is signed inside its TEE and checked here with `ecrecover`.
//! The AI can only say no: a PASS never lets a payment exceed the caps, and a VETO can
//! only be overridden by the owner after a delay.

mod verdict;

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, json, Value};
use near_sdk::store::{IterableMap, IterableSet, LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError,
};

use verdict::Decision;

const NANOS_PER_SEC: u64 = 1_000_000_000;
const DEFAULT_PERIOD_SECS: u64 = 7 * 24 * 60 * 60;
const DEFAULT_DELAY_SECS: u64 = 24 * 60 * 60;
const DEFAULT_SCREEN_TIMEOUT_SECS: u64 = 10 * 60;
const MAX_OPEN_PROPOSALS: u32 = 20;
const MAX_MANDATE_LEN: usize = 2000;
const MAX_MEMO_LEN: usize = 128;
const NATIVE: &str = "near";
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Agents,
    Payees,
    Signers,
    Policies,
    PendingPolicies,
    Spent,
    Proposals,
    OpenProposals,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    /// Waiting for the AI screen.
    Screening,
    /// Approved; the transfer is in flight.
    Executing,
    Paid,
    Vetoed,
    /// The owner overrode a veto; it pays after the delay unless cancelled.
    OverridePending,
    Cancelled,
    /// No verdict arrived in time. Fails closed.
    Expired,
    /// Approved but the transfer failed; the spend was released.
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PaymentRequest {
    /// Only "near" today; other chains settle through NEAR Intents or Chain Signatures.
    pub chain: String,
    /// "near" for native NEAR, otherwise a NEP-141 token contract.
    pub asset: String,
    pub payee: String,
    pub amount: U128,
    pub memo: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct VerdictRecord {
    pub pass: bool,
    pub reasons: Vec<String>,
    pub model_id: String,
    pub signer: String,
    pub chat_id: String,
    pub request_hash: String,
    pub response_hash: String,
    pub recorded_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: U64,
    pub agent: AccountId,
    pub request: PaymentRequest,
    /// sha256 of the private evidence bundle the agent sent to the guardian.
    pub context_hash: Option<String>,
    pub status: Status,
    pub created_at: U64,
    pub screen_deadline: U64,
    pub verdict: Option<VerdictRecord>,
    pub override_executes_at: Option<U64>,
    pub settled_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AssetPolicy {
    pub period_limit: U128,
    pub max_single: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct PendingPolicy {
    pub policy: AssetPolicy,
    pub effective_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payee {
    pub name: String,
    pub chain: String,
    pub address: String,
    pub added_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct AgentInfo {
    pub active: bool,
    pub added_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct SignerInfo {
    pub model_id: String,
    pub added_at: U64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
struct SpentWindow {
    period: u64,
    spent: u128,
}

#[near(serializers = [json])]
pub struct SpendStatus {
    pub asset: String,
    pub period: U64,
    pub spent: U128,
    pub period_limit: U128,
    pub remaining: U128,
    pub resets_at: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub frozen: bool,
    pub mandate: String,
    pub require_listed_payee: bool,
    pub period_secs: U64,
    pub period_anchor_secs: U64,
    pub override_delay_secs: U64,
    pub raise_delay_secs: U64,
    pub screen_timeout_secs: U64,
    pub proposal_count: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    guardian: AccountId,
    frozen: bool,
    mandate: String,
    require_listed_payee: bool,
    period_secs: u64,
    period_anchor_secs: u64,
    override_delay_secs: u64,
    raise_delay_secs: u64,
    screen_timeout_secs: u64,
    agents: IterableMap<AccountId, AgentInfo>,
    payees: IterableMap<String, Payee>,
    signers: IterableMap<String, SignerInfo>,
    policies: IterableMap<String, AssetPolicy>,
    pending_policies: IterableMap<String, PendingPolicy>,
    spent: LookupMap<String, SpentWindow>,
    proposals: Vector<Proposal>,
    open_proposals: IterableSet<u64>,
}

#[near]
impl Vault {
    /// `period_anchor_secs` is the unix time a spending period starts from
    /// (e.g. a Monday 00:00 WAT). Delays default to 24h and the period to 7 days.
    /// Starting policies apply at once; later raises wait for the raise delay.
    #[init]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        mandate: String,
        policies: Vec<(String, AssetPolicy)>,
        period_anchor_secs: U64,
        period_secs: Option<U64>,
        override_delay_secs: Option<U64>,
        raise_delay_secs: Option<U64>,
        screen_timeout_secs: Option<U64>,
    ) -> Self {
        require!(mandate.len() <= MAX_MANDATE_LEN, "mandate is too long");
        let period_secs = period_secs.map_or(DEFAULT_PERIOD_SECS, |v| v.0);
        require!(period_secs > 0, "period must be positive");
        let mut vault = Self {
            owner,
            guardian,
            frozen: false,
            mandate,
            require_listed_payee: false,
            period_secs,
            period_anchor_secs: period_anchor_secs.0,
            override_delay_secs: override_delay_secs.map_or(DEFAULT_DELAY_SECS, |v| v.0),
            raise_delay_secs: raise_delay_secs.map_or(DEFAULT_DELAY_SECS, |v| v.0),
            screen_timeout_secs: screen_timeout_secs.map_or(DEFAULT_SCREEN_TIMEOUT_SECS, |v| v.0),
            agents: IterableMap::new(StorageKey::Agents),
            payees: IterableMap::new(StorageKey::Payees),
            signers: IterableMap::new(StorageKey::Signers),
            policies: IterableMap::new(StorageKey::Policies),
            pending_policies: IterableMap::new(StorageKey::PendingPolicies),
            spent: LookupMap::new(StorageKey::Spent),
            proposals: Vector::new(StorageKey::Proposals),
            open_proposals: IterableSet::new(StorageKey::OpenProposals),
        };
        for (asset, policy) in policies {
            require!(policy.max_single.0 <= policy.period_limit.0, "max_single exceeds period_limit");
            vault.policies.insert(asset, policy);
        }
        vault
    }

    // ---------------------------------------------------------------- agent

    /// Called by a registered agent. Returns the proposal id; the guardian screens it next.
    pub fn propose(&mut self, request: PaymentRequest, context_hash: Option<String>) -> U64 {
        let agent = env::predecessor_account_id();
        require!(
            self.agents.get(&agent).is_some_and(|a| a.active),
            "caller is not an active agent"
        );
        require!(!self.frozen, "vault is frozen");
        require!(
            self.open_proposals.len() < MAX_OPEN_PROPOSALS,
            "too many open proposals"
        );
        self.validate_request(&request);
        if let Some(hash) = &context_hash {
            require!(verdict::is_hex_32(hash), "context_hash must be 64 lowercase hex chars");
        }
        self.check_caps(&request.asset, request.amount.0);

        let now = env::block_timestamp();
        let id = self.proposals.len() as u64;
        let proposal = Proposal {
            id: U64(id),
            agent: agent.clone(),
            request,
            context_hash,
            status: Status::Screening,
            created_at: U64(now),
            screen_deadline: U64(now + self.screen_timeout_secs * NANOS_PER_SEC),
            verdict: None,
            override_executes_at: None,
            settled_at: None,
        };
        let hash = self.proposal_hash_of(&proposal);
        emit(
            "proposal_created",
            json!({ "id": U64(id), "agent": agent, "request": proposal.request, "proposal_hash": hash }),
        );
        self.proposals.push(proposal);
        self.open_proposals.insert(id);
        U64(id)
    }

    // ------------------------------------------------------------- guardian

    /// Records the AI screen's verdict. Only the guardian may submit, and the response
    /// must carry a valid enclave signature from an approved model key and echo this
    /// proposal's id and hash. A PASS pays immediately if the caps still allow it.
    pub fn submit_verdict(
        &mut self,
        id: U64,
        model_id: String,
        chat_id: String,
        request_hash: String,
        response: Base64VecU8,
        signature: String,
    ) -> Status {
        require!(env::predecessor_account_id() == self.guardian, "only the guardian submits verdicts");
        require!(!self.frozen, "vault is frozen");
        let mut proposal = self.proposal(id.0);
        require!(proposal.status == Status::Screening, "proposal is not awaiting a verdict");
        let now = env::block_timestamp();
        require!(now <= proposal.screen_deadline.0, "screening deadline has passed");

        let request_hash = request_hash.trim().to_ascii_lowercase();
        require!(verdict::is_hex_32(&request_hash), "request_hash must be 64 hex chars");
        let response = response.0;
        require!(response.len() <= verdict::MAX_RESPONSE_BYTES, "response is too large");

        let text = verdict::signed_text(&model_id, &request_hash, &response);
        let signature = hex::decode(signature.trim().trim_start_matches("0x"))
            .unwrap_or_else(|_| env::panic_str("signature is not hex"));
        let signer = verdict::recover_signer(&verdict::eip191_hash(text.as_bytes()), &signature)
            .unwrap_or_else(|| env::panic_str("signature does not recover"));
        let signer = format!("0x{}", hex::encode(signer));
        let approved = self
            .signers
            .get(&signer)
            .unwrap_or_else(|| env::panic_str("signer is not an approved model key"));
        require!(approved.model_id == model_id, "signer is approved for a different model");

        let parsed = verdict::parse_completion(&response).unwrap_or_else(|e| env::panic_str(e));
        require!(parsed.proposal_id == id.0, "verdict is for a different proposal");
        require!(
            parsed.proposal_hash == self.proposal_hash_of(&proposal),
            "verdict does not match this proposal"
        );

        let pass = parsed.decision == Decision::Pass;
        proposal.verdict = Some(VerdictRecord {
            pass,
            reasons: parsed.reasons,
            model_id,
            signer,
            chat_id,
            request_hash,
            response_hash: hex::encode(env::sha256_array(&response)),
            recorded_at: U64(now),
        });
        emit(
            "verdict_recorded",
            json!({ "id": id, "pass": pass, "verdict": proposal.verdict }),
        );

        if pass {
            self.execute(&mut proposal);
        } else {
            proposal.status = Status::Vetoed;
            proposal.settled_at = Some(U64(now));
            self.open_proposals.remove(&id.0);
        }
        let status = proposal.status.clone();
        self.save(proposal);
        status
    }

    /// Anyone may expire a proposal whose screening deadline passed without a verdict.
    pub fn expire(&mut self, id: U64) {
        let mut proposal = self.proposal(id.0);
        require!(proposal.status == Status::Screening, "proposal is not awaiting a verdict");
        require!(env::block_timestamp() > proposal.screen_deadline.0, "deadline has not passed");
        proposal.status = Status::Expired;
        proposal.settled_at = Some(U64(env::block_timestamp()));
        self.open_proposals.remove(&id.0);
        emit("proposal_expired", json!({ "id": id }));
        self.save(proposal);
    }

    // ---------------------------------------------------------------- owner

    /// Schedules a vetoed payment to pay after the override delay. It still has to fit the caps.
    pub fn override_veto(&mut self, id: U64) {
        self.assert_owner();
        require!(!self.frozen, "vault is frozen");
        require!(self.open_proposals.len() < MAX_OPEN_PROPOSALS, "too many open proposals");
        let mut proposal = self.proposal(id.0);
        require!(proposal.status == Status::Vetoed, "only a vetoed payment can be overridden");
        let at = env::block_timestamp() + self.override_delay_secs * NANOS_PER_SEC;
        proposal.status = Status::OverridePending;
        proposal.override_executes_at = Some(U64(at));
        proposal.settled_at = None;
        self.open_proposals.insert(id.0);
        emit("override_scheduled", json!({ "id": id, "executes_at": U64(at) }));
        self.save(proposal);
    }

    pub fn cancel_override(&mut self, id: U64) {
        self.assert_owner();
        let mut proposal = self.proposal(id.0);
        require!(proposal.status == Status::OverridePending, "no override is pending");
        self.cancel(&mut proposal);
        self.save(proposal);
    }

    /// Anyone may trigger an override once its delay has passed.
    pub fn execute_override(&mut self, id: U64) {
        require!(!self.frozen, "vault is frozen");
        let mut proposal = self.proposal(id.0);
        require!(proposal.status == Status::OverridePending, "no override is pending");
        require!(
            env::block_timestamp() >= proposal.override_executes_at.map_or(u64::MAX, |t| t.0),
            "override delay has not passed"
        );
        self.execute(&mut proposal);
        self.save(proposal);
    }

    /// Stops all payments and cancels pending overrides. Open screenings will expire.
    pub fn freeze(&mut self) {
        self.assert_owner();
        self.frozen = true;
        let pending: Vec<u64> = self.open_proposals.iter().copied().collect();
        for id in pending {
            let mut proposal = self.proposal(id);
            if proposal.status == Status::OverridePending {
                self.cancel(&mut proposal);
                self.save(proposal);
            }
        }
        emit("frozen", json!({ "by": self.owner }));
    }

    pub fn unfreeze(&mut self) {
        self.assert_owner();
        self.frozen = false;
        emit("unfrozen", json!({ "by": self.owner }));
    }

    /// Lowering a limit applies now. Raising one, or adding a new asset, waits for the raise delay.
    pub fn set_policy(&mut self, asset: String, policy: AssetPolicy) {
        self.assert_owner();
        require!(policy.max_single.0 <= policy.period_limit.0, "max_single exceeds period_limit");
        let tighter = self.policies.get(&asset).is_some_and(|current| {
            policy.period_limit.0 <= current.period_limit.0 && policy.max_single.0 <= current.max_single.0
        });
        if tighter {
            self.policies.insert(asset.clone(), policy.clone());
            self.pending_policies.remove(&asset);
            emit("policy_updated", json!({ "asset": asset, "policy": policy }));
        } else {
            let at = env::block_timestamp() + self.raise_delay_secs * NANOS_PER_SEC;
            self.pending_policies
                .insert(asset.clone(), PendingPolicy { policy: policy.clone(), effective_at: U64(at) });
            emit("policy_raise_scheduled", json!({ "asset": asset, "policy": policy, "effective_at": U64(at) }));
        }
    }

    /// Anyone may apply a scheduled raise once its delay has passed.
    pub fn apply_policy(&mut self, asset: String) {
        let pending = self
            .pending_policies
            .get(&asset)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no change is scheduled"));
        require!(env::block_timestamp() >= pending.effective_at.0, "raise delay has not passed");
        self.pending_policies.remove(&asset);
        self.policies.insert(asset.clone(), pending.policy.clone());
        emit("policy_updated", json!({ "asset": asset, "policy": pending.policy }));
    }

    pub fn cancel_policy_change(&mut self, asset: String) {
        self.assert_owner();
        require!(self.pending_policies.remove(&asset).is_some(), "no change is scheduled");
        emit("policy_raise_cancelled", json!({ "asset": asset }));
    }

    pub fn set_mandate(&mut self, mandate: String) {
        self.assert_owner();
        require!(mandate.len() <= MAX_MANDATE_LEN, "mandate is too long");
        self.mandate = mandate;
        emit("mandate_updated", json!({ "mandate_hash": hex::encode(env::sha256_array(self.mandate.as_bytes())) }));
    }

    pub fn set_require_listed_payee(&mut self, required: bool) {
        self.assert_owner();
        self.require_listed_payee = required;
    }

    pub fn add_payee(&mut self, name: String, chain: String, address: String) {
        self.assert_owner();
        require!(!name.is_empty() && name.len() <= 64, "name must be 1-64 chars");
        let key = payee_key(&chain, &address);
        let payee = Payee { name, chain, address: address.trim().to_string(), added_at: U64(env::block_timestamp()) };
        emit("payee_added", json!({ "key": key, "payee": payee }));
        self.payees.insert(key, payee);
    }

    pub fn remove_payee(&mut self, chain: String, address: String) {
        self.assert_owner();
        let key = payee_key(&chain, &address);
        require!(self.payees.remove(&key).is_some(), "payee not found");
        emit("payee_removed", json!({ "key": key }));
    }

    pub fn add_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agents.insert(agent.clone(), AgentInfo { active: true, added_at: U64(env::block_timestamp()) });
        emit("agent_added", json!({ "agent": agent }));
    }

    pub fn set_agent_active(&mut self, agent: AccountId, active: bool) {
        self.assert_owner();
        let info = self.agents.get_mut(&agent).unwrap_or_else(|| env::panic_str("agent not found"));
        info.active = active;
        emit("agent_updated", json!({ "agent": agent, "active": active }));
    }

    pub fn remove_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        require!(self.agents.remove(&agent).is_some(), "agent not found");
        emit("agent_removed", json!({ "agent": agent }));
    }

    /// Approves a model signing key after the owner has checked its TEE attestation off-chain.
    pub fn add_signer(&mut self, address: String, model_id: String) {
        self.assert_owner();
        let address = verdict::normalize_address(&address)
            .unwrap_or_else(|| env::panic_str("address must be 20 bytes of hex"));
        require!(!model_id.is_empty(), "model_id is required");
        emit("signer_added", json!({ "address": address, "model_id": model_id }));
        self.signers.insert(address, SignerInfo { model_id, added_at: U64(env::block_timestamp()) });
    }

    pub fn remove_signer(&mut self, address: String) {
        self.assert_owner();
        let address = verdict::normalize_address(&address)
            .unwrap_or_else(|| env::panic_str("address must be 20 bytes of hex"));
        require!(self.signers.remove(&address).is_some(), "signer not found");
        emit("signer_removed", json!({ "address": address }));
    }

    pub fn set_guardian(&mut self, guardian: AccountId) {
        self.assert_owner();
        self.guardian = guardian.clone();
        emit("guardian_updated", json!({ "guardian": guardian }));
    }

    /// The owner can always take funds back, but only to the owner account.
    pub fn withdraw_to_owner(&mut self, asset: String, amount: U128) -> Promise {
        self.assert_owner();
        let owner = self.owner.clone();
        if asset == NATIVE {
            Promise::new(owner).transfer(NearToken::from_yoctonear(amount.0))
        } else {
            let token: AccountId = asset.parse().unwrap_or_else(|_| env::panic_str("asset is not an account id"));
            ft_transfer(token, &owner, amount, Some("veto: owner withdrawal".into()))
        }
    }

    // -------------------------------------------------------------- private

    #[private]
    pub fn on_payment_settled(&mut self, id: U64) -> bool {
        // Only success matters here; a non-empty result just reports TooLong.
        let ok = !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        let mut proposal = self.proposal(id.0);
        if proposal.status != Status::Executing {
            return false;
        }
        if ok {
            proposal.status = Status::Paid;
        } else {
            proposal.status = Status::Failed;
            self.release_spend(&proposal.request.asset, proposal.request.amount.0);
        }
        proposal.settled_at = Some(U64(env::block_timestamp()));
        emit("payment_settled", json!({ "id": id, "paid": ok }));
        self.save(proposal);
        ok
    }

    // ---------------------------------------------------------------- views

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            guardian: self.guardian.clone(),
            frozen: self.frozen,
            mandate: self.mandate.clone(),
            require_listed_payee: self.require_listed_payee,
            period_secs: U64(self.period_secs),
            period_anchor_secs: U64(self.period_anchor_secs),
            override_delay_secs: U64(self.override_delay_secs),
            raise_delay_secs: U64(self.raise_delay_secs),
            screen_timeout_secs: U64(self.screen_timeout_secs),
            proposal_count: U64(self.proposals.len() as u64),
        }
    }

    pub fn get_proposal(&self, id: U64) -> Option<Proposal> {
        u32::try_from(id.0).ok().and_then(|i| self.proposals.get(i)).cloned()
    }

    /// Newest first.
    pub fn get_proposals(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Proposal> {
        let len = self.proposals.len() as u64;
        let skip = from_index.map_or(0, |v| v.0);
        let limit = limit.unwrap_or(20).min(100) as u64;
        (0..len)
            .rev()
            .skip(skip as usize)
            .take(limit as usize)
            .filter_map(|i| self.proposals.get(i as u32).cloned())
            .collect()
    }

    pub fn get_open_proposals(&self) -> Vec<Proposal> {
        self.open_proposals
            .iter()
            .filter_map(|id| self.proposals.get(*id as u32).cloned())
            .collect()
    }

    /// The hash the screening model must echo back for this proposal.
    pub fn get_proposal_hash(&self, id: U64) -> String {
        self.proposal_hash_of(&self.proposal(id.0))
    }

    pub fn get_policies(&self) -> Vec<(String, AssetPolicy)> {
        self.policies.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_pending_policies(&self) -> Vec<(String, PendingPolicy)> {
        self.pending_policies.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_spend(&self, asset: String) -> SpendStatus {
        let policy = self.policies.get(&asset).cloned().unwrap_or_else(|| env::panic_str("asset is not allowed"));
        let period = self.period_at(env::block_timestamp());
        let spent = self.spent_in(&asset, period);
        SpendStatus {
            asset,
            period: U64(period),
            spent: U128(spent),
            period_limit: policy.period_limit,
            remaining: U128(policy.period_limit.0.saturating_sub(spent)),
            resets_at: U64(self.period_anchor_secs + (period + 1) * self.period_secs),
        }
    }

    pub fn get_payees(&self) -> Vec<Payee> {
        self.payees.values().cloned().collect()
    }

    pub fn get_agents(&self) -> Vec<(AccountId, AgentInfo)> {
        self.agents.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_signers(&self) -> Vec<(String, SignerInfo)> {
        self.signers.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }
}

// ------------------------------------------------------------------- internals

impl Vault {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can do this");
    }

    fn proposal(&self, id: u64) -> Proposal {
        u32::try_from(id)
            .ok()
            .and_then(|i| self.proposals.get(i))
            .cloned()
            .unwrap_or_else(|| env::panic_str("proposal not found"))
    }

    fn save(&mut self, proposal: Proposal) {
        let index = proposal.id.0 as u32;
        self.proposals.replace(index, proposal);
    }

    fn validate_request(&self, request: &PaymentRequest) {
        require!(request.chain == NATIVE, "only chain \"near\" is supported in this version");
        require!(request.amount.0 > 0, "amount must be positive");
        require!(request.memo.as_ref().map_or(true, |m| m.len() <= MAX_MEMO_LEN), "memo is too long");
        require!(request.payee.parse::<AccountId>().is_ok(), "payee is not a valid NEAR account");
        require!(request.payee != env::current_account_id().as_str(), "vault cannot pay itself");
        if request.asset != NATIVE {
            require!(request.asset.parse::<AccountId>().is_ok(), "asset is not a token account");
        }
        if self.require_listed_payee {
            require!(
                self.payees.get(&payee_key(&request.chain, &request.payee)).is_some(),
                "payee is not on the list"
            );
        }
    }

    fn check_caps(&self, asset: &str, amount: u128) {
        let policy = self.policies.get(asset).unwrap_or_else(|| env::panic_str("asset is not allowed"));
        require!(amount <= policy.max_single.0, "amount exceeds the single-payment limit");
        let spent = self.spent_in(asset, self.period_at(env::block_timestamp()));
        require!(
            spent.checked_add(amount).is_some_and(|total| total <= policy.period_limit.0),
            "amount exceeds what is left of the period limit"
        );
    }

    fn period_at(&self, timestamp_ns: u64) -> u64 {
        (timestamp_ns / NANOS_PER_SEC).saturating_sub(self.period_anchor_secs) / self.period_secs
    }

    fn spent_in(&self, asset: &str, period: u64) -> u128 {
        self.spent
            .get(asset)
            .filter(|w| w.period == period)
            .map_or(0, |w| w.spent)
    }

    fn record_spend(&mut self, asset: &str, amount: u128) {
        let period = self.period_at(env::block_timestamp());
        let spent = self.spent_in(asset, period) + amount;
        self.spent.insert(asset.to_string(), SpentWindow { period, spent });
    }

    /// Gives back a failed payment's spend, if it was counted in the current period.
    fn release_spend(&mut self, asset: &str, amount: u128) {
        let period = self.period_at(env::block_timestamp());
        if let Some(window) = self.spent.get_mut(asset) {
            if window.period == period {
                window.spent = window.spent.saturating_sub(amount);
            }
        }
    }

    /// Re-checks freeze and caps, records the spend and sends the transfer.
    fn execute(&mut self, proposal: &mut Proposal) {
        require!(!self.frozen, "vault is frozen");
        let request = proposal.request.clone();
        self.check_caps(&request.asset, request.amount.0);
        self.record_spend(&request.asset, request.amount.0);
        proposal.status = Status::Executing;
        self.open_proposals.remove(&proposal.id.0);

        let payee: AccountId = request.payee.parse().unwrap_or_else(|_| env::panic_str("invalid payee"));
        let transfer = if request.asset == NATIVE {
            Promise::new(payee).transfer(NearToken::from_yoctonear(request.amount.0))
        } else {
            let token: AccountId = request.asset.parse().unwrap_or_else(|_| env::panic_str("invalid asset"));
            ft_transfer(token, &payee, request.amount, request.memo.clone())
        };
        // Scheduled when dropped; the settlement callback marks the proposal Paid or Failed.
        let _ = transfer.then(
            Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_payment_settled(proposal.id),
        );
        emit("payment_sent", json!({ "id": proposal.id, "request": request }));
    }

    fn cancel(&mut self, proposal: &mut Proposal) {
        proposal.status = Status::Cancelled;
        proposal.override_executes_at = None;
        proposal.settled_at = Some(U64(env::block_timestamp()));
        self.open_proposals.remove(&proposal.id.0);
        emit("override_cancelled", json!({ "id": proposal.id }));
    }

    /// sha256 over a fixed text form of the proposal. The guardian computes the same string.
    fn proposal_hash_of(&self, proposal: &Proposal) -> String {
        let r = &proposal.request;
        let text = format!(
            "veto:v1:{}:{}:{}:{}:{}:{}:{}:{}",
            env::current_account_id(),
            proposal.id.0,
            r.chain,
            r.asset,
            r.payee,
            r.amount.0,
            r.memo.as_deref().unwrap_or(""),
            proposal.context_hash.as_deref().unwrap_or(""),
        );
        hex::encode(env::sha256_array(text.as_bytes()))
    }
}

fn payee_key(chain: &str, address: &str) -> String {
    format!("{}:{}", chain.trim().to_ascii_lowercase(), address.trim().to_ascii_lowercase())
}

fn ft_transfer(token: AccountId, receiver: &AccountId, amount: U128, memo: Option<String>) -> Promise {
    Promise::new(token).function_call(
        "ft_transfer".to_string(),
        serde_json::to_vec(&json!({ "receiver_id": receiver, "amount": amount, "memo": memo }))
            .unwrap_or_default(),
        NearToken::from_yoctonear(1),
        GAS_FT_TRANSFER,
    )
}

fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "veto", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests;
