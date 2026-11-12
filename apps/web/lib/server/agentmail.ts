// Server-only: the demo agent's real inbox on AgentMail (https://docs.agentmail.to). AgentMail
// receives the mail, checks the sender (SPF, DKIM, DMARC) and calls our webhook; we verify the
// webhook's Svix signature, then fetch the message from AgentMail's API ourselves rather than
// trusting the webhook body, and answer the sender through the same API.
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.agentmail.to/v0";
const env = (name: string) => process.env[name]?.trim() || undefined;

export interface AuthResults {
  spf?: string;
  dkim?: string;
  dmarc?: string;
  spf_domain?: string;
  dkim_domain?: string;
  dmarc_domain?: string;
  arc_sealer?: string;
}

export interface InboundMessage {
  inbox_id: string;
  message_id: string;
  from: string;
  subject?: string;
  text?: string;
  extracted_text?: string;
  headers?: Record<string, string>;
  labels?: string[];
  authentication_results?: AuthResults;
}

export interface AgentMail {
  inbox: string;
  secret: string;
  message(id: string): Promise<InboundMessage>;
  reply(id: string, text: string): Promise<void>;
  /** Marks a message, so a webhook retry or a second server instance leaves it alone. */
  label(id: string, label: string): Promise<void>;
}

/** The inbox, when AGENTMAIL_API_KEY and AGENTMAIL_WEBHOOK_SECRET are set. */
export function agentMail(): AgentMail | null {
  const key = env("AGENTMAIL_API_KEY");
  const secret = env("AGENTMAIL_WEBHOOK_SECRET");
  if (!key || !secret) return null;
  const inbox = env("AGENTMAIL_INBOX") ?? "veto-agent@agentmail.to";
  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API}/inboxes/${encodeURIComponent(inbox)}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`AgentMail ${path.split("/").pop()} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  return {
    inbox,
    secret,
    message: (id) => call(`/messages/${encodeURIComponent(id)}`),
    reply: async (id, text) => {
      await call(`/messages/${encodeURIComponent(id)}/reply`, { method: "POST", body: JSON.stringify({ text }) });
    },
    label: async (id, label) => {
      await call(`/messages/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ add_labels: [label], remove_labels: ["unread"] }) });
    },
  };
}

/**
 * Svix's scheme: base64 HMAC-SHA256 of "<svix-id>.<svix-timestamp>.<body>" under the secret after
 * "whsec_", sent as one or more "v1,<sig>" in svix-signature. Rejects anything older than 5 minutes.
 */
export function verifyWebhook(body: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signatures.split(" ").some((s) => {
    const [version, sig] = s.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** "SPF pass (acme.com), DKIM pass (acme.com), DMARC pass (acme.com)", in words the screen can weigh. */
export function senderChecks(auth: AuthResults | undefined, flaggedUnauthenticated: boolean): string {
  const part = (name: string, result?: string, domain?: string) => (result ? `${name} ${result}${domain ? ` (${domain})` : ""}` : null);
  const parts = [part("SPF", auth?.spf, auth?.spf_domain), part("DKIM", auth?.dkim, auth?.dkim_domain), part("DMARC", auth?.dmarc, auth?.dmarc_domain)].filter(Boolean);
  const checks = parts.length ? parts.join(", ") : "no SPF, DKIM or DMARC result";
  const forwarded = auth?.arc_sealer ? `; forwarded by ${auth.arc_sealer}` : "";
  return `${checks}${forwarded}${flaggedUnauthenticated ? "; the receiving server flagged the sender as unauthenticated" : ""}`;
}

/** The bare address in "Name <a@b.c>". */
export const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

/** Bounces, out-of-office and other machine mail: never answered, so two robots can't loop. */
export function isMachineMail(m: InboundMessage, ownInbox: string): boolean {
  const from = addressOf(m.from);
  if (from === ownInbox.toLowerCase() || /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from)) return true;
  const header = (name: string) => Object.entries(m.headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1]?.toLowerCase();
  const auto = header("auto-submitted");
  return (auto !== undefined && auto !== "no") || /bulk|junk|list/.test(header("precedence") ?? "") || header("x-autoreply") !== undefined;
}
