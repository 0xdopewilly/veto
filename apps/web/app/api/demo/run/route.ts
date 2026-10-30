import { after } from "next/server";
import { actions, teraToGas } from "near-api-js";
import { canonicalJson, screenAndSubmit, sha256Hex } from "@veto/core";
import { allow, demo, demoAccounts } from "@/lib/server/demo";
import { buildScenarios } from "@/lib/server/scenarios";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Screening continues after the response; give it room on serverless hosts.
export const maxDuration = 60;

/**
 * The agent reads one inbox message and proposes the payment it asks for, exactly as a
 * naive agent would. The guardian then screens it and the vault decides on-chain.
 */
export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const { scenario } = (await req.json().catch(() => ({}))) as { scenario?: string };
  if (!allow("run", 12, 10 * 60_000)) return Response.json({ error: "too many demo runs; try again in a few minutes" }, { status: 429 });

  const { reader, agent, guardian, screener } = demoAccounts();
  const history = await reader.proposals(0, 50);
  const chosen = buildScenarios(demo.root, history).find((s) => s.id === scenario);
  if (!chosen) return Response.json({ error: "unknown scenario" }, { status: 400 });

  try {
    const evidence = { source: chosen.from.includes("@") ? "email" : "web page", from: chosen.from, subject: chosen.subject, body: chosen.body };
    const contextHash = sha256Hex(canonicalJson(evidence));
    const request = {
      chain: "near",
      asset: demo.token,
      payee: chosen.payee,
      amount: String(BigInt(Math.round(Number(chosen.amount) * 100)) * 10_000n),
      memo: chosen.memo,
    };
    const outcome = await agent.signAndSendTransaction({
      receiverId: demo.vaultId,
      actions: [actions.functionCall("propose", { request, context_hash: contextHash }, teraToGas("30"), 0n)],
      waitUntil: "FINAL",
    });
    const value = (outcome.status as { SuccessValue?: string }).SuccessValue;
    if (!value) throw new Error("the vault refused the proposal");
    const id: string = JSON.parse(Buffer.from(value, "base64").toString());

    after(async () => {
      try {
        const proposal = await reader.proposal(id);
        if (proposal?.status === "Screening") await screenAndSubmit({ vault: reader, guardian, screener, proposal, evidence });
      } catch (e) {
        console.error(`demo screening for proposal ${id} failed:`, (e as Error).message);
      }
    });
    return Response.json({ proposal_id: id, tx: outcome.transaction.hash });
  } catch (e) {
    const message = (e as Error).message;
    // The vault's own refusals (caps, frozen) are the demo working, not a server error.
    const refused = /exceeds|frozen|not allowed|not an active agent/.test(message);
    return Response.json({ error: refused ? `The vault refused it: ${message.replace(/^.*Smart contract panicked: /, "")}` : message }, { status: refused ? 422 : 500 });
  }
}
