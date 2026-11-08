import { allow, demo, demoAccounts } from "@/lib/server/demo";
import { restoreSandbox } from "@/lib/server/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A new visitor to the shared sandbox starts from its default rules (see lib/server/sandbox.ts). */
export async function POST() {
  if (!demo.enabled || !demoAccounts().owner) return Response.json({ restored: [] });
  if (!allow("reset", 20, 10 * 60_000)) return Response.json({ restored: [] });
  try {
    return Response.json({ restored: await restoreSandbox() });
  } catch (e) {
    return Response.json({ error: `Could not reset the sandbox: ${(e as Error).message}` }, { status: 503 });
  }
}
