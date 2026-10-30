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
  root?: DevAccount;
  vault?: DevAccount;
  agent?: DevAccount;
  guardian?: DevAccount;
  payees?: Record<string, DevAccount>;
  agentProposeKey?: KeyPairString;
  guardianVerdictKey?: KeyPairString;
  initialized?: boolean;
  modelSigner?: string;
}

const DIR = new URL("../.veto-dev/", import.meta.url);

export function loadState(network: Network): DevState {
  const file = new URL(`${network}.json`, DIR);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { network };
}

export function saveState(state: DevState) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const file = new URL(`${state.network}.json`, DIR);
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
