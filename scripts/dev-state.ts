import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPair, type KeyPairString } from "near-api-js";
import { provider, type Network } from "@veto/core";

/** Local dev accounts and keys. Lives in .veto-dev/ (gitignored, owner-only). */
export interface DevAccount {
  accountId: string;
  key: KeyPairString;
}

export interface DevState {
  network: Network;
  profile?: string;
  root?: DevAccount;
  vault?: DevAccount;
  agent?: DevAccount;
  guardian?: DevAccount;
  payees?: Record<string, DevAccount>;
  agentProposeKey?: KeyPairString;
  guardianVerdictKey?: KeyPairString;
  initialized?: boolean;
  modelSigner?: string;
  token?: DevAccount;
  tokenReady?: boolean;
  ownerDemoKey?: KeyPairString;
  testSignerKey?: string;
  testSignerAddress?: string;
  approver?: DevAccount;
  outlayer?: { walletId: string; apiKey: string; account: string; policyTx?: string };
  /** A Base Sepolia supplier the vault pays from its own Chain Signatures address. */
  evmPayee?: { address: string; key: string };
  /** The vault code deployed once as a global contract, and the factory that uses it. */
  globalCodeHash?: string;
  factory?: string;
  /** The factory account's own key (it can redeploy the factory), and the factories it replaced. */
  factoryKey?: string;
  retiredFactories?: string[];
  /** The keys each factory vault's own agent and guardian accounts get; they can only call that vault. */
  ownedAgentKey?: string;
  ownedGuardianKey?: string;
}

const DIR = new URL("../.veto-dev/", import.meta.url);

/** VETO_PROFILE picks the state file, so several dev vaults can live side by side. */
const profileName = (network: Network) => process.env.VETO_PROFILE ?? network;

export function loadState(network: Network): DevState {
  const file = new URL(`${profileName(network)}.json`, DIR);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { network, profile: profileName(network) };
}

export function saveState(state: DevState) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const file = new URL(`${state.profile ?? state.network}.json`, DIR);
  writeFileSync(file, JSON.stringify(state, null, 2));
  chmodSync(file, 0o600);
}

export const newKey = () => KeyPair.fromRandom("ed25519");

export function account(dev: DevAccount, network: Network, key: KeyPairString = dev.key) {
  return new Account(dev.accountId, provider(network), key);
}

export async function exists(accountId: string, network: Network) {
  try {
    await provider(network).viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}
