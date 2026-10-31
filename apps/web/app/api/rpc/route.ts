import { RPC_ENDPOINTS } from "@/lib/server/rpc";

// NEAR JSON-RPC relay for the browser. Identical calls within a short window share one
// upstream request, and a throttled or failing RPC falls back to the next one.
const UPSTREAMS = RPC_ENDPOINTS;
const TTL_MS = 2000;
const STALE_OK_MS = 60_000;
const cache = new Map<string, { at: number; body: Promise<string> }>();
const lastGood = new Map<string, { at: number; body: string }>();

async function forward(payload: string): Promise<string> {
  let last = "";
  // Two rounds over every endpoint, backing off when they rate-limit us.
  for (let round = 0; round < 2; round++) {
    for (const url of UPSTREAMS) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, cache: "no-store" });
        const text = await res.text();
        if (res.ok) return text;
        last = `${res.status} from ${url}`;
      } catch (e) {
        last = (e as Error).message;
      }
    }
    await new Promise((r) => setTimeout(r, 400 * (round + 1)));
  }
  throw new Error(last);
}

export async function POST(req: Request) {
  const payload = await req.text();
  if (payload.length > 64 * 1024) return Response.json({ error: "request too large" }, { status: 413 });
  // The JSON-RPC id differs per call; cache on everything else.
  const key = payload.replace(/"id":\s*("[^"]*"|\d+)/, '"id":0');
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k);
  let entry = cache.get(key);
  if (!entry) {
    entry = { at: now, body: forward(payload) };
    cache.set(key, entry);
    entry.body.catch(() => cache.delete(key));
  }
  try {
    const body = await entry.body;
    lastGood.set(key, { at: Date.now(), body });
    const id = payload.match(/"id":\s*("[^"]*"|\d+)/)?.[1];
    return new Response(id ? body.replace(/"id":\s*("[^"]*"|\d+)/, `"id":${id}`) : body, {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Serve the last good answer for this exact call rather than fail the screen.
    const stale = lastGood.get(key);
    if (stale && Date.now() - stale.at < STALE_OK_MS) {
      const id = payload.match(/"id":\s*("[^"]*"|\d+)/)?.[1];
      return new Response(id ? stale.body.replace(/"id":\s*("[^"]*"|\d+)/, `"id":${id}`) : stale.body, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Veto-Stale": "1" },
      });
    }
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
