// Server-only: whether NEAR AI Cloud is serving the screening model, so the inbox can say so before
// a visitor starts a payment that can't be screened. It asks for the model's enclave report (public,
// keyless): NEAR AI answers it when the model's enclaves are up, and a 5xx ("no provider found")
// while they're offline, even when the rest of NEAR AI Cloud answers. A dropped connection or a
// timeout is down too. The timeout is generous: saying the model is down while it's only slow would
// be worse than saying nothing, since every action still explains itself if NEAR AI can't serve it.
import { NEARAI_BASE_URL } from "@veto/core";

const EVERY_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

interface Probe {
  known: boolean | null;
  checkedAt: number;
  pending: Promise<boolean> | null;
}
const probes = new Map<string, Probe>();

function check(model: string, p: Probe): Promise<boolean> {
  if (!p.pending) {
    p.checkedAt = Date.now();
    const url = `${NEARAI_BASE_URL}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;
    p.pending = fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .then(
        async (res) => {
          // Only the status matters; the report itself is large.
          await res.body?.cancel().catch(() => {});
          return res.status < 500;
        },
        () => false,
      )
      .then((up) => (p.known = up))
      .finally(() => {
        p.pending = null;
      });
  }
  return p.pending;
}

/**
 * The last answer this server instance has for `model`, re-checked in the background at most once a
 * minute. A fresh instance waits up to `waitMs` for its first answer and says "unknown" without one.
 */
export async function nearAiStatus(model: string, waitMs = 2_500): Promise<"up" | "down" | "unknown"> {
  let p = probes.get(model);
  if (!p) probes.set(model, (p = { known: null, checkedAt: 0, pending: null }));
  if (Date.now() - p.checkedAt > EVERY_MS) void check(model, p);
  if (p.known !== null) return p.known ? "up" : "down";
  const first = await Promise.race([check(model, p), new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))]);
  return first === null ? "unknown" : first ? "up" : "down";
}
