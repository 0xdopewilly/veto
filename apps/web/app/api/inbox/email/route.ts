// The demo agent's real inbox. Mail to veto-agent@agentmail.to reaches the same agent as "Write your
// own email": a model reads it and proposes whatever it asks for, the sandbox vault screens that
// payment with the sender's SPF/DKIM/DMARC results in the evidence, and the agent replies with the
// decision and a link to its proof.
import { after } from "next/server";
import { isNearAiUnavailable, type Proposal } from "@veto/core";
import { addressOf, agentMail, isMachineMail, senderChecks, verifyWebhook, type AgentMail } from "@/lib/server/agentmail";
import { allow, demo, vaultAccounts, type VaultAccounts } from "@/lib/server/demo";
import { requestFromEmail, Unpayable, type AgentProposal } from "@/lib/server/intake";
import { NEAR_AI_DOWN, proposePayment, screenProposal, type Evidence } from "@/lib/server/pay";
import { isTestSigner, reasonText, STATUS_TEXT } from "@/lib/decision";
import { formatDuration } from "@/lib/format";
import { decisionHtml, noteHtml, type ReplyModel } from "@/lib/server/replyHtml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The reply waits for the agent, the proposal and the verdict, after the webhook is answered.
export const maxDuration = 120;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://veto-beta.vercel.app").replace(/\/$/, "");
const RECEIVED = new Set(["message.received", "message.received.unauthenticated"]);
const seen = new Set<string>();
const HANDLED = "veto-handled";

export async function POST(req: Request) {
  const mail = agentMail();
  if (!mail || !demo.enabled) return Response.json({ error: "the agent's inbox is not configured" }, { status: 404 });
  const body = await req.text();
  if (!verifyWebhook(body, req.headers, mail.secret)) return Response.json({ error: "bad signature" }, { status: 401 });
  const event = JSON.parse(body) as { event_type?: string; message?: { inbox_id?: string; message_id?: string } };
  const id = event.message?.message_id;
  // Spam and blocked mail never reach the agent; AgentMail sorts them before we see them.
  if (!RECEIVED.has(event.event_type ?? "") || event.message?.inbox_id !== mail.inbox || !id || seen.has(id)) return new Response(null, { status: 204 });
  seen.add(id);
  const accounts = vaultAccounts();
  if (!accounts) return Response.json({ error: "the sandbox vault is not configured" }, { status: 404 });
  after(() => handle(mail, accounts, id, event.event_type === "message.received.unauthenticated"));
  return new Response(null, { status: 204 });
}

async function handle(mail: AgentMail, accounts: VaultAccounts, messageId: string, unauthenticated: boolean) {
  // A forged From would make every reply land on whoever was impersonated, so a sender that fails
  // authentication is still screened (its decision is public like any other) but never answered.
  let answerable = false;
  // Every reply goes as plain text plus the same in Veto's colours: a decision as its own layout, anything else in the frame.
  const reply = (text: string, html = noteHtml(text)) =>
    answerable ? mail.reply(messageId, text, html).catch((e) => console.error("inbox reply failed:", (e as Error).message)) : Promise.resolve();
  try {
    const m = await mail.message(messageId);
    const auth = m.authentication_results;
    answerable = !unauthenticated && auth?.dmarc !== "fail" && (auth?.spf === "pass" || auth?.dkim === "pass");
    // Svix retries deliveries, and each server instance has its own memory: the label is the record.
    if (m.labels?.includes(HANDLED) || isMachineMail(m, mail.inbox)) return;
    await mail.label(messageId, HANDLED);
    const sender = addressOf(m.from);
    // AgentMail's free plan sends 100 mails a day; these keep one sender, or a flood, from using them up.
    if (!allow(`inbox:${sender}`, 5, 60 * 60_000) || !allow("inbox", 40, 60 * 60_000)) {
      if (allow(`inbox-told:${sender}`, 1, 60 * 60_000)) await reply("The demo agent is reading too much mail right now. Try again in an hour, or use Write your own email at " + `${SITE}/app.`);
      return;
    }
    const email = { from: m.from.slice(0, 120), subject: (m.subject ?? "").trim().slice(0, 200), body: (m.extracted_text || m.text || "").trim().slice(0, 4000) };
    if (email.body.length < 10) return void (await reply(await help(accounts, "Your email had no text the agent could read.")));
    const evidence: Evidence = { source: "email", ...email, to: mail.inbox, sender_checks: senderChecks(m.authentication_results, unauthenticated) };

    let proposal: AgentProposal;
    try {
      proposal = await requestFromEmail(accounts, email);
    } catch (e) {
      if (e instanceof Unpayable) return void (await reply(await help(accounts, e.message)));
      throw e;
    }
    let id: string;
    try {
      ({ proposal_id: id } = await proposePayment(accounts, proposal.request, evidence));
    } catch (e) {
      const why = (e as Error).message.replace(/^.*Smart contract panicked: /, "");
      return void (await reply(`The agent asked to pay ${proposal.agent.amount} ${proposal.agent.currency} to ${proposal.agent.payee}, and the vault refused it before any screening: ${why}\n\n${FOOTER}`));
    }
    await screenProposal(accounts, id, evidence);
    const decided = await accounts.reader.proposal(id);
    const config = await accounts.reader.config().catch(() => null);
    const delay = formatDuration(Number(config?.override_delay_secs ?? 180));
    await reply(decision(decided, proposal, id, delay), decisionHtml(replyModel(decided, proposal, id, delay)));
  } catch (e) {
    if (isNearAiUnavailable(e)) return void (await reply(NEAR_AI_DOWN));
    console.error(`inbox message ${messageId} failed:`, (e as Error).message);
  }
}

const FOOTER = `Veto demo agent on NEAR testnet. It pays test USDC from a shared sandbox vault, so nothing real moves.`;

/** "Screened in 6.2 s by Qwen3-VL-30B inside NEAR AI's enclave…", from the verdict itself. */
function screened(p: Proposal): string | null {
  const v = p.verdict;
  if (!v) return null;
  const secs = (Number(BigInt(v.recorded_at) - BigInt(p.created_at)) / 1e9).toFixed(1);
  if (isTestSigner(v.model_id)) return `Screened in ${secs} s by a local test signer.`;
  const model = (v.model_id.split("/").pop() ?? v.model_id).replace(/-Instruct$/i, "").replace(/-A\d+B$/i, "");
  return `Screened in ${secs} s by ${model} inside NEAR AI's enclave. The vault checked its signature on-chain before acting.`;
}

/** The decision, straight to the point: what happened, why, what happens next, and where the proof is. */
function decision(p: Proposal | null, { agent }: AgentProposal, id: string, delay: string): string {
  const what = `${agent.amount} ${agent.currency} to ${agent.payee}${agent.reference ? ` (${agent.reference})` : ""}`;
  const link = `The decision and its proof:\n${SITE}/app/decisions/${id}`;
  const by = p ? screened(p) : null;
  const parts = (...xs: (string | null)[]) => xs.filter(Boolean).join("\n\n");
  if (!p || p.status === "Screening") return parts(`Screening: ${what}.`, "Veto hasn't decided yet. The decision page updates the moment it does.", link, FOOTER);
  if (p.status === "Vetoed") {
    const reasons = (p.verdict?.reasons ?? []).map((r) => `- ${reasonText(r)}`).join("\n") || "- The payment didn't match the evidence.";
    return parts(
      `Vetoed: ${what}. Nothing was paid.`,
      `Why:\n${reasons}`,
      `The payment is held in the vault. Its owner can keep it blocked, or override the veto, and then it pays after ${delay}. The AI alone can never pay.`,
      by,
      link,
      FOOTER,
    );
  }
  if (p.status === "Paid" || p.status === "Executing") {
    return parts(`Paid: ${what}.`, "It matched the owner's mandate, the payee list and the payment history, and it was within the vault's limits.", by, link, FOOTER);
  }
  return parts(`${STATUS_TEXT[p.status]}: ${what}.`, link, FOOTER);
}

/** The same decision, laid out for the HTML reply. */
function replyModel(p: Proposal | null, { agent }: AgentProposal, id: string, delay: string): ReplyModel {
  const status = p?.status ?? "Screening";
  const vetoed = status === "Vetoed";
  const paid = status === "Paid" || status === "Executing";
  return {
    verdict: vetoed ? "vetoed" : paid ? "paid" : "other",
    word: vetoed ? "VETOED" : paid ? "PAID" : STATUS_TEXT[status].toUpperCase(),
    amount: agent.amount,
    currency: agent.currency,
    payee: agent.payee,
    reference: agent.reference,
    line: vetoed ? "Nothing was paid." : paid ? "Paid from the vault." : status === "Screening" ? "Veto hasn't decided yet." : `The vault's decision: ${STATUS_TEXT[status]}.`,
    reasons: vetoed ? (p?.verdict?.reasons ?? []).map(reasonText) : [],
    next: vetoed
      ? `The payment is held in the vault. Its owner can keep it blocked, or override the veto, and then it pays after ${delay}. The AI alone can never pay.`
      : paid
        ? "It matched the owner's mandate, the payee list and the payment history, and it was within the vault's limits."
        : status === "Screening"
          ? "The decision page updates the moment the verdict lands."
          : null,
    screened: p ? screened(p) : null,
    decisionUrl: `${SITE}/app/decisions/${id}`,
    proofUrl: `${SITE}/app/decisions/${id}/proof`,
    footer: FOOTER,
  };
}

async function help(accounts: VaultAccounts, problem: string): Promise<string> {
  const payees = await accounts.reader.payees().catch(() => []);
  const example = payees.find((p) => p.chain === "near")?.address ?? "a-supplier.testnet";
  return `${problem}\n\nThe agent pays invoices in test USDC to NEAR testnet accounts. Write the payment plainly, for example:\n\n  "Please send 120 USDC to ${example} for invoice INV-7731. Thanks!"\n\n${FOOTER}`;
}
