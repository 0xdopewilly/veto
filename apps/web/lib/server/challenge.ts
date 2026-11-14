// Server-only: the numbers on "Can you fool Veto?" and each player's progress up the ladder.
//
// The counts come from the shared sandbox's own record: every payment anyone has asked it for, and
// the reasons in each signed verdict. A player's progress is kept as one empty file per trick caught,
// under a keyed hash of their address, so nothing stored names them.
import { createHash, createHmac } from "node:crypto";
import { list, put } from "@vercel/blob";
import { VaultReader } from "@veto/core/vault";
import type { Proposal } from "@veto/core/proposal";
import { SANDBOX_ID } from "@/lib/config";
import { LADDER, sandboxFrom, type Sandbox } from "@/lib/challenge";
import { outcomeOf } from "@/lib/decision";
import { formatShort, shortAddress, type AssetMeta } from "@/lib/format";
import { serverRpc } from "./rpc";
import { vaultSnapshot } from "./state";

export interface Attempt {
  id: string;
  outcome: "vetoed" | "paid" | "pending" | "closed";
  amount: string;
  payee: string;
  /** Ladder codes in the verdict, in ladder order. */
  tricks: string[];
  /** Milliseconds since the epoch. */
  at: number;
}

export interface ChallengeStats {
  readAt: number;
  asked: number;
  vetoed: number;
  paid: number;
  tricks: Record<string, { caught: number; last: number | null }>;
  recent: Attempt[];
  sandbox: Sandbox;
}

const FRESH_MS = 20_000;
let cached: { at: number; stats: ChallengeStats } | null = null;
let inflight: Promise<ChallengeStats> | null = null;

// Accounts under the sandbox's own root read short ("enugu-textiles"), the way the app shows them.
const ROOT = SANDBOX_ID.slice(SANDBOX_ID.indexOf(".") + 1);
const label = (address: string) => (address.endsWith(`.${ROOT}`) && !address.slice(0, -ROOT.length - 1).includes(".") ? address.slice(0, -ROOT.length - 1) : shortAddress(address));
const ms = (nanos: string | null | undefined) => (nanos ? Number(BigInt(nanos) / 1_000_000n) : 0);
const order = new Map(LADDER.map((t, i) => [t.code as string, i]));

async function load(): Promise<ChallengeStats> {
  const [{ state }, proposals] = await Promise.all([vaultSnapshot(SANDBOX_ID), new VaultReader(SANDBOX_ID, serverRpc()).allProposals()]);
  const meta = (asset: string): AssetMeta => state.assets[asset] ?? { symbol: asset.split(":").pop()?.toUpperCase() ?? "", decimals: 0 };
  const tricks: ChallengeStats["tricks"] = Object.fromEntries(LADDER.map((t) => [t.code, { caught: 0, last: null }]));
  let vetoed = 0;
  let paid = 0;
  for (const p of proposals) {
    const o = outcomeOf(p.status);
    if (o === "paid") paid++;
    if (o !== "vetoed") continue;
    vetoed++;
    const at = ms(p.verdict?.recorded_at ?? p.created_at);
    for (const code of p.verdict?.reasons ?? []) {
      const t = tricks[code];
      if (!t) continue;
      t.caught++;
      t.last = Math.max(t.last ?? 0, at);
    }
  }
  const decided = (p: Proposal) => p.status !== "Screening" && p.status !== "Expired" && p.status !== "Failed";
  const recent = proposals
    .filter(decided)
    .slice(0, 8)
    .map(
      (p): Attempt => ({
        id: p.id,
        outcome: outcomeOf(p.status),
        amount: formatShort(p.request.amount, meta(p.request.asset)),
        payee: state.payees.find((x) => x.chain === p.request.chain && x.address === p.request.payee)?.name ?? label(p.request.payee),
        tricks: (p.verdict?.reasons ?? []).filter((c) => order.has(c)).sort((a, b) => order.get(a)! - order.get(b)!),
        at: ms(p.verdict?.recorded_at ?? p.created_at),
      }),
    );
  return { readAt: Date.now(), asked: proposals.length, vetoed, paid, tricks, recent, sandbox: sandboxFrom(state.payees) };
}

/** The sandbox's challenge numbers, at most a few seconds old. */
export async function challengeStats(): Promise<ChallengeStats> {
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.stats;
  inflight ??= load()
    .then((stats) => {
      cached = { at: Date.now(), stats };
      return stats;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/* ------------------------------------------------------------- a player's progress */

const token = () => process.env.BLOB_READ_WRITE_TOKEN?.trim() || "";

/** A stable name for a sender that can't be turned back into their address without the server's secret. */
function playerKey(sender: string): string {
  const secret = createHash("sha256").update(`veto-challenge|${token()}`).digest();
  return createHmac("sha256", secret).update(sender.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * Records the tricks this sender just got caught on and returns every trick they've been caught
 * on so far. Null when there is nowhere to keep it (no blob store), so the reply just leaves the
 * progress out. Never throws: a reply must not fail over a scoreboard.
 */
export async function recordCaught(sender: string, codes: string[]): Promise<Set<string> | null> {
  if (!token() || !sender) return null;
  const dir = `challenge/${playerKey(sender)}/`;
  try {
    const { blobs } = await list({ prefix: dir, limit: 50 });
    const done = new Set(blobs.map((b) => b.pathname.slice(dir.length)).filter((c) => order.has(c)));
    const fresh = codes.filter((c) => order.has(c) && !done.has(c));
    await Promise.all(
      fresh.map((c) => put(`${dir}${c}`, "1", { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "text/plain" })),
    );
    for (const c of fresh) done.add(c);
    return done;
  } catch (e) {
    console.error("challenge progress failed:", (e as Error).message);
    return null;
  }
}
