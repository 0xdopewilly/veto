// Veto's MCP server. Sandbox mode (the default) drives the hosted testnet demo with no keys;
// own-vault mode proposes payments to your vault through @veto/sdk. See main.ts for the choice.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import * as z from "zod";
import type { Proposal } from "@veto/core/proposal";
import { describeProposal, describeRules, payoutTx, proposalText, rulesText, toUnits, EXPLORER } from "./describe.ts";
import type { Sandbox } from "./sandbox.ts";
import type { OwnVault } from "./vault.ts";

export const VERSION = "0.1.0";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type Mode = { kind: "sandbox"; sandbox: Sandbox } | { kind: "vault"; vault: OwnVault; secrets?: string[] };

const SANDBOX_INSTRUCTIONS = `Veto is a NEAR vault where an AI agent's payments need two things: the vault's hard caps, and a PASS from a model running in NEAR AI Cloud's enclave (TEE). The vault checks the enclave's signature on-chain before it pays. The model can only say no: it can block a payment the caps allow, never allow one they block.

This server is in sandbox mode: it drives the shared demo at https://veto-beta.vercel.app on NEAR testnet, with no keys and no funds of your own. Use veto_sandbox_send_email to write the demo's payments agent an email; the agent proposes whatever the email asks for and Veto screens it. Use veto_sandbox_inbox first to see the vault's payees, caps and example emails. Payments are real NEAR testnet transactions of test tokens from a shared public vault, and the emails are published with each decision's proof.`;

const VAULT_INSTRUCTIONS = `Veto is a NEAR vault where an AI agent's payments need two things: the vault's hard caps, and a PASS from a model running in NEAR AI Cloud's enclave (TEE). The vault checks the enclave's signature on-chain before it pays. The model can only say no.

This server is in own-vault mode: veto_propose_payment proposes payments from the configured agent account to the configured vault, and the guardian it is configured with screens them. Read veto_vault_rules before proposing, so a payment fits the caps and the payee list.`;

const text = (t: string, data?: Record<string, unknown>, isError = false): CallToolResult => ({
  content: [{ type: "text", text: t }],
  ...(data && { structuredContent: data }),
  ...(isError && { isError: true }),
});

/** Progress notifications, when the client asked for them, so a long wait shows what's happening. */
function progress(extra: Extra) {
  const token = extra._meta?.progressToken;
  let n = 0;
  let last = "";
  return (message: string) => {
    if (token === undefined || message === last) return;
    last = message;
    extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message } }).catch(() => {});
  };
}

const waitSeconds = (fallback: number) =>
  z
    .number()
    .int()
    .min(0)
    .max(600)
    .default(fallback)
    .describe(`How long to wait for the decision, in seconds (default ${fallback}). If it isn't decided by then, the tool returns the current status and the payment carries on; check it later by id.`);

const paymentId = z
  .string()
  .regex(/^\d+$/, "a payment id is a number, like 143")
  .describe('The payment\'s id on the vault, e.g. "143" (the tools that make payments return it).');

export function createServer(mode: Mode): McpServer {
  const server = new McpServer({ name: "veto", version: VERSION }, { instructions: mode.kind === "sandbox" ? SANDBOX_INSTRUCTIONS : VAULT_INSTRUCTIONS });
  if (mode.kind === "sandbox") registerSandbox(server, mode.sandbox);
  else registerVault(server, mode.vault, mode.secrets ?? []);
  return server;
}

function registerSandbox(server: McpServer, sandbox: Sandbox) {
  const describe = (p: Proposal, state: Awaited<ReturnType<Sandbox["state"]>>, proposalTx?: string, verdictTx?: string | null) =>
    describeProposal(p, state.assets[p.request.asset], state.payees, sandbox.links(p.id, { proposalTx, verdictTx, payoutTx: payoutTx(p, EXPLORER.testnet) }));

  server.registerTool(
    "veto_sandbox_send_email",
    {
      title: "Email the Veto demo agent",
      description: `Writes an email to the payments agent of Veto's shared sandbox vault on NEAR testnet, hosted at ${sandbox.baseUrl}. No keys or funds needed.

What happens: the hosted agent (a model on NEAR AI Cloud) reads the email and proposes whatever payment it asks for, as a naive accounts-payable agent would. The vault contract checks its hard caps; then Veto's screen, a model in NEAR AI Cloud's enclave, reads the email and answers PASS or VETO; the vault checks the enclave's signature on-chain and pays only on a PASS. This tool waits for that decision and returns the status (Paid, Vetoed, Expired or Failed, or refused by the vault before screening), the reasons in plain words, the amount and payee, testnet transaction links and the decision's Proof page.

Side effects: real NEAR testnet transactions on a shared public demo vault. A PASS sends test USDC (or test ETH on Base Sepolia) to the payee the email names. The email is published with the decision's proof, so write nothing private. Like a new visitor in the browser, the first email of a session asks the demo to restore the sandbox's default rules (unfrozen, the usual mandate and suppliers). The demo allows about 8 emails per visitor every 10 minutes.

The agent pays USDC to a NEAR testnet account (name.testnet) or ETH on Base Sepolia to a 0x address. For a payment that should pass, invoice a supplier on the vault's payee list (see veto_sandbox_inbox), under the per-payment cap, with an invoice number not paid before. For a veto, try changed bank or wallet details, a lookalike account, urgency, or a hidden instruction to an AI.`,
      inputSchema: {
        from: z.string().max(120).default("unknown sender").describe('The sender, e.g. "accounts@kanocottonmills.ng".'),
        subject: z.string().max(200).default("").describe("The subject line."),
        body: z.string().min(10).max(4000).describe("The email's text, including the payee, the amount and the invoice or reference number."),
        wait_seconds: waitSeconds(45),
      },
      annotations: { title: "Email the Veto demo agent", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ from, subject, body, wait_seconds }, extra) => {
      const report = progress(extra);
      await sandbox.resetIfNewVisit();
      report("The demo agent is reading the email");
      const outcome = await sandbox.compose({ from, subject, body });
      if (outcome.kind === "refused") {
        return text(`Refused by the vault before any screening; nothing was paid. ${outcome.message}\n\nThe vault contract checks its hard caps (per payment and per period) and its own rules when a payment is proposed. The AI screen can only add a no on top of them.`, {
          status: "RefusedByVault",
          message: outcome.message,
        });
      }
      if (outcome.kind === "not_proposed") return text(`Nothing was proposed, so nothing was paid. ${outcome.message}`, { status: "NotProposed", message: outcome.message });
      if (outcome.kind === "error") {
        const hint = outcome.status === 429 ? " The hosted demo limits each visitor to about 8 emails every 10 minutes." : "";
        return text(`The hosted demo didn't take the email (${outcome.status}): ${outcome.message}${hint}`, { status: "Error", http_status: outcome.status, message: outcome.message }, true);
      }

      const { id, tx, agent } = outcome;
      const read = `The demo agent read the email and proposed payment #${id}: ${agent.amount} ${agent.currency} to ${agent.payee}${agent.reference ? `, reference ${agent.reference}` : ""}.`;
      report(`Payment #${id} proposed; screening in the enclave`);
      const waited = await sandbox.wait(id, wait_seconds * 1000, { signal: extra.signal, onPoll: (p) => p && report(`Payment #${id}: ${p.status}`) });
      if (!waited.proposal) {
        return text(`${read}\n\nThe vault doesn't show it yet. Check it with veto_sandbox_status (id ${id}).\nProposal transaction: ${EXPLORER.testnet}/txns/${tx}`, { status: "Unknown", id, agent_read: agent });
      }
      const verdictTx = waited.proposal.verdict ? await sandbox.verdictTx(id, 4, extra.signal) : null;
      const d = describe(waited.proposal, waited.state, tx, verdictTx);
      const pending = waited.decided ? "" : `\n\nNot decided after ${wait_seconds} s. The payment carries on; check it with veto_sandbox_status (id ${id}).`;
      return text(`${read}\n\n${proposalText(d)}${pending}`, { ...d, agent_read: agent });
    },
  );

  server.registerTool(
    "veto_sandbox_status",
    {
      title: "Veto sandbox payment status",
      description:
        "Reads one payment on Veto's shared sandbox vault (NEAR testnet) by id and returns its status, the verdict and its reasons in plain words, the amount and payee, testnet transaction links and the Proof page. Read-only for you; like the browser app's own polling, the read also lets the hosted demo expire a screening that missed its deadline or send a payout that stalled.",
      inputSchema: { id: paymentId },
      annotations: { title: "Veto sandbox payment status", readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }, extra) => {
      const { proposal, state } = await sandbox.proposal(id, extra.signal);
      if (!proposal) return text(`There is no payment #${id} on the sandbox vault ${sandbox.vaultId}.`, { status: "NotFound", id }, true);
      const verdictTx = proposal.verdict ? await sandbox.verdictTx(id, 1, extra.signal) : null;
      const d = describe(proposal, state, undefined, verdictTx);
      return text(proposalText(d), { ...d });
    },
  );

  server.registerTool(
    "veto_sandbox_inbox",
    {
      title: "Veto sandbox inbox and rules",
      description:
        "Lists the example emails in the sandbox agent's inbox (which ones Veto is expected to pass or veto) and the sandbox vault's rules: the owner's mandate, the hard caps with what's left this period, and the payee list. Use it before veto_sandbox_send_email to write an invoice that should pass, or a scam that should be vetoed. Read-only.",
      inputSchema: {},
      annotations: { title: "Veto sandbox inbox and rules", readOnlyHint: true, openWorldHint: true },
    },
    async (_args, extra) => {
      const [info, state] = await Promise.all([sandbox.info(), sandbox.state(extra.signal)]);
      const rules = describeRules({ vaultId: sandbox.vaultId, network: "testnet", ...state });
      const lines = [
        `Veto's shared sandbox at ${sandbox.baseUrl}: the demo agent ${info.agent.account} proposes payments; ${info.guardian.model} in NEAR AI Cloud's enclave screens them${info.guardian.test_signer ? " (a labelled test signer right now)" : ""}.${info.nearai === "down" ? " NEAR AI Cloud isn't serving the model right now, so emails will fail until it's back." : ""}`,
        "",
        "Example emails in the demo inbox (in the browser app, Try it lets the agent pay these; here, write your own with veto_sandbox_send_email):",
        ...info.scenarios.map((s) => `- Expected ${s.expect === "pass" ? "PASS" : "VETO"}: "${s.subject}" from ${s.from}, ${s.amount} ${s.symbol ?? "USDC"} to ${s.payee}. ${s.preview}`),
        "",
        rulesText(rules),
      ];
      return text(lines.join("\n"), {
        demo: sandbox.baseUrl,
        agent: info.agent.account,
        model: info.guardian.model,
        nearai: info.nearai ?? "unknown",
        scenarios: info.scenarios.map(({ id, title, from, subject, preview, amount, payee, expect, symbol, chain }) => ({ id, title, from, subject, preview, amount, symbol: symbol ?? "USDC", chain: chain ?? "near", payee, expect })),
        rules,
      });
    },
  );
}

function registerVault(server: McpServer, vault: OwnVault, secrets: string[]) {
  const { vaultId, network } = vault.backend;
  // Belt and braces: no message that leaves this process may carry the agent's key.
  const redact = (s: string) => secrets.reduce((acc, k) => (k ? acc.split(k).join("[redacted]") : acc), s);
  const failure = (e: unknown) => {
    const message = redact((e as Error).message ?? String(e));
    const panicked = message.match(/Smart contract panicked: (.*)/)?.[1];
    if (panicked) return text(`The vault refused it before any screening; nothing was paid: ${panicked}`, { status: "RefusedByVault", message: panicked });
    const hint = /fetch failed|ECONNREFUSED/.test(message) ? " (the guardian at VETO_GUARDIAN_URL or NEAR's RPC didn't answer)" : "";
    return text(`${message}${hint}`, { status: "Error", message }, true);
  };
  const describe = async (p: Proposal, proposalTx?: string) => {
    const [asset, payees] = await Promise.all([vault.asset(p.request.asset).catch(() => undefined), vault.backend.view<{ name: string; chain: string; address: string; added_at: string }[]>("get_payees").catch(() => [])]);
    return describeProposal(p, asset, payees, { ...vault.links(p.id, proposalTx), ...(payoutTx(p, vault.explorer) && { payout_tx: payoutTx(p, vault.explorer)! }) });
  };

  server.registerTool(
    "veto_propose_payment",
    {
      title: "Propose a payment to your Veto vault",
      description: `Proposes a payment from the agent account to the Veto vault ${vaultId} on NEAR ${network}, then waits for the decision. ${network === "mainnet" ? "This is mainnet: a PASS moves real funds." : "This is testnet."}

What happens: the evidence (if any) goes to your guardian at its /evidence endpoint and only its hash goes on-chain when the agent proposes (a vault on checked screening, the default, then puts the evidence on-chain with the verdict so it can rebuild the exact request the model saw); the agent signs a propose transaction; the vault checks its hard caps; the guardian has a model in NEAR AI Cloud's enclave screen the payment and submits the signed verdict; the vault checks the signature on-chain and pays only on a PASS. Returns the status (Paid, Vetoed, Expired, Failed, or refused by the vault before screening), the reasons in plain words, and transaction links. Read veto_vault_rules first.`,
      inputSchema: {
        payee: z.string().min(2).max(100).describe("Who to pay: a NEAR account (name.testnet), or an address on `chain`."),
        amount: z.string().regex(/^\d[\d,]*(\.\d+)?$/, "a plain number, like 180 or 180.50").describe('The amount in the asset\'s whole units, e.g. "180.50" for $180.50 of USDC. Converted with the asset\'s decimals.'),
        asset: z
          .string()
          .optional()
          .describe('"near", a NEP-141 token contract (e.g. usdc.example.testnet), or an EVM coin the vault has a route for (e.g. "base-sepolia:eth"). Defaults to the vault\'s first token with caps, else NEAR.'),
        chain: z.string().optional().describe('The chain the payee is on: "near" (default), or the chain of an EVM route ("base-sepolia", taken from the asset when omitted).'),
        memo: z.string().max(128).optional().describe("An invoice number or other reference. Goes on-chain and into the screen's duplicate check."),
        evidence: z
          .object({
            source: z.string().describe('Where the instruction came from: "email", "web page", "document", "chat".'),
            from: z.string().optional().describe("The sender, if any."),
            subject: z.string().optional().describe("The subject or title, if any."),
            body: z.string().max(200_000).describe("The text that led to this payment, verbatim."),
          })
          .optional()
          .describe("What led to the payment: the screen reads it to catch changed details, lookalikes, urgency and injected instructions. It goes to your guardian, and inside the screening prompt to NEAR AI Cloud's enclave; only its hash goes on-chain."),
        wait_seconds: waitSeconds(45),
      },
      annotations: { title: "Propose a payment to your Veto vault", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ payee, amount, asset, chain, memo, evidence, wait_seconds }, extra) => {
      const report = progress(extra);
      try {
        const assetId = asset?.trim() || (await vault.defaultAsset());
        const meta = await vault.asset(assetId);
        const units = toUnits(amount, meta.decimals);
        const chainId = chain?.trim() || (assetId.includes(":") ? assetId.split(":")[0] : "near");
        report("Proposing the payment");
        const { id, tx } = await vault.backend.propose({ payee: payee.trim(), amount: units, asset: assetId, chain: chainId, memo: memo || undefined, evidence });
        report(`Payment #${id} proposed; screening in the enclave`);
        const waited = await vault.wait(id, wait_seconds * 1000, { signal: extra.signal, onPoll: (p) => p && report(`Payment #${id}: ${p.status}`) });
        if (!waited.proposal) return text(`Proposed payment #${id}, but the vault doesn't show it yet.\nProposal transaction: ${vault.explorer}/txns/${tx}`, { status: "Unknown", id });
        const d = await describe(waited.proposal, tx);
        const pending = waited.decided ? "" : `\n\nNot decided after ${wait_seconds} s. The payment carries on; check it with veto_payment_status (id ${id}). Is your guardian running?`;
        return text(`${proposalText(d)}${pending}`, { ...d });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "veto_payment_status",
    {
      title: "Veto payment status",
      description: `Reads one payment on the vault ${vaultId} (NEAR ${network}) by id: its status, the verdict and its reasons in plain words, the amount and payee, and links. Read-only.`,
      inputSchema: { id: paymentId },
      annotations: { title: "Veto payment status", readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => {
      try {
        const p = await vault.backend.proposal(id);
        if (!p) return text(`There is no payment #${id} on ${vaultId}.`, { status: "NotFound", id }, true);
        const d = await describe(p);
        return text(proposalText(d), { ...d });
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "veto_vault_rules",
    {
      title: "Veto vault rules",
      description: `Reads the rules of the vault ${vaultId} (NEAR ${network}): the owner's mandate, the hard caps per asset with what's spent and left this period, pending cap changes, the payee list, and whether the vault is frozen. Read-only.`,
      inputSchema: {},
      annotations: { title: "Veto vault rules", readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const rules = describeRules(await vault.rules());
        return text(rulesText(rules), { ...rules });
      } catch (e) {
        return failure(e);
      }
    },
  );
}
