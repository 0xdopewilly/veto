// Server-only: the demo vault's own Base Sepolia address (NEAR Chain Signatures) and whether it
// holds enough test ETH to pay the Base supplier scenario.
import { vaultSnapshot } from "./state";

const env = (key: string) => process.env[key]?.trim() ?? "";
/** The scenario pays 0.0005 ETH; keep a little over for gas. */
const NEEDED = 600_000_000_000_000n;

export async function evmDemo() {
  const { state } = await vaultSnapshot();
  const account = state.evmAccounts?.[0];
  const payee = env("DEMO_EVM_PAYEE");
  if (!account || !payee) return null;
  const balance = state.balances[account.asset] ?? 0n;
  return {
    chain: account.chain,
    asset: account.asset,
    payee,
    address: account.address,
    explorer: account.explorer,
    balance: balance.toString(),
    funded: balance >= NEEDED,
  };
}
