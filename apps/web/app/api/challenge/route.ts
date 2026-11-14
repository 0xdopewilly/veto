import { challengeStats } from "@/lib/server/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The challenge page's live numbers: the same read the page renders with, refreshed while it's open. */
export async function GET() {
  try {
    return Response.json(await challengeStats(), { headers: { "Cache-Control": "public, max-age=10, s-maxage=10" } });
  } catch (e) {
    return Response.json({ error: `Could not reach the sandbox vault: ${(e as Error).message}` }, { status: 503 });
  }
}
