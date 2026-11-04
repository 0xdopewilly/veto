import { after } from "next/server";
import { isKnownVault, SANDBOX_ID } from "@/lib/config";
import { vaultAccounts } from "@/lib/server/demo";
import { NoSuchVault, vaultSnapshot } from "@/lib/server/state";
import { sweep } from "@/lib/server/sweeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The sweep after the response may pay out a due override (and its OutLayer or Base leg).
export const maxDuration = 120;

export async function GET(req: Request) {
  const vaultId = new URL(req.url).searchParams.get("vault") || SANDBOX_ID;
  if (!isKnownVault(vaultId)) return Response.json({ error: "not a Veto vault this app knows" }, { status: 404 });
  try {
    const { state, stale } = await vaultSnapshot(vaultId);
    const accounts = vaultAccounts(vaultId);
    if (accounts) after(() => sweep(accounts, state.proposals));
    // Balances are bigints; send them as strings.
    const body = JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(stale ? { "X-Veto-Stale": "1" } : {}) },
    });
  } catch (e) {
    if (e instanceof NoSuchVault) return Response.json({ error: "That vault doesn't exist." }, { status: 404 });
    return Response.json({ error: `Could not reach the vault: ${(e as Error).message}` }, { status: 503 });
  }
}
