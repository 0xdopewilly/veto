# Veto web app

The owner's view of a Veto vault, as one responsive Next.js app: the mobile layout on phones (installable as a PWA) and the desktop layout from 900 px up. It reads the vault contract live over NEAR RPC and sends owner actions from a NEAR wallet.

## Run it

From the repository root:

```sh
pnpm install
pnpm --filter @veto/web dev      # http://localhost:3000
pnpm --filter @veto/web build && pnpm --filter @veto/web start
```

Open `/app` to see the testnet sandbox vault, read live. Anyone can browse it. The agent's inbox (**Try it**) and the sandbox's owner actions need the demo accounts that `pnpm demo:setup` writes to `apps/web/.env.local`; without them the inbox says so, and everything else still works. In a vault you create at `/start`, owner actions (override, cancel, freeze, mandate, payees, limits, agents) are signed by your NEAR wallet.

## Pages

| Path | What it shows |
| --- | --- |
| `/` | Landing page |
| `/docs` | How it works, step by step |
| `/bench` | Veto Bench scenarios and results |
| `/start`, `/start/vault` | Welcome, and creating your own vault with a NEAR wallet |
| `/app` | Home: what needs your decision, balance, this period's spend, activity, the agent's inbox |
| `/app/decisions` | Activity: what needs your decision, then every payment, newest first |
| `/app/decisions/[id]` | One decision: vetoed, screening, override pending (with countdown), paid, or closed |
| `/app/decisions/[id]/proof` | How the verdict was signed and checked, with links to verify it |
| `/app/rules` | Rules: the mandate, contract limits and time-locked raises, payees and blocked lookalikes, freeze. `/app/mandate` and `/app/payees` redirect here |
| `/app/agents` | Agents, their vault-scoped keys and recent activity, the OutLayer and Agent API wallets |

## Configuration

| Variable | Default |
| --- | --- |
| `NEXT_PUBLIC_NETWORK` | `testnet` |
| `NEXT_PUBLIC_VAULT_ID` | `treasury.veto-rhwe0krb.testnet` |
| `NEXT_PUBLIC_VAULT_NAME` | `Lagoon Goods` (display name; vaults have no name on-chain) |
| `NEXT_PUBLIC_FACTORY_ID` | `vaults.veto-rhwe0krb.testnet` (the factory whose vaults `/app?vault=<id>` opens) |
| `NEXT_PUBLIC_RPC_URL` | FastNEAR public RPC for the network |

No secrets are needed to browse. `pnpm demo:setup` writes the demo's keys to `apps/web/.env.local`: the agent's, the guardian's and the demo owner's function-call keys (each limited to its vault methods), the OutLayer approver's key and the OutLayer wallet's API key, and the labelled test signer's key.

## Bench results

`/bench` reads `public/bench/results.json`, which `node bench/publish.ts` writes from `bench/results/`. A model with no results shows `[Not run yet]`. The file's shape:

```json
{
  "ran_at": "2026-11-08T12:00:00Z",
  "models": [
    { "model": "Qwen/Qwen3-VL-30B-A3B-Instruct", "attacks_caught": 50, "attacks_total": 50, "normal_blocked": 8, "normal_total": 50, "median_ms": 1465 }
  ]
}
```

## Motion

Timings follow `docs/motion.md`: push and pop slides between levels on phones, cross-fade and rise on desktop, the VETOED stamp, the circuit building node by node, and the V loader for every wait. With reduced motion turned on, these become short fades.
