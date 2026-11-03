// A deliberately naive buyer agent: it pays every invoice in its inbox to whatever
// account the email names. That is exactly the behaviour scammers exploit, and what
// Veto is there to catch.   node scripts/demo-agent.ts   (guardian must be running)
import { readFileSync } from "node:fs";
import { Veto, toUnits } from "@veto/sdk";
process.env.VETO_PROFILE ??= "demo2";
const { loadState } = await import("./dev-state.ts");

const state = loadState("testnet") as ReturnType<typeof loadState> & { token?: { accountId: string } };
const root = state.root!.accountId;
const asset = state.token?.accountId ?? "near";
const decimals = asset === "near" ? 24 : 6;
const inbox = JSON.parse(
  readFileSync(new URL("fixtures/inbox.json", import.meta.url), "utf8")
    .replaceAll("{KANO}", `kano-cotton.${root}`)
    .replaceAll("{LOOKALIKE}", `kano-cottom.${root}`),
) as { id: string; from: string; subject: string; body: string; invoice: { number: string; amount: string; payee: string } }[];

const veto = new Veto({
  vaultId: state.vault!.accountId,
  agentAccountId: state.agent!.accountId,
  agentKey: state.agentProposeKey!,
  guardianUrl: process.env.GUARDIAN_URL ?? "http://localhost:8799",
});

for (const mail of inbox) {
  console.log(`\nagent: "${mail.subject}" from ${mail.from}`);
  console.log(`agent: paying $${mail.invoice.amount} to ${mail.invoice.payee}`);
  const { id, tx } = await veto.propose({
    payee: mail.invoice.payee,
    amount: toUnits(mail.invoice.amount, decimals),
    asset,
    memo: mail.invoice.number,
    evidence: { source: "email", from: mail.from, subject: mail.subject, body: mail.body },
  });
  console.log(`vault: proposal ${id} waiting for the AI screen  https://testnet.nearblocks.io/txns/${tx}`);
  const decision = await veto.decision(id);
  const reasons = decision.verdict?.reasons.length ? ` (${decision.verdict.reasons.join(", ")})` : "";
  console.log(`vault: ${decision.status.toUpperCase()}${reasons}`);
}
