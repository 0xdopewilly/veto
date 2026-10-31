import { vaultSnapshot } from "@/lib/server/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { state, stale } = await vaultSnapshot();
    // Balances are bigints; send them as strings.
    const body = JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...(stale ? { "X-Veto-Stale": "1" } : {}) },
    });
  } catch (e) {
    return Response.json({ error: `Could not reach the vault: ${(e as Error).message}` }, { status: 503 });
  }
}
