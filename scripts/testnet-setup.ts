// Creates the demo vault on testnet: dev accounts, contract, agent, payees and the
// NEAR AI model key. Safe to re-run; each step is skipped once it has happened.
//   node scripts/testnet-setup.ts
import { readFileSync } from "node:fs";
import { nearToYocto, teraToGas, yoctoToNear } from "near-api-js";
import { DEFAULT_MODEL, modelAttestation } from "@veto/core";
import { account, exists, loadState, newKey, saveState, type DevAccount } from "./dev-state.ts";

const NETWORK = "testnet";
const FAUCET = "https://helper.nearprotocol.com/account";
const WASM = new URL("../contract/target/wasm32-unknown-unknown/release/veto_vault.wasm", import.meta.url);
const MANDATE = "Pay listed suppliers only, up to the weekly limit. Ask me before paying a new or changed address.";

// Testnet stand-in for USDC: 1 NEAR here plays $1,000, so the $500 weekly cap is 0.5 NEAR.
const POLICY = { period_limit: nearToYocto("0.5").toString(), max_single: nearToYocto("0.5").toString() };

const SUB_ACCOUNTS: Record<string, { role: "vault" | "agent" | "guardian" | "payee"; fund: string; name?: string }> = {
  treasury: { role: "vault", fund: "3" },
  buyer: { role: "agent", fund: "0.5" },
  guardian: { role: "guardian", fund: "1" },
  "kano-cotton": { role: "payee", fund: "0.1", name: "Kano Cotton Mills" },
  "ibadan-dye": { role: "payee", fund: "0.1", name: "Ibadan Dye Works" },
  "kano-cottom": { role: "payee", fund: "0.1" }, // the lookalike a scammer controls; never added as a payee
};

const state = loadState(NETWORK);
const log = (msg: string) => console.log(`• ${msg}`);

// 1. A funded root account from the testnet faucet.
if (!state.root || !(await exists(state.root.accountId, NETWORK))) {
  const key = newKey();
  const accountId = `veto-lagoon-${Math.random().toString(36).slice(2, 8)}.testnet`;
  const res = await fetch(FAUCET, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: key.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`faucet refused (${res.status}): ${(await res.text()).slice(0, 200)}`);
  state.root = { accountId, key: key.toString() };
  saveState(state);
  for (let i = 0; i < 20 && !(await exists(accountId, NETWORK)); i++) await new Promise((r) => setTimeout(r, 1500));
  log(`created ${accountId} from the faucet`);
}
const root = account(state.root, NETWORK);
log(`root ${state.root.accountId} holds ${yoctoToNear(await root.getBalance(), 2)} NEAR`);

// 2. Sub-accounts for the vault, the agent, the guardian and the payees.
state.payees ??= {};
for (const [prefix, spec] of Object.entries(SUB_ACCOUNTS)) {
  const accountId = `${prefix}.${state.root.accountId}`;
  const known: DevAccount | undefined =
    spec.role === "payee" ? state.payees[prefix] : state[spec.role];
  if (known && (await exists(known.accountId, NETWORK))) continue;
  const key = newKey();
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(spec.fund) });
  const dev = { accountId, key: key.toString() };
  if (spec.role === "payee") state.payees[prefix] = dev;
  else state[spec.role] = dev;
  saveState(state);
  log(`created ${accountId} with ${spec.fund} NEAR`);
}
const vault = account(state.vault!, NETWORK);
const vaultId = state.vault!.accountId;

// 3. Deploy and initialise the vault.
if (!state.initialized) {
  const code = new Uint8Array(readFileSync(WASM));
  // Storage costs 1 NEAR per 100 KB; keep 1 NEAR on top for state and test payments.
  const needed = BigInt(code.length) * 10n ** 19n + nearToYocto("1");
  const balance = await vault.getBalance();
  if (balance < needed) {
    await root.transfer({ receiverId: vaultId, amount: needed - balance });
    log(`topped up the vault by ${yoctoToNear(needed - balance, 2)} NEAR for contract storage`);
  }
  await vault.deployContract(code);
  log(`deployed the vault contract to ${vaultId}`);
  await vault.callFunction({
    contractId: vaultId,
    methodName: "new",
    args: {
      owner: state.root.accountId,
      guardian: state.guardian!.accountId,
      mandate: MANDATE,
      policies: [["near", POLICY]],
      period_anchor_secs: String(lastMondayWat()),
      // Short delays so the override and raise flows can be shown live on testnet.
      override_delay_secs: "180",
      raise_delay_secs: "180",
      screen_timeout_secs: "600",
    },
    gas: teraToGas("100"),
  });
  state.initialized = true;
  saveState(state);
  log("initialised the vault");
}

// 4. Owner registers the agent, the payees and the attested NEAR AI model key.
const config = await root.provider.callFunction({ contractId: vaultId, method: "get_config", args: {} }) as { owner: string };
if (config.owner !== state.root.accountId) throw new Error("unexpected vault owner");
const owner = (methodName: string, args: Record<string, unknown>) =>
  root.callFunction({ contractId: vaultId, methodName, args, gas: teraToGas("30") });

const agents = (await root.provider.callFunction({ contractId: vaultId, method: "get_agents", args: {} })) as [string, unknown][];
if (!agents.some(([id]) => id === state.agent!.accountId)) {
  await owner("add_agent", { agent: state.agent!.accountId });
  log(`registered agent ${state.agent!.accountId}`);
}
const payees = (await root.provider.callFunction({ contractId: vaultId, method: "get_payees", args: {} })) as { address: string }[];
for (const [prefix, spec] of Object.entries(SUB_ACCOUNTS)) {
  if (spec.role !== "payee" || !spec.name) continue;
  const address = state.payees[prefix].accountId;
  if (payees.some((p) => p.address === address)) continue;
  await owner("add_payee", { name: spec.name, chain: "near", address });
  log(`added payee ${spec.name} (${address})`);
}

const { nonce, report } = await modelAttestation(DEFAULT_MODEL);
const attested = (report.model_attestations ?? []).filter(
  (m: { request_nonce?: string; signing_algo?: string }) => m.request_nonce === nonce && m.signing_algo === "ecdsa",
);
if (attested.length !== 1) throw new Error(`expected one attested key for ${DEFAULT_MODEL}, got ${attested.length}`);
const signer = String(attested[0].signing_address).toLowerCase();
const signers = (await root.provider.callFunction({ contractId: vaultId, method: "get_signers", args: {} })) as [string, unknown][];
if (!signers.some(([address]) => address === signer)) {
  await owner("add_signer", { address: signer, model_id: DEFAULT_MODEL });
  log(`approved ${DEFAULT_MODEL} signing key ${signer}`);
}
state.modelSigner = signer;
saveState(state);

// 5. Narrow keys: the agent may only call `propose`, the guardian only `submit_verdict` and `expire`.
if (!state.agentProposeKey) {
  const key = newKey();
  await account(state.agent!, NETWORK).addFunctionCallAccessKey({
    publicKey: key.getPublicKey(),
    contractId: vaultId,
    methodNames: ["propose"],
    allowance: nearToYocto("0.25"),
  });
  state.agentProposeKey = key.toString();
  saveState(state);
  log("gave the agent a key that can only call propose");
}
if (!state.guardianVerdictKey) {
  const key = newKey();
  await account(state.guardian!, NETWORK).addFunctionCallAccessKey({
    publicKey: key.getPublicKey(),
    contractId: vaultId,
    methodNames: ["submit_verdict", "expire"],
    allowance: nearToYocto("0.5"),
  });
  state.guardianVerdictKey = key.toString();
  saveState(state);
  log("gave the guardian a key that can only call submit_verdict and expire");
}

console.log(`\nVault ready: https://testnet.nearblocks.io/address/${vaultId}`);

/** Unix seconds of the most recent Monday 00:00 in West Africa Time (UTC+1). */
function lastMondayWat(now = new Date()): number {
  const wat = new Date(now.getTime() + 3600_000);
  const daysSinceMonday = (wat.getUTCDay() + 6) % 7;
  const monday = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate() - daysSinceMonday);
  return Math.floor((monday - 3600_000) / 1000);
}
