// Creates a supplier account under the sandbox's root and registers it with the test USDC token, so
// a first payment to it can land. It is NOT added to the payee list: it's the README's "new supplier"
// example, which the owner saves with Pay and save them.
//   node scripts/add-sandbox-supplier.ts lagos-leather      (profile "demo3", the hosted sandbox)
import { nearToYocto, teraToGas } from "near-api-js";

process.env.VETO_PROFILE ??= "demo3";
const { account, exists, loadState, newKey, saveState } = await import("./dev-state.ts");

const prefix = process.argv[2];
if (!prefix || !/^[a-z0-9-]{2,32}$/.test(prefix)) throw new Error("usage: node scripts/add-sandbox-supplier.ts <prefix>");
const NETWORK = "testnet";
const state = loadState(NETWORK);
const root = account(state.root!, NETWORK);
const id = `${prefix}.${state.root!.accountId}`;
if (!(await exists(id, NETWORK))) {
  const key = newKey();
  await root.createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto("0.05") });
  state.payees[prefix] = { accountId: id, key: key.toString() as `ed25519:${string}` };
  saveState(state);
  console.log(`created ${id}`);
}
const tokenId = state.token!.accountId;
const registered = await root.provider.callFunction({ contractId: tokenId, method: "storage_balance_of", args: { account_id: id }, blockQuery: { finality: "optimistic" } });
if (!registered) {
  await root.callFunction({ contractId: tokenId, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: nearToYocto("0.00125"), gas: teraToGas("30") });
  console.log(`registered ${id} with ${tokenId}`);
}
console.log(`ready: ${id}`);
