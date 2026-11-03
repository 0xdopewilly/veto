import { demo, demoAccounts } from "@/lib/server/demo";
import { buildScenarios } from "@/lib/server/scenarios";
import { vaultSnapshot } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demo.enabled) return Response.json({ enabled: false });
  const { screener, owner, outlayer } = demoAccounts();
  let history;
  try {
    history = (await vaultSnapshot()).state.proposals;
  } catch (e) {
    return Response.json({ error: `Could not reach the vault: ${(e as Error).message}` }, { status: 503 });
  }
  return Response.json({
    enabled: true,
    network: "testnet",
    vault: demo.vaultId,
    agent: { account: demo.agentId },
    guardian: { account: demo.guardianId, model: screener.model, test_signer: screener.model.startsWith("veto-dev/") },
    owner: owner ? { account: demo.ownerId } : null,
    outlayer: outlayer ? { wallet: outlayer.wallet, approver: outlayer.approver.accountId } : null,
    scenarios: buildScenarios(demo.root, history).map(({ body: _body, memo: _memo, ...card }) => card),
  });
}
