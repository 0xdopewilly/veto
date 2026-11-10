import { SANDBOX_ID } from "@/lib/config";
import { demo, vaultAccounts } from "@/lib/server/demo";
import { buildScenarios } from "@/lib/server/scenarios";
import { evmDemo } from "@/lib/server/evm";
import { vaultSnapshot } from "@/lib/server/state";
import { AGENT_SCALE, agentApiDemo, agentApiWorker } from "@/lib/server/agentapi";
import { nearAiStatus } from "@/lib/server/nearaiStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!demo.enabled) return Response.json({ enabled: false });
  const accounts = vaultAccounts(new URL(req.url).searchParams.get("vault") || SANDBOX_ID);
  if (!accounts) return Response.json({ enabled: false });
  const { vaultId, sandbox, screener, owner, outlayer } = accounts;
  // Asked alongside the vault, so it adds no wait of its own.
  const nearai = nearAiStatus();
  let history;
  let evm;
  try {
    history = (await vaultSnapshot(vaultId)).state.proposals;
    // The Base Sepolia route is the sandbox's; owned vaults pay test USDC on NEAR.
    evm = sandbox ? await evmDemo() : null;
  } catch (e) {
    return Response.json({ error: `Could not reach the vault: ${(e as Error).message}` }, { status: 503 });
  }
  return Response.json({
    enabled: true,
    network: "testnet",
    vault: vaultId,
    sandbox,
    agent: { account: accounts.agent.accountId },
    guardian: { account: accounts.guardian.accountId, model: screener.model, test_signer: screener.model.startsWith("veto-dev/") },
    // Whether NEAR AI Cloud, where the agent and the screening both run, answers right now.
    nearai: await nearai,
    owner: owner ? { account: demo.ownerId } : null,
    outlayer: outlayer ? { wallet: outlayer.wallet, approver: outlayer.approver.accountId } : null,
    // A NEAR Intents Agent API wallet on mainnet whose only grant Veto holds (sandbox only).
    agentapi: sandbox && agentApiDemo() ? { agent_id: agentApiDemo()!.agentId, scale: Number(AGENT_SCALE) } : null,
    evm,
    scenarios: buildScenarios(demo.root, history, evm, sandbox ? agentApiWorker() : null).map(({ body: _body, memo: _memo, agentapi, ...card }) => ({
      ...card,
      ...(agentapi && { agentapi: { subject: agentapi.subject, preview: agentapi.preview, amount: agentapi.amount, payee: agentapi.payee, chain: agentapi.chain, payee_label: agentapi.payee_label } }),
    })),
  });
}
