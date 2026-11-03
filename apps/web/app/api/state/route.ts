import { after } from "next/server";
import { vaultSnapshot } from "@/lib/server/state";
import { sweep } from "@/lib/server/sweeper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The sweep after the response may pay out a due override (and its OutLayer or Base leg).
export const maxDuration = 120;

export async function GET() {
  try {
    const { state, stale } = await vaultSnapshot();
    after(() => sweep(state.proposals));
    // Balances are bigints; send them as strings.
    const body = JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(stale ? { "X-Veto-Stale": "1" } : {}) },
    });
  } catch (e) {
    return Response.json({ error: `Could not reach the vault: ${(e as Error).message}` }, { status: 503 });
  }
}
