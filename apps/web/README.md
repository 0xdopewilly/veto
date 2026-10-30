# Veto web app

The owner's view of a Veto vault, as one responsive Next.js app: the mobile layout on phones (installable as a PWA) and the desktop layout from 900 px up. It reads the vault contract live over NEAR RPC and sends owner actions from a NEAR wallet.

## Run it

From the repository root:

```sh
pnpm install
pnpm --filter @veto/web dev      # http://localhost:3000
pnpm --filter @veto/web build && pnpm --filter @veto/web start
```

Open `/app` to see the testnet demo vault. Anyone can browse it read-only. Owner actions (override, cancel, freeze, mandate, payees, limits, agents) ask you to connect the owner's NEAR wallet; other accounts see why they can't act.

## Pages

| Path | What it shows |
| --- | --- |
| `/` | Landing page |
| `/start`, `/start/vault` | Phone onboarding |
| `/app` | Overview: decisions that need you, balance, this period's spend, activity |
| `/app/decisions` | Every proposal, newest first |
| `/app/decisions/[id]` | One decision: vetoed, screening, override pending (with countdown), paid, or closed |
| `/app/decisions/[id]/proof` | How the verdict was signed and checked, with links to verify it |
| `/app/mandate` | The mandate, contract limits, time-locked raises |
| `/app/payees` | Saved payees, adding and removing them, blocked lookalikes |
| `/app/agents` | Agents, their vault-scoped keys and recent activity |
| `/bench` | Veto Bench scenarios and results |

## Configuration

| Variable | Default |
| --- | --- |
| `NEXT_PUBLIC_NETWORK` | `testnet` |
| `NEXT_PUBLIC_VAULT_ID` | `treasury.veto-lagoon-dygj2w.testnet` |
| `NEXT_PUBLIC_VAULT_NAME` | `Lagoon Goods` (display name; vaults have no name on-chain) |
| `NEXT_PUBLIC_RPC_URL` | FastNEAR public RPC for the network |

No secrets are needed.

## Bench results

`/bench` shows `[Not run yet]` until `public/bench/results.json` exists. Its shape, with placeholder values:

```json
{
  "ran_at": "2026-11-08T12:00:00Z",
  "models": [
    { "model": "z-ai/glm-5.3-flash", "attacks_caught": 48, "attacks_total": 50, "normal_blocked": 2, "normal_total": 50, "median_ms": 2100 }
  ]
}
```

## Motion

Timings follow `docs/motion.md`: push and pop slides between levels on phones, cross-fade and rise on desktop, the VETOED stamp, the circuit building node by node, and the V loader for every wait. With reduced motion turned on, these become short fades.
