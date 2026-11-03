// Builds the public testnet demo: a fresh vault on the current contract, test USDC, the
// agent, guardian and demo-owner keys, an OutLayer agent wallet that needs Veto's approval,
// and the env file the web app's demo API reads.
// Safe to re-run; finished steps are skipped.
//   node scripts/demo-setup.ts            (profile "demo2", state in .veto-dev/demo2.json)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";
import { actions, KeyPair, nearToYocto, PublicKey, teraToGas, yoctoToNear, type KeyPairString } from "near-api-js";
import { DEFAULT_MODEL, modelAttestation, OutLayer } from "@veto/core";
// "demo2": the vault with external-wallet payments. The older "demo" vault can't be upgraded in place.
process.env.VETO_PROFILE ??= "demo2";
const { account, exists, loadState, newKey, saveState } = await import("./dev-state.ts");

const NETWORK = "testnet";
const FAUCET = "https://helper.nearprotocol.com/account";
const VAULT_WASM = new URL("../contract/target/wasm32-unknown-unknown/release/veto_vault.wasm", import.meta.url);
const TOKEN_WASM = new URL("../test-token/target/wasm32-unknown-unknown/release/veto_test_usdc.wasm", import.meta.url);
const USD = 1_000_000n;
const MANDATE = "Pay listed suppliers only, in USDC. No single payment over $500. Ask me before paying a new or changed address.";
const OWNER_METHODS = ["override_veto", "cancel_override", "execute_override", "freeze", "unfreeze", "set_mandate", "add_payee", "remove_payee", "set_agent_active"];
const SUBS = {
  treasury: { role: "vault", fund: "1" },
  usdc: { role: "token", fund: "0.5" },
  buyer: { role: "agent", fund: "1" },
  guardian: { role: "guardian", fund: "2" },
  "kano-cotton": { role: "payee", fund: "0.05" },
  "ibadan-dye": { role: "payee", fund: "0.05" },
  "kano-cottom": { role: "payee", fund: "0.05" },
  // Votes on the OutLayer wallet's approvals. OutLayer needs a full-access key; the account holds no funds.
  approver: { role: "approver", fund: "0.05" },
} as const;

const state = loadState(NETWORK);
const log = (m: string) => console.log(`• ${m}`);

async function faucetAccount() {
  const key = newKey();
  const accountId = `veto-${Math.random().toString(36).slice(2, 10)}.testnet`;
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused (${res.status}): ${(await res.text()).slice(0, 200)}`);
  for (let i = 0; i < 20 && !(await exists(accountId, NETWORK)); i++) await new Promise((r) => setTimeout(r, 1500));
  return { accountId, key: key.toString() as `ed25519:${string}` };
}

/** Folds fresh faucet accounts into the root until it holds `near`. */
async function ensureRootBalance(near: string) {
  const root = account(state.root!, NETWORK);
  while ((await root.getBalance()) < nearToYocto(near)) {
    const extra = await faucetAccount();
    await account(extra, NETWORK).deleteAccount(state.root!.accountId);
    log(`topped up the root from faucet account ${extra.accountId}`);
  }
}

// 1. Root account and enough testnet NEAR for contract storage.
if (!state.root || !(await exists(state.root.accountId, NETWORK))) {
  state.root = await faucetAccount();
  saveState(state);
  log(`created root ${state.root.accountId}`);
}
const root = account(state.root, NETWORK);
const vaultCode = new Uint8Array(readFileSync(VAULT_WASM));
const tokenCode = new Uint8Array(readFileSync(TOKEN_WASM));
const storage = (code: Uint8Array) => BigInt(code.length) * 10n ** 19n;
if (!state.initialized) await ensureRootBalance(yoctoToNear(storage(vaultCode) + storage(tokenCode) + nearToYocto("6"), 0));
log(`root ${state.root.accountId} holds ${yoctoToNear(await root.getBalance(), 2)} NEAR`);

// 2. Sub-accounts.
state.payees ??= {};
for (const [prefix, spec] of Object.entries(SUBS)) {
  const id = `${prefix}.${state.root.accountId}`;
  if (await exists(id, NETWORK)) continue;
  const key = newKey();
  const extra = spec.role === "vault" ? storage(vaultCode) : spec.role === "token" ? storage(tokenCode) : 0n;
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(spec.fund) + extra });
  const dev = { accountId: id, key: key.toString() as `ed25519:${string}` };
  if (spec.role === "payee") state.payees[prefix] = dev;
  else state[spec.role] = dev;
  saveState(state);
  log(`created ${id}`);
}
const vaultId = state.vault!.accountId;
const tokenId = state.token!.accountId;

// 3. Test USDC.
if (!state.tokenReady) {
  const token = account(state.token!, NETWORK);
  await token.deployContract(tokenCode);
  await token.callFunction({ contractId: tokenId, methodName: "new", args: { owner_id: state.root.accountId }, gas: teraToGas("30") });
  state.tokenReady = true;
  saveState(state);
  log(`deployed test USDC at ${tokenId}`);
}

// 4. The vault, with its policies set at creation.
if (!state.initialized) {
  const vault = account(state.vault!, NETWORK);
  await vault.deployContract(vaultCode);
  await vault.callFunction({
    contractId: vaultId,
    methodName: "new",
    args: {
      owner: state.root.accountId,
      guardian: state.guardian!.accountId,
      mandate: MANDATE,
      policies: [
        [tokenId, { period_limit: String(3_000n * USD), max_single: String(500n * USD) }],
        ["near", { period_limit: nearToYocto("0.5").toString(), max_single: nearToYocto("0.5").toString() }],
      ],
      period_anchor_secs: String(lastMondayWat()),
      // Short so a visitor can watch an override pay out.
      override_delay_secs: "180",
      raise_delay_secs: "180",
      screen_timeout_secs: "600",
    },
    gas: teraToGas("100"),
  });
  state.initialized = true;
  saveState(state);
  log(`deployed and initialised the vault ${vaultId}`);
}

// 5. Funds and token registrations.
const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  root.provider.callFunction({ contractId, method, args, blockQuery: { finality: "optimistic" } }) as Promise<T>;
const call = (contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n) =>
  root.callFunction({ contractId, methodName, args, deposit, gas: teraToGas("30") });
if (BigInt(await view<string>(tokenId, "ft_balance_of", { account_id: vaultId })) === 0n) {
  await call(tokenId, "mint", { account_id: vaultId, amount: String(12_480n * USD) });
  log("minted $12,480.00 test USDC to the vault");
}
for (const payee of Object.values(state.payees)) {
  if (await view(tokenId, "storage_balance_of", { account_id: payee.accountId })) continue;
  await call(tokenId, "storage_deposit", { account_id: payee.accountId, registration_only: true }, nearToYocto("0.00125"));
  log(`registered ${payee.accountId} with the token`);
}

// 6. Agent, payees and the keys the vault trusts for verdicts.
const agents = await view<[string, unknown][]>(vaultId, "get_agents");
if (!agents.some(([id]) => id === state.agent!.accountId)) await call(vaultId, "add_agent", { agent: state.agent!.accountId });
const payees = await view<{ address: string }[]>(vaultId, "get_payees");
for (const [prefix, name] of [["kano-cotton", "Kano Cotton Mills"], ["ibadan-dye", "Ibadan Dye Works"]] as const) {
  const address = state.payees[prefix].accountId;
  if (!payees.some((p) => p.address === address)) {
    await call(vaultId, "add_payee", { name, chain: "near", address });
    log(`added payee ${name}`);
  }
}
const signers = await view<[string, unknown][]>(vaultId, "get_signers");
const { nonce, report } = await modelAttestation(DEFAULT_MODEL);
const attested = (report.model_attestations ?? []).filter((m: { request_nonce?: string; signing_algo?: string }) => m.request_nonce === nonce && m.signing_algo === "ecdsa");
if (attested.length !== 1) throw new Error(`expected one attested key for ${DEFAULT_MODEL}`);
state.modelSigner = String(attested[0].signing_address).toLowerCase();
if (!signers.some(([a]) => a === state.modelSigner)) {
  await call(vaultId, "add_signer", { address: state.modelSigner, model_id: DEFAULT_MODEL });
  log(`approved the attested ${DEFAULT_MODEL} key ${state.modelSigner}`);
}
// Until the NEAR AI key is configured the demo screens with a labelled test key.
if (!state.testSignerKey) {
  const w = Wallet.createRandom();
  state.testSignerKey = w.privateKey;
  state.testSignerAddress = w.address.toLowerCase();
  saveState(state);
}
const rootEnvFile = new URL("../.env.local", import.meta.url);
const liveModel = existsSync(rootEnvFile) && /^NEARAI_API_KEY=\S+/m.test(readFileSync(rootEnvFile, "utf8"));
const trustsTestSigner = signers.some(([a]) => a === state.testSignerAddress);
if (liveModel && trustsTestSigner) {
  // With the real model connected, the vault stops trusting the test key altogether.
  await call(vaultId, "remove_signer", { address: state.testSignerAddress });
  log("NEAR AI key found: removed the demo test signer, so only the enclave's key is trusted");
} else if (!liveModel && !trustsTestSigner) {
  await call(vaultId, "add_signer", { address: state.testSignerAddress, model_id: "veto-dev/local-signer" });
  log(`approved the demo test signer ${state.testSignerAddress}`);
}

// 7. Narrow keys. No allowance cap: each is limited to its methods and its account's balance.
async function narrowKey(holder: { accountId: string; key: `ed25519:${string}` }, methods: string[]) {
  const key = newKey();
  await account(holder, NETWORK).signAndSendTransaction({
    receiverId: holder.accountId,
    actions: [actions.addFunctionCallAccessKey(PublicKey.from(key.getPublicKey().toString()), vaultId, methods, undefined)],
  });
  return key.toString() as `ed25519:${string}`;
}
if (!state.agentProposeKey) state.agentProposeKey = await narrowKey(state.agent!, ["propose"]);
if (!state.guardianVerdictKey) state.guardianVerdictKey = await narrowKey(state.guardian!, ["submit_verdict", "expire", "propose_external", "settle_external"]);
if (!state.ownerDemoKey) state.ownerDemoKey = await narrowKey(state.root, OWNER_METHODS);
saveState(state);
log("agent, guardian and demo-owner keys are limited to their vault methods");

// 8. An OutLayer agent wallet whose policy needs an approval for every payment: Veto's
// approver or the owner. The root is the wallet's owner, as it is the vault's.
const outlayer = new OutLayer("testnet");
if (!state.outlayer) {
  const r = await outlayer.call<{ wallet_id: string; api_key: string; near_account_id: string }>("POST", "/register");
  state.outlayer = { walletId: r.wallet_id, apiKey: r.api_key, account: r.near_account_id };
  saveState(state);
  log(`registered OutLayer wallet ${r.near_account_id}`);
}
const wallet = state.outlayer.account;
if (!(await exists(wallet, NETWORK))) {
  await root.transfer({ receiverId: wallet, amount: nearToYocto("0.5") });
  log("funded the OutLayer wallet with 0.5 NEAR for gas");
}
if (!(await view(tokenId, "storage_balance_of", { account_id: wallet }))) {
  await call(tokenId, "storage_deposit", { account_id: wallet, registration_only: true }, nearToYocto("0.00125"));
  await call(tokenId, "mint", { account_id: wallet, amount: String(3_000n * USD) });
  log("minted $3,000.00 test USDC to the OutLayer wallet");
}
if (!state.outlayer.policyTx) {
  const approverKey = KeyPair.fromString(state.approver!.key as KeyPairString).getPublicKey();
  const policy = {
    wallet_id: state.outlayer.walletId,
    rules: { transaction_types: ["transfer", "call"] },
    approval: {
      threshold: { required: 1 },
      approvers: [
        { id: state.approver!.accountId, role: "signer", pubkey: approverKey.toString() },
        { id: state.root.accountId, role: "admin", pubkey: KeyPair.fromString(state.root.key as KeyPairString).getPublicKey().toString() },
      ],
    },
  };
  const wk = state.outlayer.apiKey;
  const enc = await outlayer.call<{ encrypted_base64: string }>("POST", "/wallet/v1/encrypt-policy", { key: wk, body: policy });
  const sig = await outlayer.call<{ signature_hex: string; public_key_hex: string }>("POST", "/wallet/v1/sign-policy", {
    key: wk,
    body: { encrypted_data: enc.encrypted_base64, caller: state.root.accountId },
  });
  // encrypt-policy's own wallet_pubkey field holds the wallet id; the contract wants the key.
  const walletPubkey = `ed25519:${sig.public_key_hex}`;
  const cost = await view<string>(outlayer.contract, "estimate_wallet_policy_cost", { wallet_pubkey: walletPubkey, encrypted_data: enc.encrypted_base64 });
  const out = await root.signAndSendTransaction({
    receiverId: outlayer.contract,
    actions: [
      actions.functionCall(
        "store_wallet_policy",
        { wallet_pubkey: walletPubkey, encrypted_data: enc.encrypted_base64, wallet_signature: sig.signature_hex },
        teraToGas("100"),
        BigInt(cost) + nearToYocto("0.01"),
      ),
    ],
    waitUntil: "FINAL",
  });
  await outlayer.call("POST", "/wallet/v1/invalidate-cache", { body: { wallet_id: state.outlayer.walletId } });
  state.outlayer.policyTx = out.transaction.hash;
  saveState(state);
  log(`stored the OutLayer wallet policy: every payment needs Veto's approver or the owner (tx ${out.transaction.hash})`);
}
const wallets = await view<[string, unknown][]>(vaultId, "get_wallets");
if (!wallets.some(([id]) => id === wallet)) {
  await call(vaultId, "add_wallet", { provider: "outlayer", wallet, name: "Buyer agent's OutLayer wallet" });
  log("registered the OutLayer wallet with the vault");
}

// 9. Env for the web app's demo API (gitignored).
const rootEnv = new URL("../.env.local", import.meta.url);
const nearAiKey = existsSync(rootEnv) ? readFileSync(rootEnv, "utf8").match(/^NEARAI_API_KEY=(.*)$/m)?.[1]?.trim() ?? "" : "";
const env = {
  NEXT_PUBLIC_NETWORK: "testnet",
  NEXT_PUBLIC_VAULT_ID: vaultId,
  NEXT_PUBLIC_VAULT_NAME: "Lagoon Goods",
  DEMO_ENABLED: "1",
  DEMO_ROOT: state.root.accountId,
  DEMO_TOKEN: tokenId,
  DEMO_AGENT_ACCOUNT_ID: state.agent!.accountId,
  DEMO_AGENT_KEY: state.agentProposeKey,
  DEMO_GUARDIAN_ACCOUNT_ID: state.guardian!.accountId,
  DEMO_GUARDIAN_KEY: state.guardianVerdictKey,
  DEMO_OWNER_ACCOUNT_ID: state.root.accountId,
  DEMO_OWNER_KEY: state.ownerDemoKey,
  DEMO_TEST_SIGNER_KEY: state.testSignerKey,
  DEMO_OUTLAYER_WALLET: wallet,
  DEMO_OUTLAYER_WALLET_KEY: state.outlayer.apiKey,
  DEMO_OUTLAYER_APPROVER_ID: state.approver!.accountId,
  DEMO_OUTLAYER_APPROVER_KEY: state.approver!.key,
  NEARAI_API_KEY: nearAiKey,
};
const envFile = new URL("../apps/web/.env.local", import.meta.url);
writeFileSync(envFile, "# Testnet demo config. Generated by scripts/demo-setup.ts. Never commit.\n" + Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
log(`wrote apps/web/.env.local for vault ${vaultId}`);
console.log(`\nDemo vault ready: https://testnet.nearblocks.io/address/${vaultId}`);

function lastMondayWat(now = new Date()): number {
  const wat = new Date(now.getTime() + 3600_000);
  const daysSinceMonday = (wat.getUTCDay() + 6) % 7;
  const monday = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate() - daysSinceMonday);
  return Math.floor((monday - 3600_000) / 1000);
}
