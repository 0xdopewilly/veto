import { allow, demo, demoAccounts } from "@/lib/server/demo";
import { outlayerEnabled } from "@/lib/server/outlayer";
import { buildScenarios } from "@/lib/server/scenarios";
import { evmDemo } from "@/lib/server/evm";
import { refusal, startPayment, units } from "@/lib/server/pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Screening (and, for OutLayer, the vote and settlement) continues after the response.
export const maxDuration = 120;

/**
 * The agent reads one inbox message and proposes the payment it asks for, exactly as a
 * naive agent would. The guardian then screens it and the vault decides on-chain.
 * With `via: "outlayer"` the agent pays from its OutLayer wallet instead, which holds the
 * payment until the guardian votes on it.
 */
export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const { scenario, via } = (await req.json().catch(() => ({}))) as { scenario?: string; via?: string };
  if (via === "outlayer" && !outlayerEnabled()) return Response.json({ error: "the OutLayer wallet is not configured" }, { status: 404 });
  if (!allow("run", 12, 10 * 60_000)) return Response.json({ error: "too many demo runs; try again in a few minutes" }, { status: 429 });

  const { reader } = demoAccounts();
  const history = await reader.proposals(0, 50);
  const chosen = buildScenarios(demo.root, history, await evmDemo()).find((s) => s.id === scenario);
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
    return Response.json(await startPayment(request, evidence, via));
  } catch (e) {
    return refusal(e);
  }
}
