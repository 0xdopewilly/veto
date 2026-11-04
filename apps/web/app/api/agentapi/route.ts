import { agentApiSnapshot } from "@/lib/server/agentapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: { at: number; body: unknown } | null = null;

/** The demo's NEAR Intents Agent API wallet: owner, policy in force, balance and Veto's grant. */
export async function GET() {
  if (cached && Date.now() - cached.at < 30_000) return Response.json(cached.body);
  try {
    const snapshot = await agentApiSnapshot();
    if (!snapshot) return Response.json({ enabled: false });
    cached = { at: Date.now(), body: { enabled: true, ...snapshot } };
    return Response.json(cached.body);
  } catch (e) {
    return Response.json({ error: `Could not reach the Agent API: ${(e as Error).message}` }, { status: 503 });
  }
}
