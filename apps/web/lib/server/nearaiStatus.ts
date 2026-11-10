// Server-only: whether NEAR AI Cloud answers at all, so the inbox can say so before a visitor
// starts a payment that can't be screened. Any reply below 500 counts as up (a keyless call may be
// refused and still prove the service is there); a 5xx, a dropped connection or a timeout is down.
// The timeout is generous: telling a visitor NEAR AI is down while it's only slow would be worse
// than saying nothing, since every action still explains itself if NEAR AI doesn't answer.
import { NEARAI_BASE_URL } from "@veto/core";

const EVERY_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;

let known: boolean | null = null;
let checkedAt = 0;
let pending: Promise<boolean> | null = null;

function check(): Promise<boolean> {
  if (!pending) {
    checkedAt = Date.now();
    pending = fetch(`${NEARAI_BASE_URL}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      .then(
        async (res) => {
          await res.body?.cancel().catch(() => {});
          return res.status < 500;
        },
        () => false,
      )
      .then((up) => (known = up))
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/**
 * The last answer this server instance has, re-checked in the background at most once a minute. A
 * fresh instance waits up to `waitMs` for its first answer and says "unknown" if it hasn't one yet.
 */
export async function nearAiStatus(waitMs = 2_500): Promise<"up" | "down" | "unknown"> {
  if (Date.now() - checkedAt > EVERY_MS) void check();
  if (known !== null) return known ? "up" : "down";
  const first = await Promise.race([check(), new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))]);
  return first === null ? "unknown" : first ? "up" : "down";
}
