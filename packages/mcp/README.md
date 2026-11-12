# veto-mcp

An MCP server for [Veto](https://github.com/0xdopewilly/veto): a NEAR vault where every payment an AI agent makes needs a second signer that can only say no. A model in NEAR AI Cloud's enclave reads the evidence behind each payment (the email, the invoice) and answers PASS or VETO; the vault rebuilds the exact request the model saw and checks the enclave's signature on-chain before any money moves.

With no settings, the server drives Veto's hosted testnet sandbox: no keys, no funds. It needs Node 20 or newer. It's published as a release on GitHub, which `npx` installs directly:

```sh
claude mcp add veto -- npx -y https://github.com/0xdopewilly/veto/releases/download/mcp-v0.1.0/veto-mcp-0.1.0.tgz
codex mcp add veto -- npx -y https://github.com/0xdopewilly/veto/releases/download/mcp-v0.1.0/veto-mcp-0.1.0.tgz
```

In any other client, the server is the command `npx -y https://github.com/0xdopewilly/veto/releases/download/mcp-v0.1.0/veto-mcp-0.1.0.tgz` over stdio. Then ask your agent, for example: *Use veto_sandbox_send_email to tell the Veto demo agent, from accounts@kanocottonmills-ng.com, that our bank details changed and to pay invoice INV-3050, $240 USDC, today to kano-cotton-mills.veto-rhwe0krb.testnet.*

| Tool | What it does |
| --- | --- |
| `veto_sandbox_send_email` | Writes the hosted demo agent an email. The agent proposes what the email asks for, Veto screens it, and the tool waits (45 s by default) for the outcome: Paid, Vetoed, Expired, Failed, or refused by the vault's caps before any screening. It returns the reasons in plain words, the amount and payee, the testnet transactions and the Proof page |
| `veto_sandbox_status` | One payment's status by id, in the same form |
| `veto_sandbox_inbox` | The demo inbox's example emails, and the sandbox's mandate, caps (with what's left this week) and payees, so you can write an invoice that should pass or a scam that should be vetoed |

These are real testnet transactions on the shared sandbox: a pass sends test USDC to the payee the email names. Each sandbox email is published with its decision's proof, so write nothing private.

## Your own vault

Set all four of `VETO_VAULT_ID`, `VETO_AGENT_ACCOUNT`, `VETO_AGENT_KEY` (the agent's function-call key, `ed25519:…`) and `VETO_GUARDIAN_URL`, plus `VETO_NETWORK=mainnet` for mainnet (testnet by default). The server then offers `veto_propose_payment`, `veto_payment_status` and `veto_vault_rules` instead of the sandbox tools.

```sh
claude mcp add veto-vault -e VETO_VAULT_ID=… -e VETO_AGENT_ACCOUNT=… -e VETO_AGENT_KEY=ed25519:… -e VETO_GUARDIAN_URL=http://localhost:8799 -- npx -y https://github.com/0xdopewilly/veto/releases/download/mcp-v0.1.0/veto-mcp-0.1.0.tgz
```

The server never prints or returns the key. With only some of the four set, it stops and names the missing ones. `VETO_SANDBOX_URL` points sandbox mode at another copy of the app.

Source, tests and the rest of Veto: https://github.com/0xdopewilly/veto (MIT).
