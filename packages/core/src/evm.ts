// EVM payouts from the vault's own address, signed by NEAR Chain Signatures. The vault builds
// and gets the transfer signed on-chain; this side only reads the chain (nonce, fees), turns
// the vault's signature into a raw transaction, broadcasts it and reports the hash back.
import { getAddress, keccak256, Signature, Transaction } from "ethers";
import { base58 } from "@scure/base";
import { teraToGas, type Account } from "near-api-js";
import type { Proposal } from "./proposal.ts";
import type { VaultReader } from "./vault.ts";

export const MPC_CONTRACT = { testnet: "v1.signer-prod.testnet", mainnet: "v1.signer" } as const;

/** Public RPCs by chain id; override with EVM_RPC_<chainId>. */
const RPC: Record<string, string> = {
  "84532": "https://sepolia.base.org",
  "8453": "https://mainnet.base.org",
  "11155111": "https://ethereum-sepolia-rpc.publicnode.com",
};
export const EXPLORER: Record<string, string> = {
  "84532": "https://sepolia.basescan.org",
  "8453": "https://basescan.org",
  "11155111": "https://sepolia.etherscan.io",
};

export interface EvmRoute {
  chain_id: string;
  asset: string;
  mpc: string;
  path: string;
  max_fee_per_gas: string;
  max_priority_fee_per_gas: string;
}

export function evmRpcUrl(chainId: string) {
  const url = process.env[`EVM_RPC_${chainId}`] ?? RPC[chainId];
  if (!url) throw new Error(`no RPC configured for chain ${chainId}`);
  return url;
}

async function evmCall<T>(chainId: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(evmRpcUrl(chainId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

/** The vault's Chain Signatures route for a chain, if it pays there from its own address. */
export async function evmRouteFor(vault: VaultReader, chain: string): Promise<EvmRoute | undefined> {
  const routes = await vault.view<[string, EvmRoute][]>("get_evm_routes").catch(() => [] as [string, EvmRoute][]);
  return routes.find(([c]) => c === chain)?.[1];
}

/** Nonce and fees for a payout on `chain` from the vault's own address, if it pays there that way. */
export async function evmParamsFor(vault: VaultReader, chain: string) {
  const route = await evmRouteFor(vault, chain);
  return route ? evmParams(route, await vaultEvmAddress(vault, route)) : null;
}

/** Sends a payout the vault has had signed and isn't settled yet; returns the chain's tx hash. */
export async function payoutIfSigned(opts: { vault: VaultReader; guardian: Account; proposal: Proposal }) {
  const e = opts.proposal.evm;
  if (opts.proposal.status !== "Executing" || !e?.r || e.tx_hash) return null;
  const route = await evmRouteFor(opts.vault, opts.proposal.request.chain);
  if (!route) throw new Error(`the vault has no EVM route to ${opts.proposal.request.chain}`);
  return sendEvmPayout({ ...opts, route, from: await vaultEvmAddress(opts.vault, route) });
}

/** The address the MPC network derives for (vault, path): the vault's own address on EVM chains. */
export async function vaultEvmAddress(vault: VaultReader, route: Pick<EvmRoute, "mpc" | "path">): Promise<string> {
  const key = (await vault.rpc.callFunction({
    contractId: route.mpc,
    method: "derived_public_key",
    args: { path: route.path, predecessor: vault.vaultId, domain_id: 0 },
  })) as string;
  const xy = base58.decode(key.replace(/^secp256k1:/, ""));
  if (xy.length !== 64) throw new Error("unexpected derived key");
  return getAddress(`0x${keccak256(xy).slice(-40)}`);
}

export async function evmBalance(chainId: string, address: string) {
  return BigInt(await evmCall<string>(chainId, "eth_getBalance", [address, "latest"]));
}

/** Nonce and fees for the next transfer from `address`, inside the route's caps. */
export async function evmParams(route: EvmRoute, address: string) {
  const [nonce, block, tip] = await Promise.all([
    evmCall<string>(route.chain_id, "eth_getTransactionCount", [address, "pending"]),
    evmCall<{ baseFeePerGas: string }>(route.chain_id, "eth_getBlockByNumber", ["latest", false]),
    evmCall<string>(route.chain_id, "eth_maxPriorityFeePerGas", []).catch(() => "0x3b9aca00"),
  ]);
  const cap = BigInt(route.max_fee_per_gas);
  const priority = [BigInt(tip), BigInt(route.max_priority_fee_per_gas)].reduce((a, b) => (a < b ? a : b));
  const wanted = BigInt(block.baseFeePerGas) * 2n + priority;
  const maxFee = wanted < cap ? wanted : cap;
  if (maxFee < BigInt(block.baseFeePerGas) + priority) throw new Error("gas on this chain is above the route's fee cap right now");
  return { nonce: String(BigInt(nonce)), max_fee_per_gas: String(maxFee), max_priority_fee_per_gas: String(priority) };
}

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/** The raw transaction for a payout the vault has had signed, checked to come from `from`. */
export function signedPayout(p: Proposal, from: string) {
  const e = p.evm;
  if (!e?.r || !e.s || e.y_parity == null) throw new Error("the payout is not signed yet");
  // Ethereum only accepts low-s signatures; flip a high-s one (and its parity) to its twin.
  let s = BigInt(`0x${e.s}`);
  let yParity = e.y_parity;
  if (s > SECP256K1_N / 2n) {
    s = SECP256K1_N - s;
    yParity ^= 1;
  }
  const tx = Transaction.from({
    type: 2,
    chainId: BigInt(e.chain_id),
    nonce: Number(e.nonce),
    maxPriorityFeePerGas: BigInt(e.max_priority_fee_per_gas),
    maxFeePerGas: BigInt(e.max_fee_per_gas),
    gasLimit: 21_000n,
    to: p.request.payee,
    value: BigInt(p.request.amount),
    data: "0x",
    accessList: [],
  });
  if (tx.unsignedHash.slice(2) !== e.signing_hash) throw new Error("rebuilt transaction differs from what the vault signed");
  tx.signature = Signature.from({ r: `0x${e.r}`, s: `0x${s.toString(16).padStart(64, "0")}`, yParity: yParity as 0 | 1 });
  if (getAddress(tx.from!) !== getAddress(from)) throw new Error("signature does not come from the vault's address");
  return tx;
}

/**
 * Broadcasts a signed payout, waits for it to be mined successfully, and reports the hash to the
 * vault. Re-sending one that's already in the mempool or mined is harmless: same bytes, same hash.
 */
export async function sendEvmPayout(opts: { vault: VaultReader; guardian: Account; proposal: Proposal; route: EvmRoute; from: string }) {
  const { vault, guardian, proposal, route } = opts;
  const tx = signedPayout(proposal, opts.from);
  await evmCall<string>(route.chain_id, "eth_sendRawTransaction", [tx.serialized]).catch((e: Error) => {
    if (!/already known|nonce too low|already imported/i.test(e.message)) throw e;
  });
  for (let i = 0; i < 60; i++) {
    const receipt = await evmCall<{ status: string } | null>(route.chain_id, "eth_getTransactionReceipt", [tx.hash]);
    if (receipt) {
      if (receipt.status !== "0x1") throw new Error(`payout ${tx.hash} reverted`);
      await guardian.callFunction({ contractId: vault.vaultId, methodName: "settle_evm", args: { id: proposal.id, tx_hash: tx.hash }, gas: teraToGas("30") });
      return tx.hash!;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`payout ${tx.hash} was not mined in time`);
}
