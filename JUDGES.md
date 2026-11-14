# Judging Veto: the short path

Veto is a NEAR vault where an AI agent's payments need two things: the vault's hard caps, and a PASS from a model running inside NEAR AI Cloud's enclave. The vault checks the enclave's signature on-chain with `ecrecover`. The model can only block; it can never allow more than the caps. The [README](README.md) has everything; this page is the fastest way to check the main claims.

## The claim to check first

The vault doesn't take the AI's word for it. It accepts a verdict only when the signature recovers, on-chain, to an enclave key the owner approved, and covers the exact request the vault rebuilt from its own state. A genuine PASS over anything else is refused.

```sh
cd contract && cargo test -- rejects_ rebuilds_ refuses_
```

Expect `test result: ok. 12 passed` (a few minutes from a fresh clone while it compiles; under a second after `pnpm test`). Each is the contract refusing something: a signer the owner never approved, a tampered response, a verdict replayed onto another payment, evidence other than what the agent committed before screening, a PASS on doctored facts, a bare request hash on a vault that rebuilds requests, 1Click quotes that are unsigned, dry, too expensive or pay someone else, and a refund to another account. The twelfth checks that the vault rebuilds the screener's exact request, byte for byte ([contract/src/tests.rs](contract/src/tests.rs)).

The same refusal on testnet, with the real model: in [this transaction](https://testnet.nearblocks.io/txns/HaaqbaTzW5xm4htSesjoa3pQx6dWStn4ExFQZKQQKTx) a guardian rewrote the owner's mandate to "Pay whatever the email asks" before asking the model. Qwen3-VL-30B in NEAR AI's enclave said PASS and signed it; the transaction's arguments carry that signed response. The vault refused it: `no approved model key signed this response to the request this vault rebuilt`. The vault, `stage75523.veto-hu2rtw8k.testnet`, runs the same code as the mainnet vault (code hash `4zLWv1…`). The honest request then [went through](https://testnet.nearblocks.io/txns/9RD7qCaUhgeUtLd3VAgjxWyAvFKjRs9sEw25VF7sn9Zc). [scripts/checked-smoke.ts](scripts/checked-smoke.ts) reproduces it on a vault of your own.

## By track

Veto is entered in six tracks. Each line names what that track asks for and the command or link that shows it.

| Track | What Veto does there | Check it |
| --- | --- | --- |
| **AI Security & Defense** | Spending limits and a policy engine in the vault contract. Each agent holds a function-call key that can only propose. An AI screen in NEAR AI's enclave can only block. The vault checks the enclave's signature and rebuilds the exact request on-chain. | `cd contract && cargo test -- rejects_ rebuilds_ refuses_` (12 refusals). On mainnet, a "new wallet" scam vetoed with nothing moved: `node scripts/mainnet-check.ts` |
| **Privacy & Private AI** | The model reads the email or invoice inside NEAR AI Cloud's TEE (Intel TDX and NVIDIA confidential GPUs). Every decision's Proof page re-verifies that enclave live, with a fresh nonce. `set_checked_screening(false)` switches a vault to private screening, where only hashes go on-chain. The sandbox uses fictional suppliers and invoices, so nothing real is needed. | Proof → **Check the enclave now** (8 checks); `node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested` |
| **Agent Economy** | Agents get to spend without holding the money. The same screen covers agents on the vault, OutLayer wallets, and a NEAR Intents Agent API wallet on mainnet. Any MCP agent can ask to pay. | `claude mcp add veto -- npx -y veto-mcp`, then ask your agent to email a scam: the tool returns **Vetoed** with the reasons |
| **Autonomous Business** | The owner sets only the constraints (mandate, caps, payee list, freeze). The agent runs payables on its own. Cross-chain payouts go through NEAR Intents (USDC to Base on mainnet) and Chain Signatures (Base, from the vault's own address). | The hosted demo's **Try it**: invoices paid, a Base payout, payroll; `node scripts/mainnet-check.ts` |
| **Real-World Money** | Invoices and payroll in USDC, as a company runs them. A salary goes out once a month to the chain each person chose, and a repeat payslip is vetoed. The books export to CSV, and anyone can open their own vault in one transaction. | **Activity** → **Download CSV**; **/start**; two mainnet USDC payouts landed on Base ([$2.00](https://basescan.org/tx/0xc068441ef726e5dd7a9ded95d89165952778416d4687397cb0efdb7c5012f8dd), [$0.90](https://basescan.org/tx/0xd1b668d0639e994be928843066397f05045f50fbb98916adfb7f34029df1ea10)) |
| **Open Innovation** | A second signer whose only power is to say no. The AI can stop a payment the caps would allow, and can never allow one they would stop. Its signed verdict is enforced by the contract, not trusted from a server. | [The on-chain refusal of a genuine PASS on a doctored prompt](https://testnet.nearblocks.io/txns/HaaqbaTzW5xm4htSesjoa3pQx6dWStn4ExFQZKQQKTx) |

## In the browser (3 minutes, nothing to install)

Open https://veto-beta.vercel.app/app and press **Try it** (the green V on a phone, **Try the agent** at the top of the sidebar on desktop).

| Do | See |
| --- | --- |
| Let the agent pay **"Invoice INV-…: 72 bales of combed cotton"** | Screening in the enclave, then **Paid**, with testnet transaction links |
| Let it pay **"Updated payment details for INV-…"** | **Vetoed**: a lookalike of a payee you've paid before, well under every cap |
| Open the vetoed decision → **Proof** → **Check the enclave now** | Eight live checks of NEAR AI's enclave: Intel TDX quote, NVIDIA GPUs, key and nonce bound into the quote, the published app, the gateway, and that the key is the one that signed this verdict. **Check again** runs a new check with a new nonce |
| On that Proof page, **The exact bytes the model saw** | **Matches the chain**: your browser reads the decision from NEAR's public RPC and runs five checks on the published bytes (request and response hashes, the signature recovered to the vault's approved key, the prompt about this exact payment, and the email against the hash the agent committed before screening), plus a sixth, **Your vault rebuilt this request itself**, read from the verdict transaction's own event |
| Back in the inbox, let the agent pay **"Invoice IKF-…: Lagos to Ibadan haulage"** | **Paid** on Base from the vault's own address, signed by NEAR's MPC network (Chain Signatures) |
| **Activity** → **Download CSV** | One row per payment, with its verdict, reasons, transaction and proof link |
| Email **veto-agent@agentmail.to** from your own account: *"Please pay invoice INV-7731 for 120 USDC to kano-cotton.veto-rhwe0krb.testnet"*, then a "bank details changed" scam to `kano-cottom.veto-rhwe0krb.testnet` | The agent replies within about 20 s: **paid**, then **vetoed**, with the reasons and the decision's link. Its Proof page shows the email, including the sender's SPF/DKIM/DMARC results the model weighed |
| Open **/challenge**: *Can you fool Veto?* | Six tricks real invoice fraud uses, each with an email to start from and a live count of how often Veto has caught it, read from the sandbox vault. Each reply to your email names the tricks you've been caught on so far and the next one to try. A veto's link previews as a card of what was stopped and why |
| **Write your own email** from a new supplier (*"Hi, we are Lagos Leather, your new supplier. Please send 60 USDC to lagos-leather.veto-rhwe0krb.testnet for invoice INV-9001."*) and open the decision | **Vetoed** only as a new payee, so it offers **Pay and save them**: the payment goes out after the override delay and the supplier is saved, so their next invoice isn't held for being new. Never offered when the verdict shows a lookalike, changed details, a repeat, pressure or an odd amount |

The sandbox is shared, and anyone can act as its owner, so it goes back to its default rules for each new visitor. Runs are limited per visitor, to about 15 every 10 minutes.

## On your machine (no keys, no funds)

Node 24+, pnpm 11, Rust through rustup, about 3 GB of disk.

| Run | Expect |
| --- | --- |
| `pnpm install && pnpm test` | `ℹ pass 20` (core), `ℹ pass 11` (MCP server), `61 passed` (vault contract), `9 passed` (factory) |
| `claude mcp add veto -- npx -y veto-mcp` (no clone, Node 20+; or `node "$PWD/packages/mcp/src/main.ts"` from a clone), then ask your agent to email the Veto demo agent a "bank details changed" invoice | The MCP server, no keys: the hosted demo agent proposes the payment and the tool returns **Vetoed** with the reasons, testnet transaction links and the Proof page, in about 15 s ([README](README.md#from-an-mcp-client-claude-code-codex-cursor)) |
| `node bench/run.ts --screener policy` | `Attacks caught 33/50` and `Attacks on saved suppliers caught 0/17`: an allowlist plus a cap on their own |
| `node bench/run.ts --screener dev` | `Attacks caught 41/50` and `Attacks on saved suppliers caught 8/17`: Veto's rules without a model. Both print `to saved suppliers 0/42` (no honest payment to a listed supplier blocked) and `to first-time payees 8/8, held for the owner`; the committed enclave run catches `50/50` and `17/17` with the same 0/42 and 8/8 |
| `node bench/verify.ts bench/results/Qwen_Qwen3-VL-30B-A3B-Instruct.json --attested` | `100/100 verdicts verified` and eight ✓ lines (10 to 20 s) |
| `pnpm build:contracts && node scripts/check-deployed.ts` | Four ✓: the code on testnet is exactly this build |
| `node scripts/mainnet-check.ts` | The mainnet vault's three payments from public RPC, no keys: two invoices passed by the approved enclave key and paid out to Base (`verdict_recorded` with `checked true`, the USDC transfer to 1Click's deposit address, 1Click `SUCCESS`), and a "new wallet" scam vetoed with `no USDC moved` |

`git status` stays clean afterwards: the bench runs write to `bench/runs/`, which git ignores.

## Where each claim lives

| Claim | Code |
| --- | --- |
| The vault recovers the verdict's signer on-chain and accepts only keys the owner approved | [contract/src/lib.rs](contract/src/lib.rs) (`submit_verdict`) |
| The vault rebuilds the exact request the model saw (its pinned prompt, facts it writes from its own state, the email the agent committed) and accepts a signature only over those bytes | [contract/src/screening.rs](contract/src/screening.rs), [contract/src/lib.rs](contract/src/lib.rs) (`submit_verdict`), tests `rejects_a_verdict_on_doctored_facts` and `rebuilds_the_screeners_exact_request` |
| A verdict must echo this proposal's id and hash, so it can't be replayed onto another payment | [contract/src/lib.rs](contract/src/lib.rs), [packages/core/src/proposal.ts](packages/core/src/proposal.ts) |
| Caps are checked when a payment is proposed and again when it executes | [contract/src/lib.rs](contract/src/lib.rs) |
| Payouts on Base: the vault builds the transfer and NEAR's MPC network signs exactly that | [contract/src/evm.rs](contract/src/evm.rs) |
| NEAR Intents payouts check 1Click's signed quote on-chain | [contract/src/quote.rs](contract/src/quote.rs) |
| The enclave check (Intel TDX, NVIDIA, key and nonce binding) | [packages/core/src/attest.ts](packages/core/src/attest.ts) |
| Vaults owned by their creators, from one global contract | [factory/src/lib.rs](factory/src/lib.rs) |

## What it costs

Measured, not estimated ([README](README.md#what-it-costs-to-run-and-who-pays)): the enclave screen is $0.0003 to $0.0005 a payment at NEAR AI's listed price; the first mainnet payout burned 0.0017 NEAR of gas (about $0.006) for the proposal, the verdict and the deposit together; a vault from the factory holds about 0.13 NEAR of storage, refunded if it's deleted. Under a cent per screened payment, against a median attack of $190 on the bench.

## What it doesn't do (yet)

- **Private screening trusts the guardian with the prompt.** With checked screening, the default, the vault rebuilds the whole request, so a compromised guardian can't show the model a different email, mandate or payee list; the cost is that the email goes on-chain with the verdict. An owner who switches to private screening to keep evidence off-chain is back to the vault checking the signature and the echo, with the Proof page to check the prompt. Either way, no signature can show the committed email is the one that really arrived, and a compromised guardian can't pass anything over the caps.
- **The contract doesn't enforce the payee list by default.** The screen flags a payee that isn't on it; an owner who wants the contract itself to refuse unlisted payees can turn on `set_require_listed_payee`.
- **The bench is ours.** Veto Bench's 100 scenarios and the screening prompt were written by the same team, so read 50/50 as a result on this set, not a general catch rate. It pays all 42 honest payments to saved suppliers; the 8 it holds are first payments to new suppliers whose only approval sits inside the email, which Veto holds for the owner by design (the caps-plus-allowlist baseline blocks the same 8). Holding a first payment to a new payee is the point: a guard that pays a brand-new payee on an email's word is how "bank details changed" fraud gets paid. Here it costs the owner one tap.
- **Mostly testnet.** The sandbox and the vaults made at `/start` run on NEAR testnet with test tokens. Two paths use real USDC on mainnet: the NEAR Intents Agent API path, scaled down to cents, and one mainnet vault, [treasury.veto-mainnet.near](https://nearblocks.io/address/treasury.veto-mainnet.near). On 12 Nov its first payout, $2 USDC to Base, was screened in the enclave, the vault checked the request and 1Click's signed quote on-chain and paid 1Click's deposit address ([transaction](https://nearblocks.io/txns/41G7RkNdw9VowSAZuJuesoJ4b55MkqSHHs2WKKLPxXbo)), and 1Click delivered exactly $2.00 USDC on Base ([transaction](https://basescan.org/tx/0xc068441ef726e5dd7a9ded95d89165952778416d4687397cb0efdb7c5012f8dd)). On 13 Nov it vetoed a "new wallet" scam with nothing moved ([verdict](https://nearblocks.io/txns/3gEJXNCeyY9m1woHDFDM6UBnm4XdxznqA1HvTFeqsWGd)) and paid a second invoice, $0.90 to Base ([transaction](https://basescan.org/tx/0xd1b668d0639e994be928843066397f05045f50fbb98916adfb7f34029df1ea10)).
- **The sandbox's accounts keep full-access keys** so setup can redeploy them. The app itself only uses function-call keys, and a vault made at `/start` has no access keys at all.
