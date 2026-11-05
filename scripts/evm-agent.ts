// The buyer agent paying a supplier on Base Sepolia. The vault pays from its own address there:
// on a pass it builds the transfer and NEAR's MPC network signs it (Chain Signatures); the guardian
// broadcasts the signed bytes. Run the guardian first; the vault's Base address needs test ETH.
//   node scripts/evm-agent.ts
import { Veto, toUnits } from "@veto/sdk";
import { MPC_CONTRACT, vaultEvmAddress, evmBalance } from "@veto/core";
process.env.VETO_PROFILE ??= "demo3";
const { loadState } = await import("./dev-state.ts");

const state = loadState("testnet");
if (!state.evmPayee) { console.error("no Base Sepolia route in this profile; run node scripts/demo-setup.ts first"); process.exit(1); }
const veto = new Veto({
  vaultId: state.vault!.accountId,
  agentAccountId: state.agent!.accountId,
  agentKey: state.agentProposeKey!,
  guardianUrl: process.env.GUARDIAN_URL ?? "http://localhost:8799",
});
const from = await vaultEvmAddress(veto.vault, { mpc: MPC_CONTRACT.testnet, path: "veto-1" });
console.log(`vault's own Base Sepolia address ${from} holds ${Number(await evmBalance("84532", from)) / 1e18} ETH`);

const invoice = `IF-${Date.now() % 100000}`;
const { id, tx } = await veto.propose({
  chain: "base-sepolia",
  asset: "base-sepolia:eth",
  payee: state.evmPayee.address,
  amount: toUnits("0.0001", 18),
  memo: invoice,
  evidence: {
    source: "email",
    from: "billing@ikejafreight.ng",
    subject: `Invoice ${invoice}: freight, Lagos to Kano`,
    body: `Invoice ${invoice} for last week's freight run. Amount due: 0.0001 ETH on Base Sepolia, to our usual address ${state.evmPayee.address}.`,
  },
});
console.log(`vault: proposal ${id}  https://testnet.nearblocks.io/txns/${tx}`);
for (;;) {
  const p = (await veto.vault.proposal(id))!;
  if (p.evm?.r && !p.evm.tx_hash) console.log(`mpc: signed for ${from} (r ${p.evm.r.slice(0, 10)}…); waiting for the guardian to broadcast`);
  if (["Paid", "Vetoed", "Failed", "Expired"].includes(p.status)) {
    console.log(`vault: ${p.status.toUpperCase()}${p.evm?.tx_hash ? `  https://sepolia.basescan.org/tx/${p.evm.tx_hash}` : ""}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 4000));
}
