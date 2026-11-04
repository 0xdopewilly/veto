// Builds the public testnet demo: a fresh vault on the current contract, test USDC, the
// agent, guardian and demo-owner keys, an OutLayer agent wallet that needs Veto's approval,
// a Base Sepolia route paid from the vault's own Chain Signatures address, a factory that lets
// anyone create their own vault (the vault code deployed once as a global contract), and the env
// file the web app's demo API reads.
// Safe to re-run; finished steps are skipped.
//   node scripts/demo-setup.ts            (profile "demo3", state in .veto-dev/demo3.json)
//   node scripts/demo-setup.ts --upgrade  (also redeploys new contract code onto the existing vault;
//                                          only for changes that keep the stored state's layout)
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";
import { actions, KeyPair, nearToYocto, PublicKey, teraToGas, yoctoToNear, type KeyPairString } from "near-api-js";
import { DEFAULT_MODEL, modelAttestation, MPC_CONTRACT, OutLayer, provider, VaultReader, vaultEvmAddress } from "@veto/core";
// "demo3": the vault with OutLayer wallets and Chain Signatures payouts. Older demo vaults
// can't be upgraded in place.
process.env.VETO_PROFILE ??= "demo3";
const { account, ensureRootYocto, exists, faucetAccount, loadState, newKey, saveState } = await import("./dev-state.ts");

const NETWORK = "testnet";
const VAULT_WASM = new URL("../contract/target/wasm32-unknown-unknown/release/veto_vault.wasm", import.meta.url);
const FACTORY_WASM = new URL("../factory/target/wasm32-unknown-unknown/release/veto_factory.wasm", import.meta.url);
const TOKEN_WASM = new URL("../test-token/target/wasm32-unknown-unknown/release/veto_test_usdc.wasm", import.meta.url);
const USD = 1_000_000n;
const MANDATE = "Pay listed suppliers only, in USDC. No single payment over $500. Ask me before paying a new or changed address.";
const OWNER_METHODS = ["override_veto", "cancel_override", "execute_override", "keep_blocked", "freeze", "unfreeze", "set_mandate", "add_payee", "remove_payee", "set_agent_active"];
const EVM_CHAIN = "base-sepolia";
const EVM_ASSET = "base-sepolia:eth";
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
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  for (; n > 0n; n /= 58n) out = B58[Number(n % 58n)] + out;
  for (const b of bytes) {
    if (b) break;
    out = "1" + out;
  }
  return out;
}

/** Folds fresh faucet accounts into the root until it holds `near`. */
const ensureRootBalance = (near: `${number}`) => ensureRootYocto(state, nearToYocto(near), log);

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
if (!state.initialized) await ensureRootBalance(yoctoToNear(storage(vaultCode) + storage(tokenCode) + nearToYocto("6"), 0) as `${number}`);
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
        // Test ETH on Base Sepolia, paid from the vault's own Chain Signatures address.
        [EVM_ASSET, { period_limit: String(10n ** 16n), max_single: String(10n ** 15n) }],
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

if (state.initialized && process.argv.includes("--upgrade")) {
  await account(state.vault!, NETWORK).deployContract(vaultCode);
  log(`redeployed the vault code onto ${vaultId} (state kept)`);
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
// The public demo screens with the real model; the test key stays trusted only as its labelled
// fallback, so a NEAR AI outage (or an empty credit balance) can't stall the demo. Every verdict
// names its signer, and the app marks the ones the test key signed.
if (!signers.some(([a]) => a === state.testSignerAddress)) {
  await call(vaultId, "add_signer", { address: state.testSignerAddress, model_id: "veto-dev/local-signer" });
  log(`approved the demo test signer ${state.testSignerAddress} (labelled fallback)`);
}

// 7. Narrow keys. No allowance cap: each is limited to its methods and its account's balance.
async function narrowKey(holder: { accountId: string; key: KeyPairString }, methods: string[]) {
  const key = newKey();
  await account(holder, NETWORK).signAndSendTransaction({
    receiverId: holder.accountId,
    actions: [actions.addFunctionCallAccessKey(PublicKey.from(key.getPublicKey().toString()), vaultId, methods, undefined)],
  });
  return key.toString() as `ed25519:${string}`;
}
if (!state.agentProposeKey) state.agentProposeKey = await narrowKey(state.agent!, ["propose"]);
const GUARDIAN_METHODS = ["submit_verdict", "expire", "propose_external", "settle_external", "settle_evm"];
const guardianKeyMethods = state.guardianVerdictKey ? await keyMethods(state.guardian!.accountId, state.guardianVerdictKey) : [];
if (!GUARDIAN_METHODS.every((m) => guardianKeyMethods.includes(m))) state.guardianVerdictKey = await narrowKey(state.guardian!, GUARDIAN_METHODS);
// A key made before a new owner method existed can't call it; replace it with one that can.
const ownerKeyMethods = state.ownerDemoKey ? await keyMethods(state.root.accountId, state.ownerDemoKey) : [];
if (!OWNER_METHODS.every((m) => ownerKeyMethods.includes(m))) state.ownerDemoKey = await narrowKey(state.root, OWNER_METHODS);
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

// 9. Base Sepolia from the vault's own address: NEAR's MPC network signs each passed transfer.
const evmRoutes = await view<[string, unknown][]>(vaultId, "get_evm_routes");
if (!evmRoutes.some(([chain]) => chain === EVM_CHAIN)) {
  await call(vaultId, "set_evm_route", {
    chain: EVM_CHAIN,
    route: {
      chain_id: "84532",
      asset: EVM_ASSET,
      mpc: MPC_CONTRACT.testnet,
      path: "veto-1",
      max_fee_per_gas: String(5n * 10n ** 9n),
      max_priority_fee_per_gas: String(10n ** 9n),
    },
  });
  log("set the Base Sepolia route: payouts signed with NEAR Chain Signatures");
}
if (!state.evmPayee) {
  const w = Wallet.createRandom();
  state.evmPayee = { address: w.address, key: w.privateKey };
  saveState(state);
}
if (!(await view<{ address: string }[]>(vaultId, "get_payees")).some((p) => p.address.toLowerCase() === state.evmPayee!.address.toLowerCase())) {
  await call(vaultId, "add_payee", { name: "Ikeja Freight", chain: EVM_CHAIN, address: state.evmPayee.address });
  log("added payee Ikeja Freight on Base Sepolia");
}
const vaultEvm = await vaultEvmAddress(new VaultReader(vaultId, provider(NETWORK)), { mpc: MPC_CONTRACT.testnet, path: "veto-1" });

// 10. A factory that gives anyone their own vault, owned by their wallet. The vault code goes
// on-chain once as a global contract (stored on every shard, so it costs 10x a normal deploy);
// each vault then only needs its account and state, which the factory sponsors.
const codeHash = base58(createHash("sha256").update(vaultCode).digest());
if (state.globalCodeHash !== codeHash) {
  await ensureRootBalance(yoctoToNear(storage(vaultCode) * 10n + nearToYocto("3"), 0) as `${number}`);
  await root.signAndSendTransaction({ receiverId: state.root.accountId, actions: [actions.deployGlobalContract(vaultCode, "codeHash")], waitUntil: "FINAL" });
  state.globalCodeHash = codeHash;
  saveState(state);
  log(`deployed the vault code as global contract ${codeHash}`);
}
const factoryId = `vaults.${state.root.accountId}`;
if (state.factory && state.factory !== factoryId) {
  state.retiredFactories = [...new Set([...(state.retiredFactories ?? []), state.factory])];
}
const factoryCode = new Uint8Array(readFileSync(FACTORY_WASM));
// Each vault the factory makes gets its own agent and guardian accounts holding only these keys,
// limited to that vault, so the hosted app never holds a key that can do anything else.
state.ownedAgentKey ??= newKey().toString();
state.ownedGuardianKey ??= newKey().toString();
saveState(state);
const template = {
  agent_key: KeyPair.fromString(state.ownedAgentKey as KeyPairString).getPublicKey().toString(),
  guardian_key: KeyPair.fromString(state.ownedGuardianKey as KeyPairString).getPublicKey().toString(),
  // Only the model's enclave key: vaults people create for themselves get no test signer.
  signer: [state.modelSigner, DEFAULT_MODEL],
  token: tokenId,
  starter_funds: String(5_000n * USD),
  max_single: String(500n * USD),
  period_limit: String(3_000n * USD),
  payees: [
    ["Kano Cotton Mills", "near", state.payees["kano-cotton"].accountId],
    ["Ibadan Dye Works", "near", state.payees["ibadan-dye"].accountId],
  ],
  mandate: MANDATE,
};
if (!(await exists(factoryId, NETWORK))) {
  // Each vault costs it 0.9 NEAR (0.5 for the vault's state, 0.4 for its agent's and guardian's
  // gas). Top it up with a plain transfer to sponsor more.
  const budget = process.env.FACTORY_BUDGET ?? "5";
  await ensureRootBalance(yoctoToNear(storage(factoryCode) + nearToYocto(budget) + nearToYocto("1"), 0) as `${number}`);
  const key = newKey();
  state.factoryKey = key.toString();
  saveState(state);
  await root.createSubAccount({ accountOrPrefix: "vaults", publicKey: key.getPublicKey(), nearToTransfer: storage(factoryCode) + nearToYocto(budget) });
  const factory = account({ accountId: factoryId, key: key.toString() as KeyPairString }, NETWORK);
  await factory.deployContract(factoryCode);
  await factory.callFunction({ contractId: factoryId, methodName: "new", args: { admin: state.root.accountId, code_hash: codeHash, template }, gas: teraToGas("30") });
  log(`deployed the vault factory at ${factoryId}`);
} else if (state.factoryKey && process.argv.includes("--upgrade")) {
  // Same state layout, new code (e.g. different deposits): redeploy in place with the factory's own key.
  await account({ accountId: factoryId, key: state.factoryKey as KeyPairString }, NETWORK).deployContract(factoryCode);
  log(`redeployed the factory code at ${factoryId}`);
}
if ((await view<string>(factoryId, "get_code_hash")) !== codeHash) {
  await call(factoryId, "set_code_hash", { code_hash: codeHash });
  log("pointed the factory at the new vault code");
}
await call(factoryId, "set_template", { template });
state.factory = factoryId;
saveState(state);
// New testnet wallets often hold no NEAR, and every owner action costs gas. The web app gets a
// key on the factory account that can only call send_gas, which sends a wallet 0.2 test NEAR
// once. Its allowance caps what the key itself can burn on gas.
if (state.factoryKey) {
  state.factoryGasKey ??= newKey().toString();
  saveState(state);
  if (!(await keyMethods(factoryId, state.factoryGasKey)).includes("send_gas")) {
    await account({ accountId: factoryId, key: state.factoryKey as KeyPairString }, NETWORK).signAndSendTransaction({
      receiverId: factoryId,
      actions: [actions.addFunctionCallAccessKey(PublicKey.from(KeyPair.fromString(state.factoryGasKey as KeyPairString).getPublicKey().toString()), factoryId, ["send_gas"], nearToYocto("1"))],
    });
    log("gave the web app a key on the factory that can only send gas gifts");
  }
}
if (!(await view(tokenId, "storage_balance_of", { account_id: factoryId }))) {
  await call(tokenId, "storage_deposit", { account_id: factoryId, registration_only: true }, nearToYocto("0.00125"));
}
if (BigInt(await view<string>(tokenId, "ft_balance_of", { account_id: factoryId })) < 100_000n * USD) {
  await call(tokenId, "mint", { account_id: factoryId, amount: String(1_000_000n * USD) });
  log("minted $1,000,000 test USDC to the factory for starter funds");
}

// 11. Env for the web app's demo API (gitignored).
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
  DEMO_EVM_PAYEE: state.evmPayee.address,
  NEXT_PUBLIC_FACTORY_ID: factoryId,
  // Function-call keys on each factory vault's own agent and guardian accounts, limited to that vault.
  DEMO_OWNED_AGENT_KEY: state.ownedAgentKey,
  DEMO_OWNED_GUARDIAN_KEY: state.ownedGuardianKey,
  // Function-call key on the factory account, limited to send_gas (0.2 test NEAR, once per wallet).
  DEMO_FACTORY_GAS_KEY: state.factoryGasKey ?? "",
  NEARAI_API_KEY: nearAiKey,
};
const envFile = new URL("../apps/web/.env.local", import.meta.url);
writeFileSync(envFile, "# Testnet demo config. Generated by scripts/demo-setup.ts. Never commit.\n" + Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
log(`wrote apps/web/.env.local for vault ${vaultId}`);
console.log(`\nDemo vault ready: https://testnet.nearblocks.io/address/${vaultId}`);
console.log(`Its own Base Sepolia address (Chain Signatures): ${vaultEvm}. Send it ~0.01 Base Sepolia ETH to turn on the Base payout.`);

async function keyMethods(accountId: string, key: string): Promise<string[]> {
  try {
    const info = (await root.provider.viewAccessKey({ accountId, publicKey: KeyPair.fromString(key as KeyPairString).getPublicKey().toString() })) as unknown as {
      permission: { FunctionCall?: { method_names: string[] } } | string;
    };
    return typeof info.permission === "object" ? (info.permission.FunctionCall?.method_names ?? []) : [];
  } catch {
    return [];
  }
}

function lastMondayWat(now = new Date()): number {
  const wat = new Date(now.getTime() + 3600_000);
  const daysSinceMonday = (wat.getUTCDay() + 6) % 7;
  const monday = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate() - daysSinceMonday);
  return Math.floor((monday - 3600_000) / 1000);
}
