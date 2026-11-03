# Veto

A NEAR vault where every payment an AI agent makes needs a second signer that can only say no.

**Live demo (NEAR testnet):** https://veto-beta.vercel.app. Open the app and press **Try it**. Nothing to install.

Each payment has to pass two gates before money moves:

1. **Hard caps in the vault contract**: per-payment and per-week limits per asset.
2. **A private AI screen**: a model on NEAR AI Cloud reads the evidence behind the payment (the email, the invoice, the web page) inside a TEE and answers PASS or VETO. The enclave signs the exact request and response. The vault recovers that signature on-chain with `ecrecover` before it acts.

The AI can block a payment the caps would allow. It can never allow one the caps would block. The owner can override a veto, after a delay.

The same screen also covers agents that pay from an **OutLayer** wallet. Veto is an approver on the wallet's policy, so OutLayer holds each payment until the vault has passed it.

The vault can also pay on **Base** from its own address there, through **NEAR Chain Signatures**. The vault builds each passed transfer itself, and NEAR's MPC network signs exactly that.

## Check it in five minutes (no keys, no funds)

Requires Node 24+, pnpm 11, and Rust with the `wasm32-unknown-unknown` target.

```sh
pnpm install
pnpm test
```

You should see `ℹ pass 11` (TypeScript core) and `test result: ok. 47 passed` (contract). The contract tests include a real executable 1Click quote and a real 1Click signature. They also pin the proposal hash that the TypeScript side must reproduce.

```sh
node bench/run.ts --screener policy   # Attacks caught 33/50, normal payments blocked 8/50
node bench/run.ts --screener dev      # Attacks caught 41/50, normal payments blocked 8/50
```

[Veto Bench](bench/) has 100 payment scenarios: 50 attacks and 50 ordinary payments.

- `policy` is what a policy wallet enforces on its own: an allowlist plus a cap. Every attack it misses pays a supplier already on the list.
- `dev` is Veto's deterministic checks without a model.
- The model rows need a NEAR AI key. See [With a NEAR AI key](#with-a-near-ai-key).

## Run the whole thing on testnet (no keys, no funds)

```sh
pnpm build:contracts
pnpm demo:setup                 # creates your own vault on NEAR testnet from the faucet
pnpm build && pnpm start        # http://localhost:3000
```

`demo:setup` prints `Demo vault ready: https://testnet.nearblocks.io/address/treasury.veto-….testnet` and the vault's own Base Sepolia address. Send that address about 0.01 Base Sepolia ETH from any faucet to turn on the Base payout. It also writes `apps/web/.env.local` (gitignored). It builds:

- a test USDC token and the vault (caps $500 per payment, $3,000 a week);
- an agent, a guardian and two payees, each holding a function-call key that can only call its own vault methods;
- an OutLayer agent wallet whose policy needs an approval for every payment.

Then open http://localhost:3000/app and press **Try it** (the green V on a phone; the **Agent inbox** panel on desktop):

| Do | See |
| --- | --- |
| Let the agent pay **"Invoice INV-…: 72 bales of combed cotton"** | Agent proposed → Screening privately → **Paid**, with testnet tx links |
| Let it pay **"Updated payment details for INV-…"** | **Vetoed**: a lookalike of an address you've paid before. The coral card appears on Home |
| Open the vetoed decision → **Override** | A 3-minute countdown, then it pays (still inside the caps), unless you cancel |
| Switch **Pay from** to **OutLayer wallet** and repeat both | Paid: Veto approved it on OutLayer and the wallet sent it. Vetoed: Veto never signs, so OutLayer keeps holding it. **Keep it blocked** then rejects it there for good |
| Open any decision → **Proof** | The request and response hashes, the signer, and the on-chain signature check |

Until a NEAR AI key is connected, verdicts are signed by a local test key that the demo vault was told to trust. The app labels every such decision "test signer".

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
pnpm demo:setup                       # copies the key to the app and removes the test signer from the vault
pnpm bench --model z-ai/glm-5.3-flash
node bench/verify.ts bench/results/z-ai_glm-5.3-flash.json   # re-checks every signature offline
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
- **App** ([apps/web](apps/web)): Next.js, mobile and desktop. Owner actions work with a NEAR wallet, or with the demo owner key on testnet.
- **SDK** ([packages/sdk](packages/sdk/src/index.ts)): `Veto` for vault agents and `VetoOutLayer` for agents with OutLayer wallets.

## Status

| Part | State |
| --- | --- |
| Vault contract, verdict check, overrides, freeze | Live on testnet, 47 tests |
| Payouts from the vault's own Base Sepolia address (NEAR Chain Signatures) | Live on testnet; the inbox shows the Base supplier once the vault's address holds test ETH |
| OutLayer agent wallets (pass, veto, override) | Live on testnet |
| Agent inbox, guardian, owner actions in the app | Live on testnet |
| Private screen on NEAR AI Cloud | Built; runs when the API key is added |
| Payouts to other chains through NEAR Intents | Built; contract tested against a real executable quote; first mainnet payout needs funding |
| Shield incident check before cross-chain payouts | Built; holds a payout while a NEAR Intents Shield incident touches its route. Runs when `SHIELD_JWT` is set |

## Layout

```
contract/          vault contract (near-sdk 5.29.1) and its tests
packages/core/     proposal hashing, signals, prompt, NEAR AI client, pipeline, 1Click, OutLayer
packages/sdk/      agent SDK
services/guardian/ the screening service
apps/web/          the app and docs (/docs explains everything in plain words)
bench/             Veto Bench
scripts/           testnet demo, OutLayer agent, mainnet setup/fund/pay
test-token/        NEP-141 test USDC
```

MIT licence.
