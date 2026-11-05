import { allow, demo, vaultAccounts } from "@/lib/server/demo";
import { outlayerEnabled } from "@/lib/server/outlayer";
import { buildScenarios } from "@/lib/server/scenarios";
import { evmDemo } from "@/lib/server/evm";
import { refusal, startPayment, units } from "@/lib/server/pay";
import { agentApiDemo, agentApiWorker, runViaAgentApi } from "@/lib/server/agentapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Screening (and, for OutLayer, the vote and settlement) continues after the response.
export const maxDuration = 120;

/**
 * The agent reads one inbox message and proposes the payment it asks for, exactly as a
 * naive agent would. The guardian then screens it and the vault decides on-chain.
 * With `via: "outlayer"` the agent pays from its OutLayer wallet instead, which holds the
 * payment until the guardian votes on it. With `via: "agentapi"` it asks its NEAR Intents Agent API
 * wallet (mainnet), whose only grant Veto holds: Veto screens and sends only a pass.
 */
export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const { scenario, via, vault } = (await req.json().catch(() => ({}))) as { scenario?: string; via?: string; vault?: string };
  const accounts = vaultAccounts(vault);
  if (!accounts) return Response.json({ error: "the demo agent doesn't work for that vault" }, { status: 404 });
  if (via === "outlayer" && !(accounts.sandbox && outlayerEnabled())) return Response.json({ error: "the OutLayer wallet is not configured" }, { status: 404 });
  if (via === "agentapi" && !(accounts.sandbox && agentApiDemo())) return Response.json({ error: "the Agent API wallet is not configured" }, { status: 404 });
  if (!allow(`run:${accounts.vaultId}`, 12, 10 * 60_000) || !allow("run", 60, 10 * 60_000)) {
    return Response.json({ error: "too many demo runs; try again in a few minutes" }, { status: 429 });
  }

  // The same window the inbox is built from (lib/server/state.ts), so the card and the run agree.
  const history = await accounts.reader.proposals(0, 100);
  const chosen = buildScenarios(demo.root, history, accounts.sandbox ? await evmDemo() : null, accounts.sandbox ? agentApiWorker() : null).find((s) => s.id === scenario);
  if (!chosen) return Response.json({ error: "unknown scenario" }, { status: 400 });

  try {
    const evidence = { source: chosen.from.includes("@") ? "email" : "web page", from: chosen.from, subject: chosen.subject, body: chosen.body };
    const request = {
      chain: chosen.chain ?? "near",
      asset: chosen.asset ?? demo.token,
      payee: chosen.payee,
      amount: units(chosen.amount, chosen.decimals ?? 6),
      memo: chosen.memo,
    };
    if (via === "agentapi") {
      // A payroll email reads as a USDC salary paid out on Base through NEAR Intents on this path.
      const variant = chosen.agentapi;
      if (!variant && request.chain !== "near") return Response.json({ error: "The Agent API wallet pays in USDC. ETH on Base Sepolia goes from the vault." }, { status: 422 });
      return Response.json({
        agentapi: await runViaAgentApi({
          payee: variant?.payee ?? request.payee,
          amount: variant ? units(variant.amount, 6) : request.amount,
          chain: variant?.chain ?? "near",
          memo: request.memo ?? null,
          evidence: variant ? { ...evidence, subject: variant.subject, body: variant.body } : evidence,
          scaled: true,
          books: history,
        }),
      });
    }
    return Response.json(await startPayment(accounts, request, evidence, via));
  } catch (e) {
    return refusal(e);
  }
}
