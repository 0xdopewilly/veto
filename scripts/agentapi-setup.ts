// Sets up the demo's NEAR Intents Agent API wallet: an agent account that moves money only inside an
// owner-signed policy, with Veto holding its only grant. The AI agent never gets a grant, so it can
// only ask; Veto screens, and only a pass becomes a transfer (to a supplier on NEAR) or a withdrawal
// (a salary paid out on the chain the worker chose).
//
//   node scripts/agentapi-setup.ts
//
// The hosted API is mainnet. Creating the agent and its grant is sponsored by the API (the owner
// here is an EVM key, which needs no NEAR account or funds). Nothing moves until someone deposits
// into the agent; the script prints how. State lives in .veto-dev/agentapi.json (gitignored) and
// the run resumes where it stopped, so it never creates a second agent.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { KeyPair } from "near-api-js";
import { AgentApi, createGrantCredential, evmOwner, signEvmIntent, type AgentPolicy, type GeneratedIntent, type StatusResponse } from "@veto/core";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"; // USDC on NEAR, 6 decimals
const USD = 1_000_000n;

const rootEnv = new URL("../.env.local", import.meta.url);
const envVar = (name: string) => readFileSync(rootEnv, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim() ?? "";
const url = envVar("NEAR_INTENTS_AGENT_API_URL") || "https://api.agentsonintents.com";
const key = envVar("NEAR_INTENTS_AGENT_API_KEY");
if (!key) throw new Error("Put NEAR_INTENTS_AGENT_API_KEY in the root .env.local first.");

interface State {
  ownerKey?: string;
  payees?: Record<string, { name: string; key: string; account: string }>;
  /** Staff paid out on another chain: the policy lets the account withdraw to exactly these addresses. */
  workers?: Record<string, { name: string; chain: string; key: string; address: string }>;
  pendingCreate?: GeneratedIntent;
  agentId?: string;
  wallet?: string;
  grantToken?: string;
  pendingGrant?: GeneratedIntent;
  grantId?: string;
}
const DIR = new URL("../.veto-dev/", import.meta.url);
const FILE = new URL("agentapi.json", DIR);
mkdirSync(DIR, { recursive: true });
const state: State = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const save = () => writeFileSync(FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
const log = (s: string) => console.log(`• ${s}`);

const api = new AgentApi(url, key);
const net = await api.network();
const who = await api.request<{ tenant_id: string }>("GET", "/v1/whoami");
log(`${url}: ${net.network}, ${net.status.overall}; tenant ${who.tenant_id.slice(0, 12)}…`);

// The owner: a fresh EVM key. In production the owner's own wallet signs; here Veto's demo plays
// the owner, the way the shared sandbox has a demo owner.
state.ownerKey ??= Wallet.createRandom().privateKey;
// Two suppliers the policy allows, as NEAR Intents accounts (implicit, from keys we keep).
if (!state.payees) {
  const payee = (name: string) => {
    const k = KeyPair.fromRandom("ed25519");
    return { name, key: k.toString(), account: Buffer.from(k.getPublicKey().data).toString("hex") };
  };
  state.payees = { "kano-cotton": payee("Kano Cotton Mills"), "ibadan-dye": payee("Ibadan Dye Works") };
}
// A member of staff paid in USDC on Base, the chain they chose, from a key we keep.
state.workers ??= {};
if (!state.workers["tunde-bello"]) {
  const w = Wallet.createRandom();
  state.workers["tunde-bello"] = { name: "Tunde Bello", chain: "base", key: w.privateKey, address: w.address.toLowerCase() };
}
save();
const owner = evmOwner(state.ownerKey);

/**
 * The owner's policy, the hard limit even for Veto: USDC only, sent to the two listed suppliers or
 * withdrawn to the listed worker's own address on Base, at most $25 a payment and $150 a day, $500 a
 * week across everything. The inbox's examples are scaled 1:100
 * (at most $3), so a day of judging fits; an email someone writes for more than $25 meets the limit.
 */
function desiredPolicy(): AgentPolicy {
  return {
    frozen: false,
    actions: ["transfer", "withdraw"],
    confidential: false,
    // Veto is the gate: it holds the only grant and screens before it calls.
    owner_approval: false,
    assets: [USDC],
    limits: { per_transaction: { [USDC]: String(25n * USD) }, daily: { [USDC]: String(150n * USD) } },
    max_actions_per_hour: 60,
    destinations: {
      mode: "only",
      list: [
        ...Object.values(state.payees!).map((p) => ({ action: "transfer" as const, address: p.account, confidential: false })),
        ...Object.values(state.workers!).map((w) => ({ action: "withdraw" as const, chain: w.chain, address: w.address, memo: null })),
      ],
    },
    budget: { daily_usd: "150", weekly_usd: "500", monthly_usd: null },
    timelock_ms: 0,
  };
}

/** Signs an owner intent, submits it and waits for it to settle. */
async function ownerSigns(generated: GeneratedIntent): Promise<StatusResponse> {
  const signed = await signEvmIntent(state.ownerKey!, generated);
  await api.submitIntent(generated.type, generated.correlation_id, signed);
  return api.settle(generated.correlation_id, 180_000);
}

// 1. The agent account, created by one owner signature over its whole policy.
if (!state.agentId) {
  const policy = desiredPolicy();
  const generated =
    state.pendingCreate && Date.parse(state.pendingCreate.expires_at) > Date.now() + 30_000
      ? state.pendingCreate
      : await api.generateIntent({ type: "agent_create", name: "Veto demo agent", external_user_id: "veto-demo", owner, policy }, `veto-create-${randomUUID()}`);
  state.pendingCreate = generated;
  save();
  log(`signing: ${generated.preview.summary}`);
  const status = await ownerSigns(generated);
  if (status.status !== "SUCCESS" || !status.agent_id) throw new Error(`agent_create ${status.status}: ${status.failure_code ?? "no agent id"}`);
  state.agentId = status.agent_id;
  delete state.pendingCreate;
  save();
  log(`created agent ${state.agentId}`);
}
const agent = await api.agent(state.agentId);
state.wallet = agent.wallet?.near_account_id;
save();

// 1b. Keep the policy in force equal to desiredPolicy(): one owner signature when it differs.
{
  const current = await api.policy(state.agentId);
  const want = desiredPolicy();
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const differs =
    !current.policy ||
    !same(current.policy.limits, want.limits) ||
    !same(current.policy.budget, want.budget) ||
    current.policy.max_actions_per_hour !== want.max_actions_per_hour ||
    !same(current.policy.destinations, want.destinations) ||
    !same(current.policy.assets, want.assets) ||
    !same(current.policy.actions, want.actions);
  if (differs) {
    if (current.status !== "APPLIED" || current.revision === null) throw new Error(`the current policy is ${current.status}; wait for it to apply, then run this again`);
    const generated = await api.generateIntent({ type: "policy_update", agent_id: state.agentId, policy: want, expected_revision: current.revision }, `veto-policy-${randomUUID()}`);
    log(`signing: ${generated.preview.summary}`);
    const status = await ownerSigns(generated);
    if (status.status !== "SUCCESS") throw new Error(`policy_update ${status.status}: ${status.failure_code ?? ""}`);
    for (let i = 0; i < 30; i++) {
      const p = await api.policy(state.agentId);
      if (p.status === "APPLIED" && p.provider_policy_synced && p.revision !== current.revision) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    log("updated the owner's policy");
  }
}

// 2. Veto's grant: the only credential that can spend. The token is saved before the owner signs.
if (!state.grantId) {
  if (!state.grantToken || !state.pendingGrant) {
    const credential = createGrantCredential();
    state.grantToken = credential.token;
    save();
    const expires = new Date(Date.now() + 300 * 86_400_000).toISOString();
    state.pendingGrant = await api.generateIntent(
      { type: "grant_issue", agent_id: state.agentId, label: "Veto guardian: screens every payment before it runs", credential: credential.commitment, expires_at: expires },
      `veto-grant-${randomUUID()}`,
    );
    save();
  }
  log(`signing: ${state.pendingGrant.preview.summary}`);
  const status = await ownerSigns(state.pendingGrant);
  const grantId = status.details.grant?.grant_id;
  if (status.status !== "SUCCESS" || !grantId) throw new Error(`grant_issue ${status.status}: ${status.failure_code ?? "no grant id"}`);
  state.grantId = grantId;
  delete state.pendingGrant;
  save();
  log(`issued Veto's grant ${grantId.slice(0, 12)}…`);
}

// 3. Where things stand.
const policy = await api.policy(state.agentId);
const balances = await api.balances(state.agentId);
const usdc = balances.balances.find((b) => b.asset_id === USDC);
log(`agent ${agent.name} (${agent.status}), wallet ${state.wallet}`);
log(`policy revision ${policy.revision}: ${policy.status}${policy.provider_policy_synced ? ", in force" : ", syncing"}`);
log(`USDC: ${usdc ? Number(usdc.available_raw) / 1e6 : 0}`);
for (const p of Object.values(state.payees)) log(`allowed payee ${p.name}: ${p.account}`);
for (const w of Object.values(state.workers)) log(`allowed payout ${w.name} on ${w.chain}: ${w.address}`);

// 4. The web app's env (gitignored): which agent, and Veto's grant.
const webEnv = new URL("../apps/web/.env.local", import.meta.url);
let text = existsSync(webEnv) ? readFileSync(webEnv, "utf8") : "";
const upsert = (k: string, v: string) => {
  text = new RegExp(`^${k}=`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
};
upsert("DEMO_AGENTAPI_AGENT_ID", state.agentId);
upsert("DEMO_AGENTAPI_GRANT", state.grantToken!);
// "Name=account" for a NEAR Intents account, "Name=chain:address" for a payout on another chain.
upsert(
  "DEMO_AGENTAPI_PAYEES",
  [...Object.values(state.payees).map((p) => `${p.name}=${p.account}`), ...Object.values(state.workers).map((w) => `${w.name}=${w.chain}:${w.address}`)].join(";"),
);
writeFileSync(webEnv, text, { mode: 0o600 });
log("wrote the agent id, Veto's grant and the payees to apps/web/.env.local");
if (!usdc || BigInt(usdc.available_raw) === 0n) {
  console.log(`\nTo make real payments, deposit a few USDC into the agent's NEAR Intents account ${state.wallet}`);
  console.log("(USDC on NEAR to intents.near for that account, or ask the API for a deposit address: POST /v1/agents/{id}/deposit).");
}
