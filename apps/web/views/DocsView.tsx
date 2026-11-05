"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EXPLORER, SANDBOX_ID as VAULT_ID } from "@/lib/config";
import { Circuit } from "@/components/Circuit";
import { LineReveal } from "@/components/LineReveal";
import { SmoothScroll } from "@/components/SmoothScroll";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import styles from "./DocsView.module.css";

const SECTIONS = [
  { id: "what", label: "What Veto is" },
  { id: "problem", label: "Why limits aren't enough" },
  { id: "flow", label: "How a payment flows" },
  { id: "rule", label: "The AI can only say no" },
  { id: "proof", label: "Checking a decision" },
  { id: "cross-chain", label: "Other chains" },
  { id: "outlayer", label: "OutLayer wallets" },
  { id: "agent-api", label: "NEAR Intents Agent API" },
  { id: "privacy", label: "What stays private" },
  { id: "try", label: "Try it on testnet" },
  { id: "developers", label: "For developers" },
  { id: "near", label: "Built on NEAR" },
  { id: "status", label: "What works today" },
  { id: "faq", label: "Questions" },
];

type Status = "live" | "built" | "next";
const STATUS_TEXT: Record<Status, string> = { live: "Live on testnet", built: "Built and tested", next: "Next" };

const STATUS: { part: string; status: Status; note: string }[] = [
  { part: "Vault contract: caps, verdict check, overrides, freeze", status: "live", note: "48 contract tests; deployed on NEAR testnet." },
  { part: "Your own vault, owned by your wallet", status: "live", note: "A factory creates a vault for any NEAR testnet account in one transaction its wallet signs. The vault code is deployed once as a NEAR global contract, so each new vault stores only its own state (about 1.6 KB). Its agent and screening accounts are its own too, each holding one key that can only call that vault. Every owner action is signed by the owner's wallet." },
  { part: "OutLayer agent wallets", status: "live", note: "Veto is an approver on an OutLayer wallet's policy. Pass, veto and override all run on testnet, settled against the wallet's real transactions." },
  { part: "NEAR Intents Agent API wallet", status: "live", note: "An agent account on mainnet whose owner-signed policy is the hard limit. Veto holds its only grant, screens each request with the same enclave model, and sends only a pass: a transfer to a supplier, or a salary withdrawn to the worker's address on Base. Payments run once the wallet holds a few USDC." },
  { part: "Payroll: staff paid on the chain they chose", status: "live", note: "Staff sit on the payee list with their own wallet and chain. The sandbox pays a salary in test ETH on Base from the vault's Chain Signatures address and vetoes a fake request to send it to a new wallet." },
  { part: "Agent inbox and guardian screening", status: "live", note: "Real proposals and verdicts on testnet, screened by Qwen3-VL-30B inside NEAR AI's enclave. If NEAR AI can't answer, a labelled test key signs instead, so the demo never stalls." },
  { part: "Owner actions in the app", status: "live", note: "In your own vault, only your wallet. In the shared sandbox, a demo-owner key limited to the owner methods, so anyone can try it without a wallet." },
  { part: "Private AI screen on NEAR AI Cloud", status: "live", note: "Qwen3-VL-30B runs in an Intel TDX enclave on NEAR AI Cloud and signs each verdict in about 1.5 s. The vault checks the signature on-chain against the model's attested key." },
  { part: "Paying suppliers on other chains (NEAR Intents)", status: "built", note: "The vault verifies 1Click's signed quote on-chain, tested against a real executable quote. The mainnet payout is scripted and runs once the mainnet vault is funded." },
  { part: "Veto Bench", status: "live", note: "100 scenarios. Qwen3-VL-30B catches 50 of 50 attacks and blocks 8 of 50 honest payments; all 100 signatures re-verify offline. Plain-policy and rules-only baselines are published beside it." },
  { part: "Shield incident check before cross-chain payouts", status: "built", note: "Holds a payout while a NEAR Intents Shield incident touches its chain, bridge, token or payee; fails closed if it outlasts the deadline. Runs when the Shield key is added." },
  { part: "The vault's own Base address via Chain Signatures", status: "live", note: "The vault builds each passed transfer and NEAR's MPC network signs exactly that; the contract tests include byte-for-byte checks against ethers." },
];

const METHODS: { method: string; who: string; does: string }[] = [
  { method: "factory: create_vault(name, label, mandate?)", who: "Anyone", does: "Creates <name>.<factory>, owned by the caller, with starter test funds, caps, suppliers and the enclave model's key, plus its own agent and screening accounts whose keys can only call it." },
  { method: "factory: send_gas(account)", who: "The factory's own key", does: "Sends an empty testnet wallet 0.3 test NEAR for gas, once per wallet. The web app holds a key that can call only this, and calls it when an empty wallet connects." },
  { method: "propose(request, context_hash)", who: "Agent", does: "Asks to pay. Checked against the caps at once; then waits for the screen." },
  { method: "submit_verdict(id, model_id, chat_id, request_hash, response, signature, quote?)", who: "Guardian", does: "Records the signed verdict. PASS pays if the caps still allow it; VETO blocks." },
  { method: "expire(id)", who: "Anyone", does: "Ends a screening with no verdict after the deadline. No verdict means no payment." },
  { method: "override_veto(id) / cancel_override(id)", who: "Owner", does: "Schedules a vetoed payment to pay after the delay, or cancels that." },
  { method: "keep_blocked(id)", who: "Owner", does: "Closes a veto for good. For an OutLayer wallet, Veto then rejects the held payment there." },
  { method: "execute_override(id, quote?)", who: "Anyone", does: "Pays an override once its delay has passed. Still inside the caps." },
  { method: "freeze() / unfreeze()", who: "Owner", does: "Stops every payment and cancels pending overrides." },
  { method: "set_policy(asset, policy)", who: "Owner", does: "Lowering a limit applies now; raising one waits for the raise delay." },
  { method: "set_mandate, add_payee, remove_payee, add_agent, set_agent_active", who: "Owner", does: "What the agent may do, in plain words and as lists." },
  { method: "add_signer(address, model_id)", who: "Owner", does: "Approves a model key after checking its TEE attestation." },
  { method: "set_route(chain, route)", who: "Owner", does: "Lets the vault pay suppliers on another chain through NEAR Intents." },
  { method: "set_evm_route(chain, route)", who: "Owner", does: "Lets the vault pay on an EVM chain from its own Chain Signatures address, with a cap on gas fees." },
  { method: "settle_evm(id, tx_hash)", who: "Guardian", does: "Records the chain's transaction once the guardian has broadcast a payout the MPC network signed." },
  { method: "add_wallet(provider, wallet, name)", who: "Owner", does: "Lets the guardian screen payments from an external agent wallet, such as an OutLayer wallet." },
  { method: "propose_external(request, context_hash, external)", who: "Guardian", does: "Records a payment the wallet is holding for approval. Same caps; then it is screened like any other." },
  { method: "settle_external(id, paid, tx_hash)", who: "Guardian", does: "Marks it paid once the wallet's transaction is final on NEAR, or releases the spend if it failed." },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Is this real, or a simulation?",
    a: "Real, on NEAR testnet. Every vault is a deployed contract, every payment is a testnet transaction you can open on NearBlocks, and every verdict is signed inside NEAR AI's enclave and checked by the contract. The tokens are test tokens. The shared sandbox lets anyone act as its owner so it can be tried without a wallet; a vault you create belongs to your wallet, and nothing changes its rules without your signature.",
  },
  {
    q: "Where do the payment requests come from?",
    a: "From what the agent reads. The inbox holds example emails (a supplier's invoice and a salary, both genuine, and four common scams), and Write your own email sends the agent anything you type: a real model on NEAR AI reads it and proposes whatever it asks for, the way an accounts-payable agent would. In production that is the agent's own inbox, a supplier portal or a web page. Veto never trusts the request; it screens the payment against the evidence.",
  },
  {
    q: "Which model screens the payments?",
    a: "Qwen3-VL-30B-A3B-Instruct, hosted by NEAR AI Cloud inside an Intel TDX enclave. It answers directly without a reasoning phase, so a verdict takes about 1.5 seconds and always arrives in full. The owner approves a model by its attested signing key (add_signer), so any other enclave-hosted model can be used instead; Veto Bench compares them on the same 100 scenarios.",
  },
  {
    q: "What if the AI gets it wrong?",
    a: "If it misses an attack, the payment is still inside the hard caps, so you're no worse off than with a plain spending limit. If it blocks a good payment, the owner overrides it; the override waits for a delay and can be cancelled. The AI never decides alone that money should move.",
  },
  {
    q: "What if the screening service is compromised?",
    a: "The vault only accepts verdicts from the registered guardian account, signed by an approved model key, echoing this exact proposal. A compromised guardian still can't pay more than the caps allow, can't change payees or limits, and can't move money anywhere the agent didn't propose. The guardian does choose the evidence the model reads: the enclave proves which model judged which input, not that the input was the real email. In this demo one server runs both the demo agent and the guardian, so it holds both roles and could propose and pass a payment to any address inside the caps; an owner can close that by requiring listed payees on-chain (set_require_listed_payee). Running the guardian itself inside a TEE is the next step that removes this trust.",
  },
  {
    q: "How is this different from a policy wallet?",
    a: "A policy wallet enforces caps and an allowlist, and Veto's contract does the same. Those rules stop payments to strangers. They can't stop a payment to a listed supplier for an invoice that was already paid, or for more than was billed, and a strict allowlist blocks every new supplier. Veto adds a private screen that reads the evidence behind each payment and can only say no, so the two work together rather than compete. On an OutLayer wallet that is literal: Veto is an approver on the wallet's policy.",
  },
  {
    q: "Can it run payroll?",
    a: "Yes. Staff go on the payee list with the wallet and chain each one chose, and the agent pays salaries like any other payment: inside the caps, screened privately. In the sandbox, Tunde Bello is paid in test ETH on Base from the vault's own address, signed by NEAR's MPC network; on the Agent API path, the salary is USDC withdrawn through NEAR Intents and paid out on Base, to the one address the owner's policy allows for Tunde. The scam payroll attracts most, an email asking to send someone's salary to a new wallet, is vetoed: the address is new and imitates the saved one.",
  },
  {
    q: "Can Veto guard a swarm of agents?",
    a: "Yes. A vault takes any number of agents, each with its own key that can only propose a payment, and the owner can pause one without stopping the rest. Agents running in OutLayer TEE wallets or NEAR Intents Agent API wallets go through the same gate: every payment from any of them gets the same private AI review. Agents on the vault and OutLayer wallets also meet the vault's contract caps; an Agent API wallet meets its owner's signed policy instead. Separate budgets for each agent are next.",
  },
  {
    q: "Why not just use a card with limits?",
    a: "Cards stop at a spending limit and a merchant category. Most theft against businesses and agents is small and looks routine: a lookalike address, changed payout details, a duplicate invoice, an instruction planted in a web page. Veto reads the evidence behind each payment, works across chains and assets, and leaves a public, checkable record of every decision.",
  },
  {
    q: "Why NEAR?",
    a: "Three things in one place: NEAR AI Cloud runs models inside TEEs and signs every answer, NEAR Intents pays out on almost any chain from one balance, and NEAR's account model lets each key do one narrow job (the agent can only propose, the guardian can only record verdicts and settle payments).",
  },
  {
    q: "Who pays for gas?",
    a: "Each account pays for its own calls: the agent for proposing, the guardian for submitting verdicts, the owner for owner actions. On testnet that's free test NEAR from the faucet.",
  },
];

export function DocsView() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const listRef = useRef<HTMLOListElement>(null);

  // On phones the contents are a scrolling row of chips; keep the current one in view.
  useEffect(() => {
    const list = listRef.current;
    const chip = list?.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`);
    if (!list || !chip || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: chip.offsetLeft - list.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }, [active]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      <SmoothScroll />
      <RevealOnScroll />


      <div className={styles.layout}>
        <nav aria-label="On this page" className={styles.toc}>
          <span className={styles.tocTitle}>On this page</span>
          <ol ref={listRef}>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className={active === s.id ? styles.tocActive : undefined} aria-current={active === s.id ? "location" : undefined}>
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className={styles.content}>
          <section id="what" className={styles.hero}>
            <span className={styles.eyebrow}>Docs</span>
            <LineReveal as="h1" className={styles.h1} lines={["A second signer", "that can only say no."]} />
            <p className={styles.summary}>
              Veto is a vault for money that AI agents spend. Every payment an agent asks for has to pass two checks before it leaves:
              hard limits enforced by a NEAR smart contract, and a private AI screen running inside a secure enclave on NEAR AI Cloud. The
              AI can block a payment. It can never approve more than the limits allow.
            </p>
            <div className={styles.circuitCard}>
              <Circuit ai="veto" paid={false} delay={0.4} />
              <p>A payment inside the limit, stopped by the AI screen before it reaches a lookalike address.</p>
            </div>
          </section>

          <section id="problem" className={styles.section} data-reveal>
            <h2>Why spending limits aren't enough</h2>
            <p>
              Agents can now pay invoices, buy services and move funds. The usual safeguard is a policy: a spending limit and an allowlist of
              payees. Caps and allowlists stop strangers. The theft that actually happens to businesses is small, looks routine, and often
              pays someone already on the list:
            </p>
            <ul className={styles.bullets}>
              <li><strong>Lookalike addresses.</strong> An address that shares its first and last characters with a supplier's, so both look the same when shortened.</li>
              <li><strong>Changed payout details.</strong> An email from a lookalike domain says the supplier's wallet has changed.</li>
              <li><strong>Planted instructions.</strong> A web page or document the agent reads tells it to send money somewhere.</li>
              <li><strong>Duplicate invoices.</strong> A reminder for an invoice that was already paid, to the supplier's real address.</li>
              <li><strong>Padded amounts.</strong> A listed supplier paid more than the invoice says.</li>
            </ul>
            <p>
              Every one of these fits inside a normal weekly limit. On <Link href="/bench">Veto Bench</Link>, a plain policy (allowlist plus a
              per-payment cap) lets 17 of 50 attacks through, every one to a listed supplier, and blocks 8 honest payments to new suppliers
              the mandate allowed. Veto's screen, running in NEAR AI's enclave, catches all 50, including every one a plain policy lets
              through.
            </p>
          </section>

          <section id="flow" className={styles.section} data-reveal>
            <h2>How a payment flows</h2>
            <ol className={styles.steps}>
              <li>
                <strong>The agent proposes.</strong> It calls <code>propose</code> on the vault with the payee, amount and invoice number,
                and sends the evidence behind it (the email, the invoice) privately to the guardian. Only a hash of that evidence goes on-chain.
              </li>
              <li>
                <strong>The contract checks the hard limits.</strong> Per-payment and weekly caps, listed assets, agent allowed, vault not
                frozen. Anything over a cap is refused right here.
              </li>
              <li>
                <strong>The guardian screens it privately.</strong> It sends the mandate, the payee list, recent payments, deterministic risk
                signals (lookalike, new payee, duplicate) and the evidence to a model running in a TEE on NEAR AI Cloud. The model answers PASS
                or VETO with reason codes, and the enclave signs the exact request and response.
              </li>
              <li>
                <strong>The contract checks the verdict.</strong> It recovers the signer with <code>ecrecover</code>, checks it is an approved
                model key, checks the response names this exact proposal, then records the verdict.
              </li>
              <li>
                <strong>PASS pays, VETO blocks.</strong> A pass is re-checked against the caps and paid. A veto stays blocked unless the owner
                overrides it, which waits for a delay and can be cancelled. No verdict before the deadline means the payment expires.
              </li>
            </ol>
          </section>

          <section id="rule" className={styles.section} data-reveal>
            <h2>The rule: the AI can only say no</h2>
            <p>
              The design keeps the AI out of the decision to move money. It can only add a no. That way an AI mistake can never cost more than
              the limits you already accepted.
            </p>
            <div className={styles.twoCol}>
              <div className={styles.tile}>
                <h3>What you rely on</h3>
                <ul>
                  <li>The vault contract, which is public and tested.</li>
                  <li>The guardian service to send honest context to the model.</li>
                  <li>NEAR AI Cloud's TEE hardware for privacy and signatures.</li>
                </ul>
              </div>
              <div className={styles.tile}>
                <h3>What can't hurt you</h3>
                <ul>
                  <li>A tricked or compromised agent: it can only propose.</li>
                  <li>A forged verdict: the contract rejects unapproved signers.</li>
                  <li>A wrong PASS: still capped. A wrong VETO: one override.</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="proof" className={styles.section} data-reveal>
            <h2>How anyone can check a decision</h2>
            <p>Every verdict on the vault records the model, the signer, the chat id and the hashes of what the model saw and said. To check one:</p>
            <ol className={styles.steps}>
              <li>Open the decision's <strong>Proof</strong> page in the app, or read it from the contract with <code>get_proposal</code>.</li>
              <li>The signer is the model's key, published in NEAR AI Cloud's attestation report and backed by an Intel TDX quote. The vault approved that key before any verdict.</li>
              <li>The signature covers <code>model:sha256(request):sha256(response)</code>. The owner keeps the request bytes, so the exact prompt can be shown to an auditor and re-hashed.</li>
              <li>NEAR AI's own verifier confirms the signature independently, and Veto Bench results can be re-checked offline with <code>node bench/verify.ts</code>.</li>
            </ol>
            <p className={styles.note}>
              What this proves: the verdict came from that model inside a genuine enclave. It doesn't prove the model judged correctly, which is why the AI can only say no.
            </p>
          </section>

          <section id="cross-chain" className={styles.section} data-reveal>
            <h2>Paying suppliers on other chains</h2>
            <p>
              Suppliers hold USDC on many chains. The vault sits on NEAR and pays out through NEAR Intents: the owner sets a route (for example
              "base: USDC on NEAR to USDC on Base, fee at most 1%"), and when a cross-chain payment passes the screen the guardian brings a
              1Click quote for exactly that amount to exactly that address.
            </p>
            <p>
              The vault checks 1Click's ed25519 signature on the quote itself and confirms it pays the screened payee, on the screened chain,
              for the screened amount, refunds only to the vault and stays under the fee cap. The caps count what actually leaves the vault,
              fees included. Then it sends the deposit. A doctored quote is refused on-chain.
            </p>
            <h3 className={styles.h3}>Or from the vault's own address</h3>
            <p>
              The vault can also hold its own address on an EVM chain through NEAR Chain Signatures. When a payment to a Base supplier
              passes, the vault builds the transfer itself: exactly the screened payee and amount, gas under the owner's cap. Then it asks
              NEAR's MPC network to sign that transaction's hash. The guardian only broadcasts the signed bytes and reports the hash, so the
              vault's Base address can never send anything that didn't pass both gates.
            </p>
          </section>

          <section id="outlayer" className={styles.section} data-reveal>
            <h2>Agent wallets on OutLayer</h2>
            <p>
              Some agents don't pay from a vault at all. They hold an OutLayer wallet: keys inside a TEE, with an owner policy that can require
              approvals. Veto plugs in as one of those approvers, so the same screen covers a wallet it doesn't hold.
            </p>
            <ol className={styles.steps}>
              <li>
                <strong>The agent asks its wallet to pay.</strong> The wallet's policy needs an approval, so OutLayer holds the payment and
                returns an approval id. The agent hands that id and its evidence to the guardian.
              </li>
              <li>
                <strong>The vault records it.</strong> The guardian reads the held operation, checks OutLayer's hash of it, and records the
                payment on your vault with <code>propose_external</code>. Your caps apply exactly as they do to vault payments.
              </li>
              <li>
                <strong>It is screened and checked on-chain.</strong> The model screens it privately, and the vault checks the signed verdict.
                The OutLayer approval id and operation hash are part of the proposal hash the model must echo.
              </li>
              <li>
                <strong>Veto votes only after a pass.</strong> If the vault passes it, the guardian signs a yes on OutLayer and the wallet sends
                it. The guardian then checks that transaction on NEAR, and only then marks it paid. On a veto Veto never votes, so the
                wallet keeps holding it.
              </li>
            </ol>
            <p className={styles.note}>
              The owner is a second approver on the wallet. An override on the vault waits out the same delay, then Veto votes yes; the owner
              can also approve on OutLayer directly. Keeping the veto rejects it on OutLayer right away; an approval nobody signs
              expires after 24 hours.
            </p>
          </section>

          <section id="agent-api" className={styles.section} data-reveal>
            <h2>NEAR Intents Agent API wallets</h2>
            <p>
              The NEAR Intents Agent API gives an AI agent its own account on NEAR Intents. The owner signs one policy, which is the hard
              limit: which actions, which assets, how much, and where money may go. Whoever is allowed to spend holds a grant.
            </p>
            <ol className={styles.steps}>
              <li>
                <strong>Veto holds the only grant.</strong> The AI agent has none, so it can't move money. It can only ask Veto.
              </li>
              <li>
                <strong>Veto screens the request.</strong> The same enclave model reads the agent's evidence against the mandate and the
                business's payment history, and Veto requires the verdict to be signed by a key the vault approves.
              </li>
              <li>
                <strong>Only a pass is sent.</strong> A supplier on NEAR gets a transfer; a salary is a withdrawal that NEAR Intents pays out
                on the chain the worker chose, Base in the demo. Veto calls the API with its grant, under an idempotency key tied to that
                screening, so a retry can never send twice. A veto never reaches the API.
              </li>
              <li>
                <strong>The owner&apos;s policy still decides.</strong> Even after a pass, the API refuses anything the policy doesn&apos;t
                allow: an unlisted payee, more than the per-payment or daily limit, or a frozen account. The demo&apos;s policy allows
                withdrawals only to Tunde Bello&apos;s saved Base address, so a &ldquo;new wallet&rdquo; would be refused there even if the screen
                missed it.
              </li>
            </ol>
            <p className={styles.note}>
              The demo&apos;s account lives on mainnet and holds a few real dollars, so the inbox&apos;s amounts are scaled 1:100 on this path. The
              sandbox vault is on testnet, so these decisions aren&apos;t recorded on it; the enclave&apos;s signed verdict and the API&apos;s own
              operation record are the trail.
            </p>
          </section>

          <section id="privacy" className={styles.section} data-reveal>
            <h2>What stays private</h2>
            <div className={styles.twoCol}>
              <div className={styles.tile}>
                <h3>Private</h3>
                <ul>
                  <li>The emails, invoices and pages the agent acted on. Only the guardian that sends them to the model, and the model in its enclave, read them.</li>
                  <li>The full prompt the model saw.</li>
                  <li>Inference runs in a TEE: NEAR AI&apos;s hosts can&apos;t read it.</li>
                </ul>
              </div>
              <div className={styles.tile}>
                <h3>Public on-chain</h3>
                <ul>
                  <li>The payment itself: payee, amount, invoice number.</li>
                  <li>The verdict, reason codes and signatures.</li>
                  <li>Hashes of the evidence and the prompt.</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="try" className={styles.section} data-reveal>
            <h2>Try it on testnet</h2>
            <p>
              The live demo is at <a href="https://veto-beta.vercel.app/app">veto-beta.vercel.app</a>, with nothing to install. The shared sandbox is <a href={`${EXPLORER}/address/${VAULT_ID}`} target="_blank" rel="noreferrer" className={styles.mono}>{VAULT_ID}</a>,
              a made-up business called Lagoon Goods that holds test USDC and pays two suppliers and a member of staff. Anyone can act as its owner. For a vault only you control, start with step 1.
            </p>
            <ol className={styles.doSee}>
              <li><span>Do</span> open <Link href="/start/vault">Create your vault</Link>, connect a NEAR testnet wallet (Meteor Wallet at meteorwallet.app makes a testnet account for free; switch it to testnet first), name your business and sign. A new wallet starts with no NEAR, so Veto sends it 0.3 test NEAR for gas when it connects. <span>See</span> your own vault live in a few seconds, with $5,000 test USDC, two suppliers and its own test agent. From here on, overrides, freezes and rule changes need your wallet&apos;s signature.</li>
              <li><span>Do</span> open <Link href="/app">the app</Link> and press <strong>Try it</strong> (the green V on a phone, <strong>Try the agent</strong> at the top of the sidebar on desktop). <span>See</span> the agent's inbox: a real invoice, a real salary and four scams that look ordinary.</li>
              <li><span>Do</span> let the agent pay the real Kano Cotton Mills invoice. <span>See</span> "Agent proposed", "Screening privately", then <strong>Paid</strong>, with testnet transaction links.</li>
              <li><span>Do</span> let it pay "Updated payment details". <span>See</span> <strong>Vetoed</strong>: a lookalike address, a new payee and changed payout details, while the payment was inside the weekly limit.</li>
              <li><span>Do</span> open the decision, then <strong>Proof</strong>. <span>See</span> the signer, the hashes and the on-chain check.</li>
              <li><span>Do</span> press <strong>Override</strong> (your wallet signs it in your own vault; in the sandbox anyone can). <span>See</span> a countdown; the override pays only after the delay and can be cancelled.</li>
              <li><span>Do</span> in the sandbox, switch <strong>Pay from</strong> to <strong>OutLayer wallet</strong> and repeat. <span>See</span> the paid invoice approved by Veto on OutLayer and sent by the wallet; the scam stays held, and <strong>Keep it blocked</strong> rejects it there for good.</li>
              <li><span>Do</span> press <strong>Write your own email</strong> and write the agent an invoice, or a scam. <span>See</span> a real AI agent on NEAR AI read it and propose whatever it asks for, then Veto screen that payment like any other.</li>
              <li><span>Do</span> in the sandbox, let the agent pay <strong>Tunde Bello&apos;s salary</strong>. <span>See</span> <strong>Paid</strong> on Base, the chain Tunde chose, sent from the vault&apos;s own Base Sepolia address with NEAR Chain Signatures, with a Base explorer link.</li>
              <li><span>Do</span> let it pay <strong>&ldquo;New wallet for my salary&rdquo;</strong>. <span>See</span> <strong>Vetoed</strong>: the address imitates Tunde&apos;s saved one, it has never been paid, and the request came from outside the company.</li>
            </ol>
            <p className={styles.note}>
              Every verdict is signed by Qwen3-VL-30B inside NEAR AI's enclave. If NEAR AI can't answer, the sandbox's labelled test key signs instead;
              the decision's Proof page always shows which key signed it. Vaults you create trust only the enclave key, so without an answer the payment expires unpaid.
            </p>
          </section>

          <section id="developers" className={styles.section} data-reveal>
            <h2>For developers</h2>
            <p>An agent connects with a key that can only call <code>propose</code>:</p>
            <pre className={styles.code}>
              <code>{`import { Veto, toUnits } from "@veto/sdk";

const veto = new Veto({
  vaultId: "${VAULT_ID}",
  agentAccountId: "buyer.<your-account>.testnet",
  agentKey: process.env.AGENT_KEY,      // a propose-only key
  guardianUrl: "http://localhost:8799",
});

const { id } = await veto.propose({
  payee: "kano-cotton.<your-account>.testnet",
  asset: "usdc.<your-account>.testnet",
  amount: toUnits("180", 6),
  memo: "INV-2290",
  evidence: { source: "email", body: "…" },  // stays off-chain
});

const decision = await veto.decision(id); // Paid, Vetoed, Expired…`}</code>
            </pre>
            <h3 className={styles.h3}>Contract methods</h3>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Method</th>
                    <th scope="col">Who</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {METHODS.map((m) => (
                    <tr key={m.method}>
                      <td className={styles.mono}>{m.method}</td>
                      <td>{m.who}</td>
                      <td>{m.does}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className={styles.h3}>Run it yourself</h3>
            <pre className={styles.code}>
              <code>{`pnpm install
pnpm test                         # core, contract and factory tests
pnpm build:contracts              # the contracts, as wasm
node scripts/check-deployed.ts    # the code on testnet is exactly this build
node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested
pnpm build && pnpm start          # the app on http://localhost:3000, reading the live sandbox
pnpm demo:setup                   # optional: your own testnet sandbox from the faucet (see the README)`}</code>
            </pre>
          </section>

          <section id="near" className={styles.section} data-reveal>
            <h2>Built on NEAR</h2>
            <ul className={styles.bullets}>
              <li><strong>NEAR AI Cloud.</strong> Models in TEEs (Intel TDX and NVIDIA confidential GPUs) that sign every answer; the vault checks that signature on-chain.</li>
              <li><strong>NEAR Intents (1Click).</strong> Pays suppliers on other chains; the vault verifies the signed quote before sending.</li>
              <li><strong>Access keys.</strong> Function-call keys limited to one vault and a few methods: the agent can only propose, the guardian can only record verdicts and settle payments.</li>
              <li><strong>Global contracts.</strong> The vault code is deployed once (NEP-591); every vault the factory creates runs it by hash and stores only its own state.</li>
              <li><strong>Named accounts and sub-accounts.</strong> <code>treasury.</code>, <code>buyer.</code>, <code>guardian.</code> under one owner account, so roles are readable on-chain.</li>
              <li><strong>NEP-141 tokens and contract events.</strong> USDC payments, with every decision emitted as a NEP-297 event.</li>
            </ul>
          </section>

          <section id="status" className={styles.section} data-reveal>
            <h2>What works today</h2>
            <ul className={styles.status}>
              {STATUS.map((s) => (
                <li key={s.part}>
                  <span className={`${styles.badge} ${styles[s.status]}`}>{STATUS_TEXT[s.status]}</span>
                  <div>
                    <strong>{s.part}</strong>
                    <p>{s.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section id="faq" className={styles.section} data-reveal>
            <h2>Questions</h2>
            <div className={styles.faq}>
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
