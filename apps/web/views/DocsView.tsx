"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EXPLORER, SANDBOX_ID as VAULT_ID } from "@/lib/config";
import { Circuit } from "@/components/Circuit";
import { LineReveal } from "@/components/LineReveal";
import { SmoothScroll } from "@/components/SmoothScroll";
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

/** Everything is live on testnet unless it says otherwise, so only the exceptions carry a badge. */
type Status = "live" | "mainnet" | "built";
const STATUS_TEXT: Record<Exclude<Status, "live">, string> = { mainnet: "Live on mainnet", built: "Built and tested" };

const STATUS: { part: string; status: Status; note: string }[] = [
  { part: "Vault contract: caps, verdict check, overrides, freeze", status: "live", note: "61 contract tests; deployed on NEAR testnet." },
  { part: "Checked screening", status: "live", note: "The vault writes the screening facts from its own state, checks the evidence against the hash the agent committed, and rebuilds the exact request around its pinned prompt; the enclave's signature must cover those bytes. On in the sandbox and every new vault." },
  { part: "Your own vault, owned by your wallet", status: "live", note: "A factory creates a vault for any NEAR testnet account in one transaction its wallet signs. The vault code is deployed once as a NEAR global contract, so each new vault stores only its own state (about 1.6 KB). Its agent and screening accounts are its own too, each holding one key that can only call that vault. Every owner action is signed by the owner's wallet." },
  { part: "OutLayer agent wallets", status: "live", note: "Veto is an approver on an OutLayer wallet's policy. Pass, veto and override all run on testnet, settled against the wallet's real transactions." },
  { part: "NEAR Intents Agent API wallet", status: "mainnet", note: "An agent account on mainnet whose owner-signed policy is the hard limit. Veto holds its only grant, screens each request with the same enclave model, and sends only a pass: a transfer to a supplier, or a salary withdrawn to the worker's address on Base. Each payment is a few cents of real USDC, and runs while the wallet holds some." },
  { part: "Payroll: staff paid on the chain they chose", status: "live", note: "Staff sit on the payee list with their own wallet and chain. The sandbox pays a salary in test ETH on Base from the vault's Chain Signatures address and vetoes a fake request to send it to a new wallet." },
  { part: "Agent inbox and guardian screening", status: "live", note: "Real proposals and verdicts on testnet, screened by Qwen3-VL-30B inside NEAR AI's enclave. The sandbox trusts only the enclave key, like every vault you create: if NEAR AI can't answer, the payment expires unpaid." },
  { part: "Owner actions in the app", status: "live", note: "In your own vault, only your wallet. In the shared sandbox, a demo-owner key limited to the owner methods, so anyone can try it without a wallet. The sandbox goes back to its default rules for each new visitor." },
  { part: "Private AI screen on NEAR AI Cloud", status: "live", note: "Qwen3-VL-30B runs in an Intel TDX enclave on NEAR AI Cloud and signs each verdict in about 1.3 s (the Bench median). The vault checks the signature on-chain against the model's attested key." },
  { part: "Enclave verification", status: "live", note: "Every Proof page re-checks NEAR AI's enclave live with a fresh nonce: Intel's TDX quote, NVIDIA's GPU evidence, the key and nonce bound into the quote, the app it runs, the gateway, and that the attested key signed the verdict. Tested offline on a captured real quote." },
  { part: "Activity export", status: "live", note: "Download CSV gives one row per payment, ready for an accountant: date, payee, amount, status, reference, verdict and reasons, payout transaction and a link to its proof." },
  { part: "Paying suppliers on other chains (NEAR Intents)", status: "mainnet", note: "The vault verifies 1Click's signed quote on-chain before it pays. On 12 Nov 2026 the mainnet vault treasury.veto-mainnet.near paid its first invoice this way: $2.00 to a supplier on Base, paid in USDC, which 1Click delivered in full." },
  { part: "Veto Bench", status: "live", note: "100 scenarios. Qwen3-VL-30B catches 50 of 50 attacks and pays all 42 honest payments to saved suppliers; the 8 first payments to new suppliers wait for the owner, as they do on an allowlist. All 100 signatures re-verify offline. Plain-policy and rules-only baselines are published beside it." },
  { part: "Shield incident check before cross-chain payouts", status: "built", note: "Holds a payout while a NEAR Intents Shield incident touches its chain, bridge, token or payee; fails closed if it outlasts the deadline. Runs when the Shield key is added." },
  { part: "The vault's own Base address via Chain Signatures", status: "live", note: "The vault builds each passed transfer and NEAR's MPC network signs exactly that; the contract tests include byte-for-byte checks against ethers." },
];

const METHODS: { method: string; who: string; does: string }[] = [
  { method: "factory: create_vault(name, label, mandate?)", who: "Anyone", does: "Creates <name>.<factory>, owned by the caller, with starter test funds, caps, suppliers and the enclave model's key, plus its own agent and screening accounts, holding the hosted app's agent and guardian keys as function-call keys that can only call this vault." },
  { method: "factory: send_gas(account)", who: "The factory's own key", does: "Sends an empty testnet wallet 0.3 test NEAR for gas, once per wallet. The web app holds a key that can call only this, and calls it when an empty wallet connects." },
  { method: "propose(request, context_hash)", who: "Agent", does: "Asks to pay. Checked against the caps at once; then waits for the screen." },
  { method: "submit_verdict(id, model_id, chat_id, evidence | request_hash, response, signature, quote?, evm?)", who: "Guardian", does: "Records the signed verdict. With checked screening the guardian sends the evidence and the vault rebuilds the exact request the signature must cover; with private screening, the request's hash. PASS pays if the caps still allow it; VETO blocks." },
  { method: "get_screening_facts(id)", who: "Anyone (view)", does: "The facts a checked screening must show the model, written by the vault from its own state: the payment, mandate, payee list, newest payments and risk signals." },
  { method: "set_checked_screening(checked)", who: "Owner", does: "Checked screening (the default) puts the evidence on-chain with each verdict and lets the vault rebuild the request. Private screening keeps the evidence off-chain." },
  { method: "load_decimals(asset)", who: "Anyone", does: "Reads a token's decimals from the token, so the vault writes amounts the way the model reads them. Runs by itself when a token gets a policy." },
  { method: "expire(id)", who: "Anyone", does: "Ends a screening with no verdict after the deadline. No verdict means no payment." },
  { method: "override_veto(id) / cancel_override(id)", who: "Owner", does: "Schedules a vetoed payment to pay after the delay, or cancels that." },
  { method: "keep_blocked(id)", who: "Owner", does: "Closes a veto for good. For an OutLayer wallet, Veto then rejects the held payment there." },
  { method: "execute_override(id, quote?)", who: "Anyone", does: "Pays an override once its delay has passed. Still inside the caps." },
  { method: "freeze() / unfreeze()", who: "Owner", does: "Stops every payment and cancels pending overrides." },
  { method: "set_policy(asset, policy)", who: "Owner", does: "Lowering a limit applies now; raising one waits for the raise delay." },
  { method: "set_mandate, add_payee, remove_payee, add_agent, set_agent_active", who: "Owner", does: "What the agent may do, in plain words and as lists." },
  { method: "add_signer(address, model_id)", who: "Owner", does: "Approves a model's signing key. Check its TEE attestation first (every Proof page and verify.ts --attested do it); the contract itself doesn't." },
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
    a: "Real, on NEAR testnet. Every vault is a deployed contract, every payment is a testnet transaction you can open on NearBlocks, and every verdict's signature is checked by the contract against a key the owner approved: NEAR AI's enclave key, the only one the sandbox and your vaults trust. The tokens are test tokens. The shared sandbox lets anyone act as its owner so it can be tried without a wallet, and goes back to its default rules for each new visitor; a vault you create belongs to your wallet, and nothing changes its rules without your signature.",
  },
  {
    q: "Where do the payment requests come from?",
    a: "From what the agent reads. The inbox holds example emails (two suppliers' invoices and a salary, all genuine, and four common scams), and Write your own email sends the agent anything you type: a real model on NEAR AI reads it and proposes whatever it asks for, the way an accounts-payable agent would. The agent also has a real inbox, veto-agent@agentmail.to: mail it from your own account and it replies with Veto's decision, with the sender's SPF, DKIM and DMARC results in the evidence. In production that is the business's own inbox, a supplier portal or a web page. Veto never trusts the request; it screens the payment against the evidence.",
  },
  {
    q: "Which model screens the payments?",
    a: "Qwen3-VL-30B-A3B-Instruct, hosted by NEAR AI Cloud inside an Intel TDX enclave. It answers directly without a reasoning phase, so a verdict takes about 1.3 seconds (the Bench median) and always arrives in full. The owner approves a model by its attested signing key (add_signer), so any other enclave-hosted model can be used instead; Veto Bench compares them on the same 100 scenarios.",
  },
  {
    q: "What if the AI gets it wrong?",
    a: "If it misses an attack, the payment is still inside the hard caps, so you're no worse off than with a plain spending limit. If it blocks a good payment, the owner overrides it; the override waits for a delay and can be cancelled. The AI never decides alone that money should move.",
  },
  {
    q: "What if the screening service is compromised?",
    a: "The vault only accepts verdicts from the registered guardian account, signed by an approved model key, echoing this exact proposal. A compromised guardian still can't pay more than the caps allow, can't change payees or limits, and can't move money anywhere the agent didn't propose. The guardian does choose the evidence the model reads: the enclave proves which model judged which input. It can't prove the input was the real email. In this demo one server runs both the demo agent and the guardian, so it holds both roles and could propose and pass a payment to any address inside the caps; an owner can close that by requiring listed payees on-chain (set_require_listed_payee). Running the guardian itself inside a TEE is the next step that removes this trust.",
  },
  {
    q: "How is this different from a policy wallet?",
    a: "A policy wallet enforces caps and an allowlist, and Veto's contract does the same. Those rules stop payments to strangers. They can't stop a payment to a listed supplier for an invoice that was already paid, or for more than was billed, and a strict allowlist blocks every new supplier. Veto adds a private screen that reads the evidence behind each payment and can only say no, so the two work together. On an OutLayer wallet that is literal: Veto is an approver on the wallet's policy.",
  },
  {
    q: "Can it run payroll?",
    a: "Yes. Staff go on the payee list with the wallet and chain each one chose, and the agent pays salaries like any other payment: inside the caps, screened privately. In the sandbox, Tunde Bello is paid in test ETH on Base from the vault's own address, signed by NEAR's MPC network; on the Agent API path, the salary is USDC withdrawn through NEAR Intents and paid out on Base, to the one address the owner's policy allows for Tunde, once the demo wallet holds USDC. The most common payroll scam, an email asking to send someone's salary to a new wallet, is vetoed: the address is new and imitates the saved one.",
  },
  {
    q: "Can Veto guard a swarm of agents?",
    a: "Yes. A vault takes any number of agents (the sandbox runs one), each with its own key that can only propose a payment, and the owner can pause one without stopping the rest. Agents running in OutLayer TEE wallets or NEAR Intents Agent API wallets go through the same gate: every payment from any of them gets the same private AI review. Agents on the vault and OutLayer wallets also meet the vault's contract caps; an Agent API wallet meets its owner's signed policy instead. Separate budgets for each agent are next.",
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

/** "Try it on testnet": what to do, then what you'll see. A sequence, so it's numbered. */
const TRY: { act: ReactNode; see: ReactNode }[] = [
  {
    act: (
      <>
        Open <Link href="/start/vault">Create your vault</Link>, connect a NEAR testnet wallet, name your business and sign. Meteor Wallet
        (meteorwallet.app) makes a free testnet account; switch it to testnet first. A new wallet has no NEAR, so Veto sends it 0.3 test
        NEAR for gas when it connects.
      </>
    ),
    see: (
      <>
        Your own vault goes live in a few seconds, with $5,000 in test USDC, two suppliers and its own test agent. From then on, overrides,
        freezes and rule changes need your wallet&apos;s signature.
      </>
    ),
  },
  {
    act: (
      <>
        Open <Link href="/app">the app</Link> and press <strong>Try it</strong>: the green V on a phone, or <strong>Try the agent</strong> at
        the top of the sidebar on a desktop.
      </>
    ),
    see: <>The agent&apos;s inbox: two suppliers&apos; invoices and a salary, all genuine, and four scams that look ordinary.</>,
  },
  {
    act: <>Let the agent pay the Kano Cotton Mills invoice.</>,
    see: (
      <>
        &ldquo;Agent proposed the payment&rdquo;, &ldquo;Screening in the enclave&rdquo;, then <strong>Paid</strong>, with testnet
        transaction links.
      </>
    ),
  },
  {
    act: <>Let it pay &ldquo;Updated payment details&rdquo;.</>,
    see: (
      <>
        <strong>Vetoed</strong>: a lookalike address, a new payee and changed payout details, though the payment was inside the weekly
        limit.
      </>
    ),
  },
  {
    act: (
      <>
        Open the decision, then <strong>Proof</strong>.
      </>
    ),
    see: <>The signer, the hashes and the on-chain check, then the exact bytes the model saw, re-hashed in your browser.</>,
  },
  {
    act: (
      <>
        On that page, press <strong>Check the enclave now</strong>.
      </>
    ),
    see: <>Eight live checks of NEAR AI&apos;s enclave, among them Intel&apos;s quote, NVIDIA&apos;s GPUs and the key that signed the verdict.</>,
  },
  {
    act: (
      <>
        Open <strong>Activity</strong> and press <strong>Download CSV</strong>.
      </>
    ),
    see: (
      <>
        One row per payment, ready for an accountant: date, payee, amount, status, reference, verdict and reasons, the payout transaction
        and a link to its proof.
      </>
    ),
  },
  {
    act: (
      <>
        On a vetoed payment, press <strong>Override</strong>. In your own vault your wallet signs it; in the sandbox anyone can.
      </>
    ),
    see: <>A countdown. The override pays only after the delay, and you can cancel it until then.</>,
  },
  {
    act: (
      <>
        In the sandbox, switch <strong>Pay from</strong> to <strong>OutLayer</strong> and repeat.
      </>
    ),
    see: (
      <>
        The invoice approved by Veto on OutLayer and sent by the wallet. The scam stays held, and <strong>Keep it blocked</strong> rejects
        it there for good.
      </>
    ),
  },
  {
    act: (
      <>
        Press <strong>Write your own email</strong> and write the agent an invoice, or a scam.
      </>
    ),
    see: <>A real AI agent on NEAR AI reads it and proposes whatever it asks for. Veto then screens that payment like any other.</>,
  },
  {
    act: (
      <>
        In the sandbox, let the agent pay <strong>Tunde Bello&apos;s salary</strong>.
      </>
    ),
    see: (
      <>
        <strong>Paid</strong> on Base, the chain Tunde chose, from the vault&apos;s own Base Sepolia address through NEAR Chain Signatures,
        with a Base explorer link. It pays once a month: a second request for the same payslip is vetoed as a repeat.
      </>
    ),
  },
  {
    act: (
      <>
        Let it pay <strong>&ldquo;New wallet for my salary&rdquo;</strong>.
      </>
    ),
    see: (
      <>
        <strong>Vetoed</strong>: the address imitates Tunde&apos;s saved one, it has never been paid, and the request came from outside the
        company.
      </>
    ),
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
            <LineReveal as="h1" className={styles.h1} lines={["A second signer", "that can only", "say no."]} />
            <p className={`${styles.summary} rise`} style={{ animationDelay: "120ms" }}>
              Veto is a vault for money that AI agents spend. Every payment an agent asks for has to pass two checks before it leaves:
              hard limits enforced by a NEAR smart contract, and a private AI screen running inside a secure enclave on NEAR AI Cloud. The
              AI can block a payment. It can never approve more than the limits allow.
            </p>
            <figure className={`${styles.circuitCard} rise`} style={{ animationDelay: "200ms" }}>
              <Circuit ai="veto" paid={false} delay={500} />
              <figcaption>A payment inside the limit, stopped by the AI screen before it reaches a lookalike address.</figcaption>
            </figure>
          </section>

          <section id="problem" className={styles.section}>
            <h2>Why spending limits aren&apos;t enough</h2>
            <p>
              Agents can now pay invoices, buy services and move funds. The usual safeguard is a policy: a spending limit and an allowlist of
              payees. Caps and allowlists stop strangers. The theft that actually happens to businesses is small, looks routine, and often
              pays someone already on the list:
            </p>
            <ul className={styles.bullets}>
              <li><strong>Lookalike addresses.</strong> An address that shares its first and last characters with a supplier&apos;s, so both look the same when shortened.</li>
              <li><strong>Changed payout details.</strong> An email from a lookalike domain says the supplier&apos;s wallet has changed.</li>
              <li><strong>Planted instructions.</strong> A web page or document the agent reads tells it to send money somewhere.</li>
              <li><strong>Duplicate invoices.</strong> A reminder for an invoice that was already paid, to the supplier&apos;s real address.</li>
              <li><strong>Padded amounts.</strong> A listed supplier paid more than the invoice says.</li>
            </ul>
            <p>
              Every one of these fits inside a normal weekly limit. On <Link href="/bench">Veto Bench</Link>, a plain policy (an allowlist and
              a per-payment cap) lets 17 of 50 attacks through, every one to a listed supplier. Veto&apos;s screen, running in NEAR AI&apos;s
              enclave, catches all 50 and pays all 42 honest payments to saved suppliers. Both hold the 8 first payments to new suppliers
              for the owner to approve.
            </p>
          </section>

          <section id="flow" className={styles.section}>
            <h2>How a payment flows</h2>
            <ol className={styles.steps}>
              <li>
                <strong>The agent proposes.</strong> It calls <code>propose</code> on the vault with the payee, amount and invoice number,
                and sends the evidence behind it (the email, the invoice) to the guardian. Only a hash of that evidence goes on-chain at this
                point, so the agent is committed to it before anyone screens anything.
              </li>
              <li>
                <strong>The contract checks the hard limits.</strong> Per-payment and weekly caps, listed assets, agent allowed, vault not
                frozen. Anything over a cap is refused right here.
              </li>
              <li>
                <strong>The guardian screens it in the enclave.</strong> It asks the vault for the screening facts, which the vault writes from
                its own state (the rules, the payee list, recent payments and fixed risk signals: lookalike, new payee, duplicate), and sends
                them with the evidence to a model running in a TEE on NEAR AI Cloud. The model answers PASS or VETO with reason codes, and the
                enclave signs the exact request and response.
              </li>
              <li>
                <strong>The contract checks the verdict.</strong> With checked screening (the default) it rebuilds the request byte for byte:
                its pinned screening prompt, the facts written again from its own state, and the evidence, which must match the hash from step
                one. It recovers the signer of that request and the response with <code>ecrecover</code>, checks it is an approved model key,
                checks the response names this exact proposal, then records the verdict. So the guardian can&apos;t show the model a different
                email, rules or payee list: the signature wouldn&apos;t cover what the vault rebuilt.
              </li>
              <li>
                <strong>PASS pays, VETO blocks.</strong> A pass is re-checked against the caps and paid. A veto stays blocked unless the owner
                overrides it, which waits for a delay and can be cancelled. No verdict before the deadline means the payment expires.
              </li>
            </ol>
          </section>

          <section id="rule" className={styles.section}>
            <h2>The AI can only say no</h2>
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
                  <li>NEAR AI Cloud&apos;s TEE hardware for privacy and signatures.</li>
                </ul>
              </div>
              <div className={styles.tile}>
                <h3>What can&apos;t hurt you</h3>
                <ul>
                  <li>A tricked or compromised agent: it can only propose.</li>
                  <li>A forged verdict: the contract rejects unapproved signers.</li>
                  <li>A wrong PASS: still capped. A wrong VETO: one override.</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="proof" className={styles.section}>
            <h2>How anyone can check a decision</h2>
            <p>Every verdict on the vault records the model, the signer, the chat id and the hashes of what the model saw and said. To check one:</p>
            <ol className={styles.steps}>
              <li>Open the decision&apos;s <strong>Proof</strong> page in the app, or read it from the contract with <code>get_proposal</code>.</li>
              <li>The signer is the model&apos;s key, published in NEAR AI Cloud&apos;s attestation report and backed by an Intel TDX quote. The vault approved that key before any verdict.</li>
              <li>On the Proof page, <strong>Check the enclave now</strong> verifies that from scratch with a fresh random nonce: the TDX quote against Intel&apos;s certificates, the GPU evidence with NVIDIA&apos;s attestation service, that the quote binds the key and the nonce, the app the enclave runs, NEAR AI&apos;s gateway, and that the attested key signed this verdict. <code>node bench/verify.ts --attested</code> runs the same checks from a terminal.</li>
              <li>The signature covers <code>model:sha256(request):sha256(response)</code>. In the shared sandbox the exact request and response bytes are published, and the Proof page re-hashes them in your browser: they match what the enclave signed and the vault checked, and the email inside the request matches the hash the agent put on-chain before screening. A vault someone owns keeps them private; the standalone guardian (<code>services/guardian</code>) keeps them in a private audit record, so an owner can show the exact prompt to an auditor.</li>
              <li>NEAR AI&apos;s own verifier confirms the signature independently, and Veto Bench results can be re-checked offline with <code>node bench/verify.ts</code>.</li>
            </ol>
            <p className={styles.note}>
              What this proves: the verdict came from that model inside a genuine enclave. It can&apos;t prove the model judged correctly, which is why the AI can only say no.
            </p>
          </section>

          <section id="cross-chain" className={styles.section}>
            <h2>Paying suppliers on other chains</h2>
            <p>
              Suppliers hold USDC on many chains. The vault sits on NEAR and pays out through NEAR Intents: the owner sets a route (for example
              &ldquo;base: USDC on NEAR to USDC on Base, fee at most 1%&rdquo;), and when a cross-chain payment passes the screen the guardian brings a
              1Click quote for exactly that amount to exactly that address.
            </p>
            <p>
              The vault checks 1Click&apos;s ed25519 signature on the quote itself and confirms it pays the screened payee, on the screened chain,
              for the screened amount, refunds only to the vault and stays under the fee cap. The caps count what actually leaves the vault,
              fees included. Then it sends the deposit. A doctored quote is refused on-chain.
            </p>
            <p>
              This runs on mainnet. On 12 Nov 2026 the vault{" "}
              <a href="https://nearblocks.io/address/treasury.veto-mainnet.near" target="_blank" rel="noreferrer" className={styles.mono}>
                treasury.veto-mainnet.near
              </a>{" "}
              screened a $2.00 invoice from a supplier on Base, checked the request and 1Click&apos;s signed quote on-chain, and paid it in
              USDC. 1Click delivered exactly $2.00 on Base.
            </p>
            <h3 className={styles.h3}>Or from the vault&apos;s own address</h3>
            <p>
              The vault can also hold its own address on an EVM chain through NEAR Chain Signatures. When a payment to a Base supplier
              passes, the vault builds the transfer itself: exactly the screened payee and amount, gas under the owner&apos;s cap. Then it asks
              NEAR&apos;s MPC network to sign that transaction&apos;s hash. The guardian only broadcasts the signed bytes and reports the hash, so the
              vault&apos;s Base address can never send anything that didn&apos;t pass both gates.
            </p>
          </section>

          <section id="outlayer" className={styles.section}>
            <h2>Agent wallets on OutLayer</h2>
            <p>
              Some agents don&apos;t pay from a vault at all. They hold an OutLayer wallet: keys inside a TEE, with an owner policy that can require
              approvals. Veto plugs in as one of those approvers, so the same screen covers a wallet it doesn&apos;t hold.
            </p>
            <ol className={styles.steps}>
              <li>
                <strong>The agent asks its wallet to pay.</strong> The wallet&apos;s policy needs an approval, so OutLayer holds the payment and
                returns an approval id. The agent hands that id and its evidence to the guardian.
              </li>
              <li>
                <strong>The vault records it.</strong> The guardian reads the held operation, checks OutLayer&apos;s hash of it, and records the
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

          <section id="agent-api" className={styles.section}>
            <h2>NEAR Intents Agent API wallets</h2>
            <p>
              The NEAR Intents Agent API gives an AI agent its own account on NEAR Intents. The owner signs one policy, which is the hard
              limit: which actions, which assets, how much, and where money may go. Whoever is allowed to spend holds a grant.
            </p>
            <ol className={styles.steps}>
              <li>
                <strong>Veto holds the only grant.</strong> The AI agent has none, so it can&apos;t move money. It can only ask Veto.
              </li>
              <li>
                <strong>Veto screens the request.</strong> The same enclave model reads the agent&apos;s evidence against the owner&apos;s rules and
                the business&apos;s payment history, and Veto requires the verdict to be signed by a key the vault approves.
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
              The demo&apos;s account lives on mainnet and holds a few real dollars, so the inbox&apos;s amounts are scaled 1:2000 on this path: the
              examples that pass cost $0.09 and $0.075, and the owner&apos;s policy allows at most $0.10 a payment. The sandbox vault is on
              testnet, so these decisions aren&apos;t recorded on it; the enclave&apos;s signed verdict and the API&apos;s own operation record are the
              trail.
            </p>
          </section>

          <section id="privacy" className={styles.section}>
            <h2>What stays private</h2>
            <p>
              Each vault picks. Checking the whole request on-chain means putting the evidence on-chain, so the owner chooses which matters more
              with <code>set_checked_screening</code>. Either way inference runs in a TEE, so NEAR AI&apos;s hosts can&apos;t read it, and the payment
              itself (payee, amount, invoice number), the verdict, its reason codes and signatures are public.
            </p>
            <div className={styles.twoCol}>
              <div className={styles.tile}>
                <h3>Checked screening (default)</h3>
                <ul>
                  <li>The evidence goes on-chain with the verdict, and the vault rebuilds the exact request the model saw.</li>
                  <li>Nothing about the prompt is taken on trust: not the email, the rules, the payee list, the recent payments or the signals.</li>
                  <li>The sandbox and every vault the factory makes use it. Their emails are made up, or written by visitors who were told.</li>
                </ul>
              </div>
              <div className={styles.tile}>
                <h3>Private screening</h3>
                <ul>
                  <li>Only hashes of the evidence and the request go on-chain. The guardian and the model in its enclave read the evidence.</li>
                  <li>The vault checks the enclave&apos;s signature and that the answer names this payment. That the prompt was the right one rests on the guardian, and an owner can check it on the Proof page.</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="try" className={styles.section}>
            <h2>Try it on testnet</h2>
            <p>
              The live demo is at <a href="https://veto-beta.vercel.app/app">veto-beta.vercel.app</a>, with nothing to install. The shared
              sandbox is{" "}
              <a href={`${EXPLORER}/address/${VAULT_ID}`} target="_blank" rel="noreferrer" className={styles.mono}>
                {VAULT_ID}
              </a>
              , a made-up business called Lagoon Goods that holds test USDC and pays three suppliers (two on NEAR, one on Base) and a member
              of staff. Anyone can act as its owner, and it goes back to its default rules for each new visitor. For a vault only you control,
              start with step 1.
            </p>
            <ol className={`${styles.steps} ${styles.try}`}>
              {TRY.map((step, i) => (
                <li key={i}>
                  <p className={styles.tryAct}>{step.act}</p>
                  <p className={styles.trySee}>{step.see}</p>
                </li>
              ))}
            </ol>
            <p className={styles.note}>
              Verdicts are signed by Qwen3-VL-30B inside NEAR AI&apos;s enclave, and each decision&apos;s Proof page shows which key signed it (a few
              early sandbox decisions were signed by a labelled test key). The sandbox and the vaults you create trust only the enclave key, so
              without an answer the payment expires unpaid.
            </p>
          </section>

          <section id="developers" className={styles.section}>
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
            <p>Each method, who can call it, and what it does.</p>
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

          <section id="near" className={styles.section}>
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

          <section id="status" className={styles.section}>
            <h2>What works today</h2>
            <p>Everything here runs on NEAR testnet today, except where marked.</p>
            <ul className={styles.status}>
              {STATUS.map((s) => (
                <li key={s.part}>
                  <span className={styles.statusHead}>
                    <strong>{s.part}</strong>
                    {s.status !== "live" && <span className={`${styles.badge} ${styles[s.status]}`}>{STATUS_TEXT[s.status]}</span>}
                  </span>
                  <p>{s.note}</p>
                </li>
              ))}
            </ul>
          </section>

          <section id="faq" className={styles.section}>
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
