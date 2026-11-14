// Server-only: turns one email into the payment the demo agent would propose. Shared by "Write your
// own email" and the agent's real inbox, so both read email the same way.
import type { PaymentRequest } from "@veto/core";
import { readEmail } from "./agent";
import { demo, type VaultAccounts } from "./demo";
import { evmDemo } from "./evm";
import { units } from "./pay";

const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The agent read the email and there is nothing it can pay; the message says why. */
export class Unpayable extends Error {}

export interface AgentProposal {
  request: PaymentRequest;
  agent: { payee: string; amount: string; currency: "USDC" | "ETH"; reference: string | null };
}

export async function requestFromEmail(accounts: VaultAccounts, email: { from: string; subject: string; body: string }): Promise<AgentProposal> {
  const reading = await readEmail(email);
  if (!reading.pay) throw new Unpayable("The agent read it and found nothing to pay.");
  // The first number in what the agent read ("$64.00", "64 USDC", "1,250.5"). The model sometimes
  // names the payee and leaves the amount blank; then it's the amount the email asks to pay or send.
  const asked =
    /\b(?:pay|send|transfer)\s+(?:us\s+)?\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(?:USDC|USD|ETH)?\b/i.exec(email.body)?.[1] ??
    /(?:\$\s?(\d[\d,]*(?:\.\d+)?))|(?:(\d[\d,]*(?:\.\d+)?)\s*(?:USDC|USD|ETH)\b)/i.exec(email.body)?.slice(1).find(Boolean) ??
    "";
  const amount = (reading.amount.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? asked).replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new Unpayable("The agent couldn't find an amount to pay.");
  const memo = reading.reference.trim().slice(0, 64) || null;

  let request: PaymentRequest;
  if (reading.currency === "ETH") {
    if (!accounts.sandbox) throw new Unpayable("Your vault pays test USDC on NEAR. ETH on Base Sepolia is in the sandbox.");
    const evm = await evmDemo();
    if (!evm?.funded) throw new Unpayable("This demo pays ETH only on Base Sepolia, and that route has no test ETH right now.");
    if (!EVM_ADDRESS.test(reading.payee)) throw new Unpayable(`ETH goes to a 0x address on Base Sepolia; the email gave "${reading.payee}".`);
    request = { chain: evm.chain, asset: evm.asset, payee: reading.payee, amount: units(amount, 18), memo };
  } else {
    const payee = reading.payee.trim().toLowerCase();
    if (!NEAR_ACCOUNT.test(payee)) throw new Unpayable(`USDC goes to a NEAR account (like name.testnet); the email gave "${reading.payee}".`);
    request = { chain: "near", asset: demo.token, payee, amount: units(amount, 6), memo };
  }
  return { request, agent: { payee: request.payee, amount, currency: reading.currency, reference: memo } };
}
