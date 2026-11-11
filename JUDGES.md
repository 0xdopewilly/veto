# Judging Veto: the short path

Veto is a NEAR vault where an AI agent's payments need two things: the vault's hard caps, and a PASS from a model running inside NEAR AI Cloud's enclave. The vault checks the enclave's signature on-chain with `ecrecover`. The model can only block; it can never allow more than the caps. The [README](README.md) has everything; this page is the fastest way to check the main claims.

## In the browser (3 minutes, nothing to install)

Open https://veto-beta.vercel.app/app and press **Try it** (the green V on a phone, **Try the agent** at the top of the sidebar on desktop).

| Do | See |
| --- | --- |
| Let the agent pay **"Invoice INV-…: 72 bales of combed cotton"** | Screening privately, then **Paid**, with testnet transaction links |
| Let it pay **"Updated payment details for INV-…"** | **Vetoed**: a lookalike of a payee you've paid before, well under every cap |
| Open the vetoed decision → **Proof** → **Check the enclave now** | Eight live checks of NEAR AI's enclave: Intel TDX quote, NVIDIA GPUs, key and nonce bound into the quote, the published app, the gateway, and that the key is the one that signed this verdict. **Check again** runs a new check with a new nonce |
| On that Proof page, **The exact bytes the model saw** | **Matches the chain**: your browser reads the decision from NEAR's public RPC and runs five checks on the published bytes (request and response hashes, the signature recovered to the vault's approved key, the prompt about this exact payment, and the email against the hash the agent committed before screening) |
| Back in the inbox, let the agent pay **"Invoice IKF-…: Lagos to Ibadan haulage"** | **Paid** on Base from the vault's own address, signed by NEAR's MPC network (Chain Signatures) |
| **Activity** → **Download CSV** | One row per payment, with its verdict, reasons, transaction and proof link |

The sandbox is shared, and anyone can act as its owner, so it goes back to its default rules for each new visitor. Runs are limited per visitor, to about 15 every 10 minutes.

## On your machine (no keys, no funds)

Node 24+, pnpm 11, Rust through rustup, about 3 GB of disk.

| Run | Expect |
| --- | --- |
| `pnpm install && pnpm test` | `ℹ pass 18` (core), `ℹ pass 11` (MCP server), `48 passed` (vault contract), `9 passed` (factory) |
| `claude mcp add veto -- node "$PWD/packages/mcp/src/main.ts"`, then ask your agent to email the Veto demo agent a "bank details changed" invoice | The MCP server, no keys: the hosted demo agent proposes the payment and the tool returns **Vetoed** with the reasons, testnet transaction links and the Proof page, in about 15 s ([README](README.md#from-an-mcp-client-claude-code-codex-cursor)) |
| `node bench/run.ts --screener policy` | `Attacks caught 33/50`: an allowlist plus a cap on their own |
| `node bench/run.ts --screener dev` | `Attacks caught 41/50`: Veto's rules without a model |
| `node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested` | `100/100 verdicts verified` and eight ✓ lines (10 to 20 s) |
| `pnpm build:contracts && node scripts/check-deployed.ts` | Four ✓: the code on testnet is exactly this build |

`git status` stays clean afterwards: the bench runs write to `bench/runs/`, which git ignores.

## Where each claim lives

| Claim | Code |
| --- | --- |
| The vault recovers the verdict's signer on-chain and accepts only keys the owner approved | [contract/src/lib.rs](contract/src/lib.rs) (`submit_verdict`) |
| A verdict must echo this proposal's id and hash, so it can't be replayed onto another payment | [contract/src/lib.rs](contract/src/lib.rs), [packages/core/src/proposal.ts](packages/core/src/proposal.ts) |
| Caps are checked when a payment is proposed and again when it executes | [contract/src/lib.rs](contract/src/lib.rs) |
| Payouts on Base: the vault builds the transfer and NEAR's MPC network signs exactly that | [contract/src/evm.rs](contract/src/evm.rs) |
| NEAR Intents payouts check 1Click's signed quote on-chain | [contract/src/quote.rs](contract/src/quote.rs) |
| The enclave check (Intel TDX, NVIDIA, key and nonce binding) | [packages/core/src/attest.ts](packages/core/src/attest.ts) |
| Vaults owned by their creators, from one global contract | [factory/src/lib.rs](factory/src/lib.rs) |

## What it doesn't do (yet)

- **The contract doesn't check the prompt.** It checks the enclave's signature and that the verdict echoes this payment's id and hash. The agent commits the email's hash on-chain before screening, and in the sandbox the exact request bytes are published, so the Proof page checks the model judged exactly that email; a vault someone owns keeps them private, so there a compromised guardian could show the model a different email. No signature can show the committed email is the one that really arrived. A compromised guardian still can't pass anything over the caps.
- **The contract doesn't enforce the payee list by default.** The screen flags a payee that isn't on it; an owner who wants the contract itself to refuse unlisted payees can turn on `set_require_listed_payee`.
- **The bench is ours.** Veto Bench's 100 scenarios and the screening prompt were written by the same team, so read 50/50 as a result on this set, not a general catch rate. The 8 honest payments it blocks are new suppliers whose approval sits inside the email, which Veto holds for the owner by design.
- **Testnet, except one path.** Vaults, payouts and verdicts run on NEAR testnet with test tokens. The NEAR Intents Agent API path pays real USDC on mainnet, scaled down to cents. The first mainnet payout through 1Click is built and tested, but not yet run.
- **The sandbox's accounts keep full-access keys** so setup can redeploy them. The app itself only uses function-call keys, and a vault made at `/start` has no access keys at all.
