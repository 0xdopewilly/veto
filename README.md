# Veto

A NEAR vault where every payment an AI agent makes needs a second signer that can only say no.

**Live demo (NEAR testnet):** https://veto-beta.vercel.app. Open the app and press **Try it** in the shared sandbox, with nothing to install. Or connect a NEAR testnet wallet and create your own vault: one transaction, and from then on only your wallet can change its rules or override a veto.

Each payment has to pass two gates before money moves:

1. **Hard caps in the vault contract**: per-payment and per-week limits per asset.
2. **A private AI screen**: a model on NEAR AI Cloud reads the evidence behind the payment (the email, the invoice, the web page) inside a TEE and answers PASS or VETO. The enclave signs the exact request and response. The vault recovers that signature on-chain with `ecrecover` before it acts.

The AI can block a payment the caps would allow. It can never allow one the caps would block. The owner can override a veto, after a delay.

The same screen also covers agents that pay from an **OutLayer** wallet. Veto is an approver on the wallet's policy, so OutLayer holds each payment until the vault has passed it.

It also covers a **NEAR Intents Agent API** wallet on mainnet. The owner's signed policy is the hard limit, and Veto holds the account's only grant, so the AI agent can only ask: Veto screens each request and sends just what passes.

The vault can also pay on **Base** from its own address there, through **NEAR Chain Signatures**. The vault builds each passed transfer itself, and NEAR's MPC network signs exactly that.

**Payroll** runs through the same gate. Staff sit on the payee list with the wallet and chain each one chose. In the sandbox the agent pays Tunde Bello's salary on Base, and Veto vetoes the scam payroll attracts most: an email asking to send the salary to a "new wallet".

**Many agents, one gate.** A vault takes any number of agents, each holding a key that can only propose. Agents in OutLayer or Agent API wallets go through the same caps and the same private AI review, and the owner can pause any one of them.

## Check it in five minutes (no keys, no funds)

Requires Node 24+, pnpm 11, and Rust with the `wasm32-unknown-unknown` target.

```sh
pnpm install
pnpm test
```

You should see `ℹ pass 13` (TypeScript core), `test result: ok. 48 passed` (vault contract) and `test result: ok. 9 passed` (vault factory). The contract tests include a real executable 1Click quote and a real 1Click signature. They also pin the proposal hash that the TypeScript side must reproduce.

```sh
node bench/run.ts --screener policy   # Attacks caught 33/50, normal payments blocked 8/50
node bench/run.ts --screener dev      # Attacks caught 41/50, normal payments blocked 8/50
```

[Veto Bench](bench/) has 100 payment scenarios: 50 attacks and 50 ordinary payments.

- `policy` is what a policy wallet enforces on its own: an allowlist plus a cap. Every attack it misses pays a supplier already on the list.
- `dev` is Veto's deterministic checks without a model.
- With a NEAR AI key, Qwen3-VL-30B running in NEAR AI's enclave catches 50 of 50 attacks and blocks 8 of 50 honest payments (all 8 are new suppliers whose approval sits inside the email). Every one of its 100 signatures re-verifies offline. See [With a NEAR AI key](#with-a-near-ai-key).

## Run the whole thing on testnet (no keys, no funds)

```sh
pnpm build:contracts
pnpm demo:setup                 # creates your own vault on NEAR testnet from the faucet
pnpm build && pnpm start        # http://localhost:3000
```

`demo:setup` prints `Demo vault ready: https://testnet.nearblocks.io/address/treasury.veto-….testnet` and the vault's own Base Sepolia address. Send that address about 0.01 Base Sepolia ETH from any faucet to turn on the Base payout. It also writes `apps/web/.env.local` (gitignored). It builds:

- a test USDC token and the vault (caps $500 per payment, $3,000 a week);
- an agent, a guardian and two payees, each holding a function-call key that can only call its own vault methods;
- an OutLayer agent wallet whose policy needs an approval for every payment;
- the vault code deployed once as a NEAR global contract, and a factory (`vaults.<root>`) that creates a vault for any testnet account. Each new vault runs that code by hash, stores only its own state (about 1.6 KB), and starts with $5,000 test USDC, the same caps and suppliers, and only the enclave model's key. It also gets its own agent (`<name>_agent`) and screening account (`<name>_guard`), each holding one function-call key that can only call that vault, so the hosted app never holds a key that can do more. A global deploy stores the code on every shard, so it costs about 51 test NEAR; the faucet gives 10 per account and limits how many you make, so this step may need a second run a few hours later. Each vault costs the factory 0.9 test NEAR; send the factory more to sponsor more.

Then open http://localhost:3000/app and press **Try it** (the green V on a phone; **Try the agent** at the top of the sidebar on desktop):

| Do | See |
| --- | --- |
| Open **/start**, connect a testnet wallet, name your business and sign | Your own vault, live in a few seconds. Its owner is your account, and every owner action below needs your wallet. Skip this to use the shared sandbox, where anyone can act as the owner |
| Let the agent pay **"Invoice INV-…: 72 bales of combed cotton"** | Agent proposed → Screening privately → **Paid**, with testnet tx links |
| Let it pay **"Updated payment details for INV-…"** | **Vetoed**: a lookalike of an address you've paid before. The coral card appears on Home |
| In the sandbox, let it pay **"Payroll PAY-…: … salary for Tunde Bello"** | **Paid** on Base, the chain Tunde chose, from the vault's own Base Sepolia address (NEAR Chain Signatures) |
| Let it pay **"New wallet for my salary"** | **Vetoed**: the address imitates Tunde's saved one and has never been paid |
| Open the vetoed decision → **Override** | A 3-minute countdown, then it pays (still inside the caps), unless you cancel |
| In the sandbox, switch **Pay from** to **OutLayer wallet** and repeat both | Paid: Veto approved it on OutLayer and the wallet sent it. Vetoed: Veto never signs, so OutLayer keeps holding it. **Keep it blocked** then rejects it there for good |
| In the sandbox, switch **Pay from** to **Agent API** and repeat both | The same screen, then a real call to the NEAR Intents Agent API with Veto's grant. Amounts are scaled 1:100 for a wallet holding a few real dollars. A veto never reaches the API; a payment the owner's policy forbids is refused there even after a pass |
| Press **Write your own email** and write an invoice or a scam | A real AI agent on NEAR AI reads it and proposes what it asks for; Veto screens it like any other payment |
| Open any decision → **Proof** | The request and response hashes, the signer, and the on-chain signature check |

With `NEARAI_API_KEY` set, verdicts come from Qwen3-VL-30B inside NEAR AI's enclave. Without it, or if NEAR AI can't answer, the sandbox's verdicts are signed by a local test key it was told to trust, and the app labels every such decision "test signer". Vaults created through the factory trust only the enclave key: with no answer, the payment expires unpaid.

### The guardian and SDK on their own

```sh
VETO_SCREENER=dev pnpm guardian      # watches the demo vault, screens, submits verdicts
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
node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json   # re-checks every signature offline
node bench/publish.ts                 # updates the /bench page
```

## Mainnet: a real payout to Base through NEAR Intents

Both scripts are dry runs unless you pass `--send`.

```sh
node scripts/mainnet-setup.ts          # prints the plan and cost (about 5.6 NEAR)
node scripts/mainnet-fund.ts --amount 10
node scripts/mainnet-pay.ts --amount 2
```

What each one does:

- **`mainnet-setup.ts`** deploys a small vault ($25 per payment, $50 a week) with a route that pays USDC on Base.
- **`mainnet-fund.ts`** gets a 1Click deposit address that turns USDC on Base into USDC in the vault.
- **`mainnet-pay.ts`** has the agent propose a payout. The model screens it. The vault checks 1Click's signed quote on-chain: exact payee, exact amount, refunds only to the vault, fees under the cap. Only then does it send the deposit. The script follows 1Click until USDC lands on Base.

They need `MAINNET_ROOT_ID`, `MAINNET_ROOT_KEY`, `MAINNET_SUPPLIER_BASE` and `MAINNET_FUNDER_BASE` in `.env.local`. `ONECLICK_JWT` lowers 1Click's fee. With `SHIELD_JWT` set, a payout is held while a Shield incident touches its chain, bridge, token or payee, and it fails closed if the incident outlasts the screening deadline.

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
- **Guardian** ([services/guardian](services/guardian/src/main.ts)): screens open proposals with [packages/core](packages/core/src/pipeline.ts) and keeps a private audit record of what the model saw.
- **OutLayer** ([packages/core/src/outlayer.ts](packages/core/src/outlayer.ts)), step by step:
  1. The agent's OutLayer wallet holds the payment for approval.
  2. The guardian checks OutLayer's hash of the operation and records it with `propose_external`. The caps apply.
  3. The payment is screened. The approval id and operation hash are part of the proposal hash the model must echo.
  4. Only after a pass does the guardian sign a NEP-413 approval.
  5. It marks the payment paid once the wallet's own transaction is final on NEAR.
- **NEAR Intents Agent API** ([packages/core/src/agentapi.ts](packages/core/src/agentapi.ts), [apps/web/lib/server/agentapi.ts](apps/web/lib/server/agentapi.ts)), plain HTTP, with the grant credential and EIP-712 owner signing checked against the API's official test vectors:
  1. `scripts/agentapi-setup.ts` creates an agent account on mainnet with one owner signature over its policy: USDC only, at most $25 a payment, $150 a day and $500 a week, to two listed suppliers. Rerunning it keeps the policy in force equal to the one in the script. `scripts/agentapi-fund.ts [chain]` prints a deposit address for USDC on any chain the API supports.
  2. The owner issues one grant, and Veto holds it. The AI agent holds none, so it can't spend.
  3. The agent asks; Veto screens the request with the same enclave model, against the business's mandate and payment history, and requires a signer the vault approves.
  4. Only a pass becomes a `transfer` with Veto's grant, under an idempotency key tied to that screening, so a retry can never send twice. The owner's policy still refuses anything outside it.
- **Factory** ([factory/src/lib.rs](factory/src/lib.rs)): `create_vault(name, label, mandate?)` creates `<name>.<factory>` owned by the caller in one receipt (create account, use the global vault code, init). Then it creates the vault's agent and screening accounts, each with one function-call key limited to that vault, registers the vault with the token and sends starter funds. Up to 3 vaults per account on testnet. New testnet wallets often hold no NEAR, so `send_gas(account)` sends a wallet 0.3 test NEAR once; only the factory's own function-call key (held by the web app, limited to that method) can call it, and the app calls it when an empty wallet connects.
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
| NEAR Intents Agent API wallet, with Veto holding its only grant | Live on mainnet; payments run once the wallet holds USDC |
| Agent inbox, guardian, owner actions in the app | Live on testnet |
| Private screen on NEAR AI Cloud (Qwen3-VL-30B in a TDX enclave) | Live on testnet; about 1.5 s per verdict |
| Veto Bench | Live: 50/50 attacks caught, 8/50 honest payments blocked, 100/100 signatures verified |
| Payouts to other chains through NEAR Intents | Built; contract tested against a real executable quote; first mainnet payout needs funding |
| Shield incident check before cross-chain payouts | Built; holds a payout while a NEAR Intents Shield incident touches its route. Runs when `SHIELD_JWT` is set |

## Layout

```
contract/          vault contract (near-sdk 5.29.1) and its tests
factory/           creates vaults owned by their callers, from the global vault code
packages/core/     proposal hashing, signals, prompt, NEAR AI client, pipeline, 1Click, OutLayer
packages/sdk/      agent SDK
services/guardian/ the screening service
apps/web/          the app and docs (/docs explains everything in plain words)
bench/             Veto Bench
scripts/           testnet demo, OutLayer agent, mainnet setup/fund/pay
test-token/        NEP-141 test USDC
```

MIT licence.
