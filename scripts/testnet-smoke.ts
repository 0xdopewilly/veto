// End-to-end check of the deployed testnet vault without a NEAR AI key. A temporary
// local signer stands in for the model enclave, signing in NEAR AI's exact format
// (EIP-191 over model:sha256(req):sha256(resp)). It is removed again at the end.
//   node scripts/testnet-smoke.ts
import { Wallet } from "ethers";
import { nearToYocto, teraToGas, yoctoToNear } from "near-api-js";
import { proposalHash, sha256Hex, VaultReader, provider, type Proposal } from "@veto/core";
import { account, loadState } from "./dev-state.ts";

const NETWORK = "testnet";
const DEV_MODEL = "veto-dev/local-signer";
const state = loadState(NETWORK);
if (!state.initialized) throw new Error("run scripts/testnet-setup.ts first");

const vaultId = state.vault!.accountId;
const reader = new VaultReader(vaultId, provider(NETWORK));
const owner = account(state.root!, NETWORK);
const agent = account(state.agent!, NETWORK, state.agentProposeKey);
const guardian = account(state.guardian!, NETWORK, state.guardianVerdictKey);
const devSigner = Wallet.createRandom();
const tx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

await owner.callFunction({
  contractId: vaultId,
  methodName: "add_signer",
  args: { address: devSigner.address, model_id: DEV_MODEL },
  gas: teraToGas("30"),
});
console.log(`• approved temporary signer ${devSigner.address}`);

try {
  const kano = state.payees!["kano-cotton"].accountId;
  const lookalike = state.payees!["kano-cottom"].accountId;
  const kanoBefore = await account(state.payees!["kano-cotton"], NETWORK).getBalance();

  const paid = await run("PASS", { payee: kano, amount: "0.18", memo: "INV-2288" }, []);
  if (paid.status !== "Paid") throw new Error(`expected Paid, got ${paid.status}`);
  const kanoAfter = await account(state.payees!["kano-cotton"], NETWORK).getBalance();
  console.log(`  Kano Cotton Mills received ${yoctoToNear(kanoAfter - kanoBefore, 2)} NEAR`);

  const vetoed = await run("VETO", { payee: lookalike, amount: "0.3", memo: "INV-2291" }, ["LOOKALIKE_ADDRESS", "CHANGED_PAYOUT_DETAILS"]);
  if (vetoed.status !== "Vetoed") throw new Error(`expected Vetoed, got ${vetoed.status}`);

  // The agent's key is limited to `propose`; NEAR itself refuses anything else.
  try {
    await agent.callFunction({ contractId: vaultId, methodName: "freeze", args: {}, gas: teraToGas("10") });
    throw new Error("the agent key was able to call freeze");
  } catch (e) {
    if (String(e).includes("was able to")) throw e;
    console.log("• agent key refused for freeze (only propose is allowed)");
  }
  const spend = await reader.view<{ spent: string; remaining: string }>("get_spend", { asset: "near" });
  console.log(`• spent this week ${yoctoToNear(BigInt(spend.spent), 2)} NEAR, remaining ${yoctoToNear(BigInt(spend.remaining), 2)} NEAR`);
  console.log("\nSmoke test passed.");
} finally {
  await owner.callFunction({
    contractId: vaultId,
    methodName: "remove_signer",
    args: { address: devSigner.address },
    gas: teraToGas("30"),
  });
  console.log("• removed temporary signer");
}

async function run(verdict: "PASS" | "VETO", payment: { payee: string; amount: string; memo: string }, reasons: string[]) {
  const request = { chain: "near", asset: "near", payee: payment.payee, amount: nearToYocto(payment.amount).toString(), memo: payment.memo };
  const proposed = await agent.signAndSendTransaction({
    receiverId: vaultId,
    actions: [
      (await import("near-api-js")).actions.functionCall("propose", { request, context_hash: null }, teraToGas("30"), 0n),
    ],
    waitUntil: "FINAL",
  });
  const id = JSON.parse(Buffer.from((proposed.status as { SuccessValue: string }).SuccessValue, "base64").toString());
  console.log(`• agent proposed ${payment.amount} NEAR to ${payment.payee} → proposal ${id}  ${tx(proposed.transaction.hash)}`);

  const proposal = (await reader.proposal(id)) as Proposal;
  const hash = proposalHash(vaultId, proposal);
  if (hash !== (await reader.proposalHash(id))) throw new Error("proposal hash differs from the contract");

  const requestBytes = JSON.stringify({ model: DEV_MODEL, messages: [{ role: "user", content: `screen proposal ${id}` }] });
  const response = JSON.stringify({
    id: `chatcmpl-smoke-${id}`,
    object: "chat.completion",
    model: DEV_MODEL,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ proposal_id: id, proposal_hash: hash, verdict, reasons }) } }],
  });
  const requestHash = sha256Hex(requestBytes);
  const signature = await devSigner.signMessage(`${DEV_MODEL}:${requestHash}:${sha256Hex(response)}`);

  const submitted = await guardian.signAndSendTransaction({
    receiverId: vaultId,
    actions: [
      (await import("near-api-js")).actions.functionCall(
        "submit_verdict",
        { id, model_id: DEV_MODEL, chat_id: `chatcmpl-smoke-${id}`, request_hash: requestHash, response: Buffer.from(response).toString("base64"), signature },
        teraToGas("150"),
        0n,
      ),
    ],
    waitUntil: "FINAL",
  });
  const final = (await reader.proposal(id)) as Proposal;
  console.log(`• guardian submitted ${verdict} → ${final.status}  ${tx(submitted.transaction.hash)}`);
  return final;
}
