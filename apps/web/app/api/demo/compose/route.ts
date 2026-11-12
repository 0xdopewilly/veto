import { allow, demo, vaultAccounts, visitor } from "@/lib/server/demo";
import { requestFromEmail, Unpayable } from "@/lib/server/intake";
import { outlayerEnabled } from "@/lib/server/outlayer";
import { refusal, startPayment } from "@/lib/server/pay";
import { agentApiDemo, runViaAgentApi } from "@/lib/server/agentapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent reads the email, then screening continues after the response.
export const maxDuration = 120;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Anyone can write the agent an email. A real model reads it and proposes whatever it asks for,
 * as a naive agent would; Veto screens that payment like any other. Write a scam and watch.
 */
export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = { from: text(input.from, 120) || "unknown sender", subject: text(input.subject, 200), body: text(input.body, 4000) };
  const via = input.via === "outlayer" ? "outlayer" : input.via === "agentapi" ? "agentapi" : undefined;
  const accounts = vaultAccounts(typeof input.vault === "string" ? input.vault : undefined);
  if (!accounts) return Response.json({ error: "the demo agent doesn't work for that vault" }, { status: 404 });
  if (email.body.length < 10) return Response.json({ error: "Write the email first." }, { status: 400 });
  if (via === "outlayer" && !(accounts.sandbox && outlayerEnabled())) return Response.json({ error: "the OutLayer wallet is not configured" }, { status: 404 });
  if (via === "agentapi" && !(accounts.sandbox && agentApiDemo())) return Response.json({ error: "the Agent API wallet is not configured" }, { status: 404 });
  if (!allow(`compose:${visitor(req)}`, 8, 10 * 60_000) || !allow(`compose:${accounts.vaultId}`, 30, 10 * 60_000) || !allow("compose", 60, 10 * 60_000)) {
    return Response.json({ error: "too many emails; try again in a few minutes" }, { status: 429 });
  }

  try {
    const { request, agent } = await requestFromEmail(accounts, email);

    if (via === "agentapi") {
      if (request.chain !== "near") return Response.json({ error: "The Agent API wallet pays USDC on NEAR. Ask for USDC instead." }, { status: 422 });
      const agentapi = await runViaAgentApi({ payee: request.payee, amount: request.amount, memo: request.memo ?? null, evidence: { source: "email", ...email }, scaled: false });
      return Response.json({ agentapi, agent });
    }
    const result = await startPayment(accounts, request, { source: "email", ...email }, via);
    return Response.json({ ...result, agent });
  } catch (e) {
    if (e instanceof Unpayable) return Response.json({ error: e.message }, { status: 422 });
    return refusal(e);
  }
}
