// The same naive buyer agent, paying from an OutLayer wallet instead of a Veto vault. The
// wallet's policy needs an approval for every payment, and Veto is the approver: it records
// each payment on the vault, screens it, and votes yes on OutLayer only if it passes.
//   node scripts/outlayer-agent.ts      (needs `node scripts/demo-setup.ts` and a running guardian)
import { readFileSync } from "node:fs";
import { toUnits, VetoOutLayer } from "@veto/sdk";
process.env.VETO_PROFILE ??= "demo2";
const { loadState } = await import("./dev-state.ts");

const state = loadState("testnet");
if (!state.outlayer) throw new Error("no OutLayer wallet in this profile; run node scripts/demo-setup.ts first");
const root = state.root!.accountId;
const inbox = JSON.parse(
  readFileSync(new URL("fixtures/inbox.json", import.meta.url), "utf8")
    .replaceAll("{KANO}", `kano-cotton.${root}`)
    .replaceAll("{LOOKALIKE}", `kano-cottom.${root}`),
) as { from: string; subject: string; body: string; invoice: { number: string; amount: string; payee: string } }[];

const veto = new VetoOutLayer({
  vaultId: state.vault!.accountId,
  walletKey: state.outlayer.apiKey,
  guardianUrl: process.env.GUARDIAN_URL ?? "http://localhost:8799",
});

for (const mail of inbox) {
  console.log(`\nagent: "${mail.subject}" from ${mail.from}`);
  console.log(`agent: paying $${mail.invoice.amount} to ${mail.invoice.payee} from OutLayer wallet ${state.outlayer.account.slice(0, 8)}…`);
  const { id, approvalId, decision } = await veto.pay({
    payee: mail.invoice.payee,
    amount: toUnits(mail.invoice.amount, 6),
    asset: state.token!.accountId,
    memo: mail.invoice.number,
    evidence: { source: "email", from: mail.from, subject: mail.subject, body: mail.body },
  });
  console.log(`outlayer: holding it for approval ${approvalId}`);
  console.log(`vault: recorded as proposal ${id}, screening`);
  const p = await decision();
  const reasons = p.verdict?.reasons.length ? ` (${p.verdict.reasons.join(", ")})` : "";
  const tx = p.external?.tx_hash ? `  https://testnet.nearblocks.io/txns/${p.external.tx_hash}` : "";
  console.log(`vault: ${p.status.toUpperCase()}${reasons}${p.status === "Vetoed" ? ", so Veto never approved it and the wallet keeps holding it" : ""}${tx}`);
}
