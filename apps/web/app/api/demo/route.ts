import { SANDBOX_ID } from "@/lib/config";
import { demo, vaultAccounts } from "@/lib/server/demo";
import { buildScenarios } from "@/lib/server/scenarios";
import { evmDemo } from "@/lib/server/evm";
import { vaultSnapshot } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!demo.enabled) return Response.json({ enabled: false });
  const accounts = vaultAccounts(new URL(req.url).searchParams.get("vault") || SANDBOX_ID);
  if (!accounts) return Response.json({ enabled: false });
  const { vaultId, sandbox, screener, owner, outlayer } = accounts;
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
    owner: owner ? { account: demo.ownerId } : null,
    outlayer: outlayer ? { wallet: outlayer.wallet, approver: outlayer.approver.accountId } : null,
    evm,
    scenarios: buildScenarios(demo.root, history, evm).map(({ body: _body, memo: _memo, ...card }) => card),
  });
}
