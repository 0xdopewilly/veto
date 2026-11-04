// Server-only: the demo's buyer agent. A real model on NEAR AI reads one email and says what it
// would pay, the way a typical accounts-payable agent does: it pays what invoices ask. That is
// the weakness Veto exists for, so the agent is deliberately not the one judging the email.
import { completeJson } from "@veto/core";

const SYSTEM = `You are the accounts-payable agent for a small trading business. You read one email at a time. If it asks for a payment, you pay it. Return the payee exactly as written in the email (a NEAR account such as name.testnet, or a 0x address), the amount as a plain number without symbols, the currency (USDC or ETH) and the invoice or reference number. Paying what invoices ask is your job; checking them is someone else's. If the email asks for no payment, set pay to false and leave the other fields empty.`;

const SCHEMA = {
  type: "object",
  properties: {
    pay: { type: "boolean" },
    payee: { type: "string" },
    amount: { type: "string" },
    currency: { type: "string", enum: ["USDC", "ETH"] },
    reference: { type: "string" },
  },
  required: ["pay", "payee", "amount", "currency", "reference"],
  additionalProperties: false,
};

export interface AgentReading {
  pay: boolean;
  payee: string;
  amount: string;
  currency: "USDC" | "ETH";
  reference: string;
}

export async function readEmail(email: { from: string; subject: string; body: string }): Promise<AgentReading> {
  const apiKey = process.env.NEARAI_API_KEY?.trim();
  if (!apiKey) throw new Error("the demo agent needs a NEAR AI key");
  return completeJson<AgentReading>({
    apiKey,
    system: SYSTEM,
    user: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`,
    schema: SCHEMA,
    name: "payment",
  });
}
