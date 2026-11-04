import { allow, demo, vaultAccounts } from "@/lib/server/demo";
import { readEmail } from "@/lib/server/agent";
import { evmDemo } from "@/lib/server/evm";
import { outlayerEnabled } from "@/lib/server/outlayer";
import { refusal, startPayment, units } from "@/lib/server/pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The agent reads the email, then screening continues after the response.
export const maxDuration = 120;

const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Anyone can write the agent an email. A real model reads it and proposes whatever it asks for,
 * as a naive agent would; Veto screens that payment like any other. Write a scam and watch.
 */
export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const input = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = { from: text(input.from, 120) || "unknown sender", subject: text(input.subject, 200), body: text(input.body, 4000) };
  const via = input.via === "outlayer" ? "outlayer" : undefined;
  const accounts = vaultAccounts(typeof input.vault === "string" ? input.vault : undefined);
  if (!accounts) return Response.json({ error: "the demo agent doesn't work for that vault" }, { status: 404 });
  if (email.body.length < 10) return Response.json({ error: "Write the email first." }, { status: 400 });
  if (via && !(accounts.sandbox && outlayerEnabled())) return Response.json({ error: "the OutLayer wallet is not configured" }, { status: 404 });
  if (!allow(`compose:${accounts.vaultId}`, 10, 10 * 60_000) || !allow("compose", 50, 10 * 60_000)) {
    return Response.json({ error: "too many emails; try again in a few minutes" }, { status: 429 });
  }

  try {
    const reading = await readEmail(email);
    if (!reading.pay) return Response.json({ error: "The agent read it and found nothing to pay." }, { status: 422 });
    // The first number in what the agent read ("$64.00", "64 USDC", "1,250.5").
    const amount = (reading.amount.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) return Response.json({ error: "The agent couldn't find an amount to pay." }, { status: 422 });
    const memo = reading.reference.trim().slice(0, 64) || null;

    let request;
    if (reading.currency === "ETH") {
      if (!accounts.sandbox) return Response.json({ error: "Your vault pays test USDC on NEAR. ETH on Base Sepolia is in the sandbox." }, { status: 422 });
      const evm = await evmDemo();
      if (!evm?.funded) return Response.json({ error: "This demo pays ETH only on Base Sepolia, and that route has no test ETH right now." }, { status: 422 });
      if (!EVM_ADDRESS.test(reading.payee)) return Response.json({ error: `ETH goes to a 0x address on Base Sepolia; the email gave "${reading.payee}".` }, { status: 422 });
      request = { chain: evm.chain, asset: evm.asset, payee: reading.payee, amount: units(amount, 18), memo };
    } else {
      const payee = reading.payee.trim().toLowerCase();
      if (!NEAR_ACCOUNT.test(payee)) return Response.json({ error: `USDC goes to a NEAR account (like name.testnet); the email gave "${reading.payee}".` }, { status: 422 });
      request = { chain: "near", asset: demo.token, payee, amount: units(amount, 6), memo };
    }

    const result = await startPayment(accounts, request, { source: "email", ...email }, via);
    return Response.json({ ...result, agent: { payee: request.payee, amount, currency: reading.currency, reference: memo } });
  } catch (e) {
    return refusal(e);
  }
}
