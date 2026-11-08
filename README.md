# Veto

A NEAR vault where every payment an AI agent makes needs a second signer that can only say no.

**The problem.** An agent that pays invoices reads email, and email can lie. A message from a lookalike domain, or from a supplier's real but hacked mailbox, asks for a "corrected" amount or a new account. Spending limits don't stop it when the amount is under the cap and the payee is already on the list: on [Veto Bench](bench/), a policy wallet with an allowlist and a cap pays 17 of 50 such attacks. Veto adds a check that reads the evidence behind each payment, inside an enclave, and can only say no.

**Contents:** [Check it yourself](#check-it-yourself-no-keys-no-funds) · [Try the hosted demo](#try-the-agent-on-the-hosted-demo) · [Run your own copy](#run-your-own-copy-on-testnet) · [With a NEAR AI key](#with-a-near-ai-key) · [Mainnet payout](#mainnet-a-real-payout-to-base-through-near-intents) · [How it works](#how-it-works) · [Status](#status) · [Layout](#layout) · [Built at NEAR HACKATHON](#built-at-near-hackathon). Judging? [JUDGES.md](JUDGES.md) is the short path.

**Live demo (NEAR testnet):** https://veto-beta.vercel.app. Open the app and press **Try it** in the shared sandbox, with nothing to install. Or connect a NEAR testnet wallet and create your own vault: one transaction, and from then on only your wallet can change its rules or override a veto.

Each payment has to pass two gates before money moves:

1. **Hard caps in the vault contract**: per-payment and per-week limits per asset.
2. **A private AI screen**: a model on NEAR AI Cloud reads the evidence behind the payment (the email, the invoice, the web page) inside a TEE and answers PASS or VETO. The enclave signs the exact request and response. The vault recovers that signature on-chain with `ecrecover` before it acts.

The AI can block a payment the caps would allow. It can never allow one the caps would block. The owner can override a veto, after a delay.

The same screen also covers agents that pay from an **OutLayer** wallet. Veto is an approver on the wallet's policy, so OutLayer holds each payment until Veto, or the owner, approves it.

It also covers a **NEAR Intents Agent API** wallet on mainnet. The owner's signed policy is the hard limit, and Veto holds the account's only grant, so the AI agent can only ask: Veto screens each request and sends just what passes.

The vault can also pay on **Base** from its own address there, through **NEAR Chain Signatures**. The vault builds each passed transfer itself, and NEAR's MPC network signs exactly that.

**Payroll** runs through the same gate. Staff sit on the payee list with the wallet and chain each one chose. In the sandbox the agent pays Tunde Bello's salary on Base, and Veto vetoes the scam payroll attracts most: an email asking to send the salary to a "new wallet".

**Many agents, one gate.** A vault takes any number of agents, each holding a key that can only propose, and the owner can pause any one of them without stopping the rest. Every agent's payment gets the same private AI review, whichever wallet it pays from: agents on the vault and OutLayer wallets also meet the vault's caps, and an Agent API wallet meets its owner's signed policy.

## Check it yourself (no keys, no funds)

Requires Node 24+, pnpm 11, Rust through rustup and about 3 GB of free disk (the Rust builds for the tests and the contracts take most of it). The repo's `rust-toolchain.toml` pins Rust 1.99.1 with the `wasm32-unknown-unknown` target; rustup installs both on first use (if yours doesn't, run `rustup toolchain install 1.99.1 --target wasm32-unknown-unknown`).

```sh
pnpm install
pnpm test
```

You should see `ℹ pass 16` (TypeScript core), `test result: ok. 48 passed` (vault contract) and `test result: ok. 9 passed` (vault factory). The core tests verify a real NEAR AI enclave quote offline against Intel's collateral (captured with it) and reject a tampered copy. The contract tests include a real executable 1Click quote and a real 1Click signature. They also pin the proposal hash that the TypeScript side must reproduce. A first run takes about four minutes on 8 cores: the contract and the factory are separate crates, so near-sdk's test dependencies compile twice.

```sh
node bench/run.ts --screener policy   # Attacks caught 33/50, normal payments blocked 8/50
node bench/run.ts --screener dev      # Attacks caught 41/50, normal payments blocked 8/50
node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested
```

[Veto Bench](bench/) has 100 payment scenarios: 50 attacks and 50 ordinary payments.

- `policy` is what a policy wallet enforces on its own: an allowlist plus a cap. Every attack it misses pays a supplier already on the list.
- `dev` is Veto's deterministic checks without a model.
- The committed run of Qwen3-VL-30B in NEAR AI's enclave catches 50 of 50 attacks and blocks 8 of 50 honest payments (all 8 are new suppliers whose approval sits inside the email). The scenarios and the screening prompt were written by the same team, so read this as a result on this set, not a general catch rate. `verify.ts` rehashes the stored request and response bytes of all 100 verdicts and recovers each signature. `--attested` then verifies NEAR AI's enclave from scratch, with a fresh random nonce and no key: the Intel TDX quote against Intel's certificates, the NVIDIA GPU evidence with NVIDIA's attestation service, that the quote binds the signing key and the nonce, that the enclave runs the app it publishes, the gateway's enclave, and that the attested key is the run's signer. Expect `100/100 verdicts verified` and eight ✓ lines (10 to 20 s; it calls Intel and NVIDIA).

The two bench runs write to `bench/runs/`, which git ignores, so the committed results in `bench/results/` stay untouched and `git status` stays clean. (`--publish` writes to `bench/results/` instead.)

```sh
pnpm build:contracts                # the vault, the factory and the test token, as wasm
node scripts/check-deployed.ts      # ✓ for each: the code running on testnet is exactly this build
```

`check-deployed.ts` hashes the wasm you just built and compares it with the code deployed for the live demo: the sandbox vault, the vault code every factory vault runs, the factory and the test token. It reads testnet only.

```sh
pnpm build && pnpm start            # http://localhost:3000
```

With no keys, the app reads the live sandbox vault on testnet: Home, Activity, every decision and its **Proof**, Rules, Agents, Docs and Bench all work. The agent's inbox needs the demo accounts that `pnpm demo:setup` creates, so locally it says so; the hosted demo has them.

## Try the agent on the hosted demo

https://veto-beta.vercel.app/app runs everything below with nothing to install. Press **Try it** (the green V on a phone; **Try the agent** at the top of the sidebar on desktop):

| Do | See |
| --- | --- |
| Let the agent pay **"Invoice INV-…: 72 bales of combed cotton"** | Agent proposed → Screening privately → **Paid**, with testnet tx links |
| Let it pay **"Updated payment details for INV-…"** | **Vetoed**: a lookalike of an address you've paid before. The coral card appears on Home |
| Let it pay **"Payroll PAY-…: … salary for Tunde Bello"** | **Paid** on Base, the chain Tunde chose, from the vault's own Base Sepolia address (NEAR Chain Signatures) |
| Let it pay **"New wallet for my salary"** | **Vetoed**: the address imitates Tunde's saved one and has never been paid |
| Open the vetoed decision → **Override** | A 3-minute countdown, then it pays (still inside the caps), unless you cancel |
| Switch **Pay from** to **OutLayer** and repeat the invoice and the scam | Paid: Veto approved it on OutLayer and the wallet sent it. Vetoed: Veto never signs, so OutLayer keeps holding it. **Keep it blocked** then rejects it there for good |
| Switch **Pay from** to **Agent API** and repeat them | The same screen, then a real call to the NEAR Intents Agent API on mainnet with Veto's grant: a transfer to a supplier, or Tunde's salary as USDC withdrawn to Base. Amounts are scaled 1:2000, so each payment is a few cents of real USDC (the two examples that pass cost $0.09 and $0.075). A veto never reaches the API; a payment the owner's policy forbids is refused there even after a pass. Whenever the wallet holds no USDC, a pass is refused there with `insufficient_balance` |
| Press **Write your own email** and write an invoice or a scam | A real AI agent on NEAR AI reads it and proposes what it asks for; Veto screens it like any other payment |
| Open any decision → **Proof** | The request and response hashes, the signer, and the on-chain signature check |
| On that page, press **Check the enclave now** | Eight checks of NEAR AI's enclave, run live with a fresh nonce: Intel TDX quote, NVIDIA GPUs, key and nonce bound into the quote, published app, gateway, and that the key is the one that signed this verdict |
| **Activity** → **Download CSV** | One row per payment: date, payee, amount, status, reference, verdict and reasons, payout transaction and a link to its proof |
| Open **/start**, connect a NEAR testnet wallet, name your business and sign | Your own vault, live in a few seconds. Its owner is your account, and every owner action needs your wallet. The shared sandbox, used above, lets anyone act as its owner |

Verdicts come from Qwen3-VL-30B inside NEAR AI's enclave. The sandbox and every vault created through the factory trust only the enclave key: with no answer, the payment expires unpaid. (Until 8 Nov 2026 the sandbox also trusted a labelled test key as a fallback; the 8 decisions it signed are labelled "test signer".) Anyone can act as the sandbox's owner, so it goes back to its default rules (unfrozen, the usual mandate and suppliers) for each new visitor.

The sandbox keeps the $500 per-payment cap the scam story relies on. Its weekly cap is raised to $50,000 so a busy week of visitors can't use it up (`node scripts/demo-health.ts --fix`); a vault you create starts at $500 a payment and $3,000 a week. Each visitor can start 15 payments every 10 minutes.

## Run your own copy on testnet

This deploys your own sandbox, factory and test token. It needs no keys, but it does need time and test funds:

```sh
pnpm build:contracts                # first: setup deploys these files
pnpm demo:setup                     # collects test NEAR from the faucet and deploys everything
pnpm build && pnpm start            # http://localhost:3000, now with your own demo agent
```

- **Test NEAR:** about 75 in all, which the script gathers from the faucet across several new accounts. Most of it (about 54) is the one-time global deploy of the vault code, which NEAR stores on every shard. The faucet gives 10 per account and limits how many you make, so setup may stop partway; run it again a few hours later and it resumes where it stopped.
- **What it builds:**
  - a test USDC token and the vault (caps $500 per payment, $3,000 a week);
  - an agent and a guardian. The app uses only their function-call keys, each limited to its role's vault methods. Setup also keeps full-access keys on the sandbox's accounts, the vault included, so it can redeploy them; a vault made by the factory has no access keys at all, so its code and funds move only through the contract;
  - test payees: two suppliers on NEAR, a lookalike account the scams use, and on Base Sepolia a freight supplier and a member of staff;
  - an OutLayer agent wallet whose policy needs an approval, Veto's or the owner's, for every payment;
  - the factory (`vaults.<root>`) that creates a vault for any testnet account. Each new vault runs the global vault code by hash, stores only its own state, and starts with $5,000 test USDC, caps of $500 a payment and $3,000 a week, the two NEAR suppliers, and only the enclave model's key. It also gets its own agent (`<name>_agent`) and screening account (`<name>_guard`), each holding one function-call key that can only call that vault. Each vault costs the factory 0.9 test NEAR; send the factory more to sponsor more.
- **What it writes:** your state in `.veto-dev/` and the app's `apps/web/.env.local` (both gitignored).
- **Base payouts (the payroll emails):** setup prints the vault's own Base Sepolia address. Send it about 0.01 Base Sepolia ETH from any faucet and the Base emails appear in the inbox.
- **Keys that turn on the rest** (see [.env.example](.env.example)):
  - `NEARAI_API_KEY`: the real model instead of the labelled test signer (setup then removes the test key from your sandbox), **Write your own email**, and the agent for vaults made at `/start`. Run `pnpm demo:setup` again after adding it.
  - `NEAR_INTENTS_AGENT_API_KEY`, then `node scripts/agentapi-setup.ts`: the **Agent API** path.

### The guardian and SDK on their own

After `pnpm demo:setup`:

```sh
VETO_SCREENER=dev pnpm guardian      # watches your vault, screens, submits verdicts
node scripts/demo-agent.ts           # an agent using @veto/sdk: one invoice PAID, one scam VETOED
node scripts/outlayer-agent.ts       # the same agent paying from its OutLayer wallet
node scripts/evm-agent.ts            # a Base Sepolia supplier, paid from the vault's own address via Chain Signatures
```

Run each once on a fresh vault. Running one again re-sends an invoice that was already paid, and Veto vetoes it as `DUPLICATE_INVOICE`.

## With a NEAR AI key

Put `NEARAI_API_KEY=…` in `.env.local` at the repo root, then:

```sh
pnpm demo:setup                       # copies the key to the app and approves the model's attested key on the vault
pnpm bench --model Qwen/Qwen3-VL-30B-A3B-Instruct
node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested
node bench/publish.ts                 # updates the /bench page
```

## Mainnet: a real payout to Base through NEAR Intents

First put `MAINNET_ROOT_ID`, `MAINNET_ROOT_KEY`, `MAINNET_SUPPLIER_BASE` and `MAINNET_FUNDER_BASE` in `.env.local` (see [.env.example](.env.example)), plus `NEARAI_API_KEY` for the payout; without them each script stops and names what's missing. `mainnet-setup.ts` and `mainnet-pay.ts` only print what they would do unless you pass `--send`. `mainnet-fund.ts` asks 1Click for a deposit address, which moves nothing until you send USDC to it.

```sh
node scripts/mainnet-setup.ts                 # the plan and its cost (about 6 NEAR; it prints the exact figure)
node scripts/mainnet-setup.ts --send          # deploys it
node scripts/mainnet-fund.ts --amount 10      # where to send 10 USDC on Base to fund the vault
node scripts/mainnet-pay.ts --amount 2        # what the payout would do
node scripts/mainnet-pay.ts --amount 2 --send
```

What each one does:

- **`mainnet-setup.ts`** deploys a small vault ($25 per payment, $50 a week) with a route that pays USDC on Base.
- **`mainnet-fund.ts`** gets a 1Click deposit address that turns USDC on Base into USDC in the vault; `--watch <address>` follows a deposit until it lands.
- **`mainnet-pay.ts`** has the agent propose a payout. The model screens it. The vault checks 1Click's signed quote on-chain: exact payee, exact amount, refunds only to the vault, fees under the cap. Only then does it send the deposit. The script follows 1Click until USDC lands on Base.

`ONECLICK_JWT` lowers 1Click's fee. With `SHIELD_JWT` set, a payout is held while a Shield incident touches its chain, bridge, token or payee, and it fails closed if the incident outlasts the screening deadline.

## How it works

```
agent ──propose──▶ vault contract ──caps──▶ Screening
                        ▲                     │
                        │ submit_verdict      ▼
                   guardian ◀── evidence ── agent (private; only its hash is on-chain)
                        │
                        └─▶ NEAR AI Cloud (TEE): PASS / VETO, signed over request + response
vault: ecrecover → approved model key → echoes this proposal's id and hash → pay or block
```

- **Contract** ([contract/src/lib.rs](contract/src/lib.rs)):
  - Agent and owner methods: `propose`, `submit_verdict`, `expire`, `override_veto` / `cancel_override` / `execute_override`, `keep_blocked`, `freeze`, and `set_policy` (raising a limit waits for a delay).
  - Payees, agents, signers and routes.
  - External wallets: `add_wallet`, `propose_external`, `settle_external`.
  - Chain Signatures: `set_evm_route`, `settle_evm`. On a pass, the vault RLP-encodes the EIP-1559 transfer itself and asks `v1.signer-prod.testnet` to sign its hash ([evm.rs](contract/src/evm.rs)). The guardian broadcasts the signed bytes ([packages/core/src/evm.ts](packages/core/src/evm.ts)).
  - NEAR Intents payouts verify 1Click's ed25519 quote signature on-chain ([quote.rs](contract/src/quote.rs)).
- **Guardian** ([services/guardian](services/guardian/src/main.ts)): screens open proposals with [packages/core](packages/core/src/pipeline.ts) and keeps a private audit record of what the model saw. It reads the evidence in the clear and chooses what the model sees: the enclave's signature proves which model judged which input, not that the input was the real email. A compromised guardian still can't pass anything over the caps, and an owner who wants payees enforced on-chain too can set `set_require_listed_payee`. In this demo one server runs both the demo agent and the guardian.
- **OutLayer** ([packages/core/src/outlayer.ts](packages/core/src/outlayer.ts)), step by step:
  1. The agent's OutLayer wallet holds the payment for approval.
  2. The guardian checks OutLayer's hash of the operation and records it with `propose_external`. The caps apply.
  3. The payment is screened. The approval id and operation hash are part of the proposal hash the model must echo.
  4. Only after a pass does the guardian sign a NEP-413 approval.
  5. It marks the payment paid once the wallet's own transaction is final on NEAR.
- **NEAR Intents Agent API** ([packages/core/src/agentapi.ts](packages/core/src/agentapi.ts), [apps/web/lib/server/agentapi.ts](apps/web/lib/server/agentapi.ts)), plain HTTP, with the grant credential and EIP-712 owner signing checked against the API's official test vectors:
  1. `scripts/agentapi-setup.ts` creates an agent account on mainnet with one owner signature over its policy: USDC only, at most $0.10 a payment, $2 a day and $10 a week, sent to two listed suppliers or withdrawn to one listed worker's address on Base. Rerunning it keeps the policy in force equal to the one in the script. `scripts/agentapi-fund.ts [chain]` prints a deposit address for USDC on any chain the API supports. `scripts/agentapi-recycle.ts --send` moves what the two suppliers received back to the agent, as gasless NEAR Intents transfers signed with the suppliers' keys, so a few dollars keep the demo paying.
  2. The owner issues one grant, and Veto holds it. The AI agent holds none, so it can't spend.
  3. The agent asks; Veto screens the request with the same enclave model, against the business's mandate and payment history, and requires a signer the vault approves.
  4. Only a pass is sent with Veto's grant: a `transfer` to a supplier, or a `withdraw` that pays a salary out on Base, under an idempotency key tied to that screening, so a retry can never send twice. The owner's policy still refuses anything outside it, so a "new wallet" for a salary is refused there even if the screen missed it.
- **Factory** ([factory/src/lib.rs](factory/src/lib.rs)): `create_vault(name, label, mandate?)` creates `<name>.<factory>` owned by the caller in one receipt (create account, use the global vault code, init). Then it creates the vault's agent and screening accounts, each with one function-call key limited to that vault, registers the vault with the token and sends starter funds. Up to 3 vaults per account on testnet. New testnet wallets often hold no NEAR, so `send_gas(account)` sends a wallet 0.3 test NEAR once; the contract only accepts it from the factory account itself, and the web app holds a key on that account limited to this one method, which it calls when an empty wallet connects.
- **App** ([apps/web](apps/web)): Next.js, mobile and desktop, with the same four places on both: Home, Activity (what needs your decision, then every payment), Rules (mandate, limits, payees, freeze) and Agents. **Try it** (the V button on phones, the top of the sidebar on desktop) opens the agent's inbox. Open the shared sandbox or any vault the factory made (`/app?vault=<id>`); create one at `/start`. In your own vault, owner actions are signed by your wallet; in the sandbox, a demo-owner key limited to the owner methods lets anyone try them.
- **SDK** ([packages/sdk](packages/sdk/src/index.ts)): `Veto` for vault agents and `VetoOutLayer` for agents with OutLayer wallets.

## Status

| Part | State |
| --- | --- |
| Vault contract, verdict check, overrides, freeze | Live on testnet, 48 tests |
| Your own vault, owned by your wallet (factory + NEAR global contract) | Live on testnet, 9 factory tests |
| Payouts from the vault's own Base Sepolia address (NEAR Chain Signatures) | Live on testnet |
| Payroll: staff on the payee list, each paid on the chain they chose | Live on testnet; the sandbox pays Tunde Bello on Base and vetoes a fake "new wallet" request. Shown once the vault's Base address holds test ETH |
| OutLayer agent wallets (pass, veto, override) | Live on testnet |
| NEAR Intents Agent API wallet, with Veto holding its only grant | Live on mainnet: the owner's policy is in force and Veto screens and sends each request (supplier transfers, salaries withdrawn to Base). Whenever the wallet holds no USDC, a pass is refused there with `insufficient_balance` |
| Agent inbox, guardian, owner actions in the app | Live on testnet |
| Private screen on NEAR AI Cloud (Qwen3-VL-30B in a TDX enclave) | Live on testnet; about 1.5 s per verdict |
| Enclave verification (Intel TDX quote, NVIDIA GPUs, key and nonce binding, gateway) | Live on every Proof page and in `verify.ts --attested`; tested offline on a captured real quote |
| Veto Bench | Live: on our 100 scenarios, 50/50 attacks caught, 8/50 honest payments blocked, 100/100 signatures verified |
| Payouts to other chains through NEAR Intents | Built; contract tested against a real executable quote; first mainnet payout needs funding |
| Shield incident check before cross-chain payouts | Built; holds a payout while a NEAR Intents Shield incident touches its route. Runs when `SHIELD_JWT` is set |

## Layout

```
contract/          vault contract (near-sdk 5.29.1) and its tests
factory/           creates vaults owned by their callers, from the global vault code
packages/core/     proposal hashing, signals, prompt, NEAR AI client, enclave attestation check, pipeline, 1Click, OutLayer, Agent API, Chain Signatures
packages/sdk/      agent SDK
services/guardian/ the screening service
apps/web/          the app and docs (/docs explains everything in plain words)
bench/             Veto Bench
scripts/           testnet demo setup and agents, Agent API setup/fund, deployed-code check, mainnet setup/fund/pay
test-token/        NEP-141 test USDC
```

## Built at NEAR HACKATHON

Everything in this repository was written during NEAR HACKATHON, starting with the first commit on 2026-10-29; there is no earlier code base.

Built with:

- **NEAR:** near-sdk 5.29.1 (Rust contracts), near-api-js 7.4.0, global contracts, Chain Signatures (MPC), function-call access keys, NEP-141 and NEP-413
- **NEAR AI Cloud:** Qwen3-VL-30B-A3B-Instruct in a TEE, its signed responses and its attestation API
- **NEAR Intents:** the 1Click API, the Agent API (agentsonintents.com) and intents.near
- **OutLayer** agent wallets
- **Attestation:** Intel's DCAP quote verification through `@phala/dcap-qvl-node` 0.3.3 (collateral from Intel's PCS, or from Phala's public PCCS mirror when Intel's service is down; its signatures are checked up to Intel's root either way), NVIDIA's attestation service (NRAS), checked the way NEAR AI's own verifier does
- **Contracts:** NEAR's host functions for the cryptography (`env::ecrecover` and `env::keccak256_array` for the enclave's signature, `env::ed25519_verify` for 1Click quotes); the tests check them against k256, sha3 and ed25519-dalek
- **App and tools:** Next.js 16, React 19, motion, lenis, ethers 6, @noble/curves, @noble/hashes, @scure/base, @hot-labs/near-connect

MIT licence.
