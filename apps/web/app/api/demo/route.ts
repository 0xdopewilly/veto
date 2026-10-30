import { demo, demoAccounts } from "@/lib/server/demo";
import { buildScenarios } from "@/lib/server/scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!demo.enabled) return Response.json({ enabled: false });
  const { reader, screener, owner } = demoAccounts();
  const history = await reader.proposals(0, 50);
  return Response.json({
    enabled: true,
    network: "testnet",
    vault: demo.vaultId,
    agent: { account: demo.agentId },
    guardian: { account: demo.guardianId, model: screener.model, test_signer: screener.model.startsWith("veto-dev/") },
    owner: owner ? { account: demo.ownerId } : null,
    scenarios: buildScenarios(demo.root, history).map(({ body: _body, memo: _memo, ...card }) => card),
  });
}
