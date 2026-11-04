//! Veto vault factory: anyone with a NEAR account creates their own vault, owned by them.
//!
//! The vault code is deployed once as a global contract; each vault is a sub-account of the
//! factory that uses that code by hash, so a new vault costs only its account and its state.
//! Each vault also gets its own agent account (`<name>_agent`) and screening account
//! (`<name>_guard`), whose only keys are function-call keys for that one vault: the agent's can
//! call `propose`, the guardian's the verdict methods. The service running them never holds a key
//! that can do anything else. The factory sponsors all three accounts, registers the vault with
//! the test USDC token and sends it starter funds. Every owner action on the new vault is then
//! signed by its owner's own wallet.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, Allowance, BorshStorageKey, CryptoHash, Gas, NearToken, PanicOnDefault, Promise, PublicKey};

/// The new vault's account balance: pays for its state as payments accumulate (0.5 NEAR ≈ 50 KB,
/// a few dozen payments). Top it up from any wallet for more.
const VAULT_DEPOSIT: NearToken = NearToken::from_millinear(500);
/// Gas money for the vault's agent and screening accounts. A call reserves its attached gas up
/// front (a verdict attaches 100 Tgas, about 0.1 NEAR at testnet's gas price) and refunds what it
/// doesn't burn, so each needs that much on hand plus what it burns over time. Anyone can top
/// them up with a plain transfer.
const AGENT_DEPOSIT: NearToken = NearToken::from_millinear(100);
const GUARDIAN_DEPOSIT: NearToken = NearToken::from_millinear(300);
const AGENT_METHODS: &str = "propose";
const GUARDIAN_METHODS: &str = "submit_verdict,expire,execute_override";
/// NEP-141 storage registration for the vault on the token.
const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
const GAS_INIT: Gas = Gas::from_tgas(40);
const GAS_CALLBACK: Gas = Gas::from_tgas(60);
const GAS_FT: Gas = Gas::from_tgas(15);
const MAX_VAULTS_PER_OWNER: usize = 3;
const MAX_NAME_LEN: usize = 24;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Vaults,
}

/// What every new vault starts with. The owner can change all of it afterwards.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Template {
    /// The screening service's key, added to each vault's own `<name>_guard` account.
    pub guardian_key: PublicKey,
    /// The agent's key, added to each vault's own `<name>_agent` account.
    pub agent_key: PublicKey,
    /// The approved model key: (0x address, model id). Only an enclave key, no test signer.
    pub signer: (String, String),
    /// The NEP-141 token the vault holds and its starting balance.
    pub token: AccountId,
    pub starter_funds: U128,
    pub max_single: U128,
    pub period_limit: U128,
    /// (name, chain, address) suppliers to start with.
    pub payees: Vec<(String, String, String)>,
    pub mandate: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct VaultInfo {
    pub owner: AccountId,
    pub label: String,
    pub created_at: U64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Factory {
    admin: AccountId,
    code_hash: CryptoHash,
    template: Template,
    vaults: IterableMap<AccountId, VaultInfo>,
}

#[near]
impl Factory {
    #[init]
    pub fn new(admin: AccountId, code_hash: Base58CryptoHash, template: Template) -> Self {
        Self { admin, code_hash: code_hash.into(), template, vaults: IterableMap::new(StorageKey::Vaults) }
    }

    /// Creates `<name>.<factory>` for the caller, who becomes its owner, plus its agent and
    /// screening accounts. `label` is the business name shown in the app.
    pub fn create_vault(&mut self, name: String, label: String, mandate: Option<String>) -> Promise {
        require!(
            name.len() >= 2 && name.len() <= MAX_NAME_LEN && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && !name.starts_with('-') && !name.ends_with('-') && !name.contains("--"),
            "name must be 2-24 lowercase letters, digits or single dashes"
        );
        require!(!label.trim().is_empty() && label.len() <= 48, "label must be 1-48 characters");
        let owner = env::predecessor_account_id();
        require!(
            self.vaults.values().filter(|v| v.owner == owner).count() < MAX_VAULTS_PER_OWNER,
            "this account already has the most vaults the testnet factory sponsors"
        );
        let vault: AccountId = format!("{name}.{}", env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str("invalid vault name"));
        require!(!self.vaults.contains_key(&vault), "that vault name is taken");

        let (agent, guardian) = Self::helpers(&name);
        let t = &self.template;
        let now_secs = env::block_timestamp() / 1_000_000_000;
        let init = json!({
            "owner": owner,
            "guardian": guardian,
            "mandate": mandate.filter(|m| !m.trim().is_empty() && m.len() <= 2000).unwrap_or_else(|| t.mandate.clone()),
            "policies": [[t.token, { "period_limit": t.period_limit, "max_single": t.max_single }]],
            "period_anchor_secs": U64(now_secs),
            "override_delay_secs": U64(180),
            "raise_delay_secs": U64(180),
            "screen_timeout_secs": U64(600),
            "agents": [agent],
            "signers": [[t.signer.0, t.signer.1]],
            "payees": t.payees,
        });
        Promise::new(vault.clone())
            .create_account()
            .transfer(VAULT_DEPOSIT)
            .use_global_contract(self.code_hash)
            .function_call("new".to_string(), serde_json::to_vec(&init).unwrap_or_default(), NearToken::from_yoctonear(0), GAS_INIT)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_vault_created(name, owner, label.trim().to_string()))
    }

    /// `<name>_agent.<factory>` and `<name>_guard.<factory>`. Vault names can't contain `_`, so these
    /// never collide with a vault.
    fn helpers(name: &str) -> (AccountId, AccountId) {
        let factory = env::current_account_id();
        let agent = format!("{name}_agent.{factory}").parse().unwrap_or_else(|_| env::panic_str("name is too long for this factory"));
        let guardian = format!("{name}_guard.{factory}").parse().unwrap_or_else(|_| env::panic_str("name is too long for this factory"));
        (agent, guardian)
    }

    /// Records the vault once it exists, creates its agent and screening accounts (each holding
    /// one key that can only call this vault), then registers the vault with the token and funds it.
    #[private]
    pub fn on_vault_created(&mut self, name: String, owner: AccountId, label: String) -> bool {
        if env::promise_result_checked(0, 0).is_err() {
            return false;
        }
        let vault: AccountId = format!("{name}.{}", env::current_account_id()).parse().unwrap_or_else(|_| env::panic_str("invalid vault name"));
        let (agent, guardian) = Self::helpers(&name);
        self.vaults.insert(vault.clone(), VaultInfo { owner: owner.clone(), label, created_at: U64(env::block_timestamp()) });
        env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": "veto-factory", "version": "1.0.0", "event": "vault_created", "data": [{ "vault": vault, "owner": owner, "agent": agent, "guardian": guardian }] })));
        let _ = Promise::new(agent)
            .create_account()
            .transfer(AGENT_DEPOSIT)
            .add_access_key_allowance(self.template.agent_key.clone(), Allowance::Unlimited, vault.clone(), AGENT_METHODS);
        let _ = Promise::new(guardian)
            .create_account()
            .transfer(GUARDIAN_DEPOSIT)
            .add_access_key_allowance(self.template.guardian_key.clone(), Allowance::Unlimited, vault.clone(), GUARDIAN_METHODS);
        let token = self.template.token.clone();
        let register = Promise::new(token.clone()).function_call(
            "storage_deposit".to_string(),
            serde_json::to_vec(&json!({ "account_id": vault, "registration_only": true })).unwrap_or_default(),
            STORAGE_DEPOSIT,
            GAS_FT,
        );
        let fund = Promise::new(token).function_call(
            "ft_transfer".to_string(),
            serde_json::to_vec(&json!({ "receiver_id": vault, "amount": self.template.starter_funds, "memo": "veto: starter test funds" })).unwrap_or_default(),
            NearToken::from_yoctonear(1),
            GAS_FT,
        );
        let _ = register.then(fund);
        true
    }

    /// Points new vaults at a newer vault release; existing vaults keep the code they were made with.
    pub fn set_code_hash(&mut self, code_hash: Base58CryptoHash) {
        require!(env::predecessor_account_id() == self.admin, "only the admin");
        self.code_hash = code_hash.into();
    }

    pub fn set_template(&mut self, template: Template) {
        require!(env::predecessor_account_id() == self.admin, "only the admin");
        self.template = template;
    }

    pub fn get_vault(&self, vault: AccountId) -> Option<VaultInfo> {
        self.vaults.get(&vault).cloned()
    }

    pub fn vaults_of(&self, owner: AccountId) -> Vec<(AccountId, VaultInfo)> {
        self.vaults.iter().filter(|(_, v)| v.owner == owner).map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn get_template(&self) -> Template {
        self.template.clone()
    }

    pub fn get_code_hash(&self) -> Base58CryptoHash {
        self.code_hash.into()
    }

    pub fn count(&self) -> u32 {
        self.vaults.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn template() -> Template {
        Template {
            guardian_key: "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp".parse().unwrap(),
            agent_key: "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847".parse().unwrap(),
            signer: ("0x2665cce942fa427ef30d87f4b0bff67fb7645462".into(), "Qwen/Qwen3-VL-30B-A3B-Instruct".into()),
            token: "usdc.testnet".parse().unwrap(),
            starter_funds: U128(5_000_000_000),
            max_single: U128(500_000_000),
            period_limit: U128(3_000_000_000),
            payees: vec![("Kano Cotton Mills".into(), "near".into(), "kano-cotton.testnet".into())],
            mandate: "Pay listed suppliers only.".into(),
        }
    }

    fn factory(caller: &str) -> Factory {
        testing_env!(VMContextBuilder::new()
            .current_account_id("factory.testnet".parse().unwrap())
            .predecessor_account_id(caller.parse().unwrap())
            .account_balance(NearToken::from_near(50))
            .build());
        Factory::new("admin.testnet".parse().unwrap(), Base58CryptoHash::from([7u8; 32]), template())
    }

    #[test]
    fn anyone_can_ask_for_a_vault() {
        let mut f = factory("alice.testnet");
        let _ = f.create_vault("alice-goods".into(), "Alice Goods".into(), None);
        assert_eq!(f.get_code_hash(), Base58CryptoHash::from([7u8; 32]));
    }

    #[test]
    #[should_panic(expected = "name must be 2-24 lowercase letters, digits or single dashes")]
    fn names_must_be_account_safe() {
        let mut f = factory("alice.testnet");
        let _ = f.create_vault("Alice Goods".into(), "Alice Goods".into(), None);
    }

    #[test]
    #[should_panic(expected = "name must be 2-24 lowercase letters, digits or single dashes")]
    fn names_cannot_reach_the_helper_accounts() {
        let mut f = factory("alice.testnet");
        let _ = f.create_vault("alice_agent".into(), "Alice".into(), None);
    }

    #[test]
    fn each_vault_gets_its_own_agent_and_guardian() {
        let _ = factory("alice.testnet");
        let (agent, guardian) = Factory::helpers("alice-goods");
        assert_eq!(agent.as_str(), "alice-goods_agent.factory.testnet");
        assert_eq!(guardian.as_str(), "alice-goods_guard.factory.testnet");
    }

    #[test]
    #[should_panic(expected = "only the admin")]
    fn only_the_admin_changes_the_code() {
        let mut f = factory("alice.testnet");
        f.set_code_hash(Base58CryptoHash::from([1u8; 32]));
    }
}
