import { after } from "next/server";
import { teraToGas } from "near-api-js";
import { allow, demo, demoAccounts } from "@/lib/server/demo";
import { quoteFor } from "@veto/core";
import { approveAndSettle } from "@/lib/server/outlayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Args = Record<string, unknown>;
const id = (a: Args) => typeof a.id === "string" && /^\d{1,10}$/.test(a.id);
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** What the testnet demo owner may do, and the arguments each action accepts. */
const ACTIONS: Record<string, (a: Args) => Args | null> = {
  override_veto: (a) => (id(a) ? { id: a.id } : null),
  cancel_override: (a) => (id(a) ? { id: a.id } : null),
  execute_override: (a) => (id(a) ? { id: a.id, quote: null } : null),
  freeze: () => ({}),
  unfreeze: () => ({}),
  set_mandate: (a) => (text(a.mandate, 2000) ? { mandate: a.mandate } : null),
  add_payee: (a) => (text(a.name, 64) && a.chain === "near" && text(a.address, 64) ? { name: a.name, chain: "near", address: a.address } : null),
  remove_payee: (a) => (a.chain === "near" && text(a.address, 64) ? { chain: "near", address: a.address } : null),
  set_agent_active: (a) => (text(a.agent, 64) && typeof a.active === "boolean" ? { agent: a.agent, active: a.active } : null),
};

export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const { action, args } = (await req.json().catch(() => ({}))) as { action?: string; args?: Args };
  const build = action ? ACTIONS[action] : undefined;
  const parsed = build?.(args ?? {});
  if (!action || !parsed) return Response.json({ error: "unknown action or bad arguments" }, { status: 400 });
  if (!allow("owner", 30, 10 * 60_000)) return Response.json({ error: "too many demo actions; try again in a few minutes" }, { status: 429 });

  const { owner, reader } = demoAccounts();
  if (!owner) return Response.json({ error: "no demo owner is configured" }, { status: 404 });
  try {
    // A cross-chain override pays through NEAR Intents, so it needs a fresh executable quote.
    if (action === "execute_override") {
      const p = await reader.proposal(parsed.id as string);
      if (p && p.request.chain !== "near") {
        const q = await quoteFor(reader, p, process.env.ONECLICK_JWT);
        parsed.quote = { json: q.json, signature: q.signature };
      }
    }
    const outcome = await owner.signAndSendTransaction({
      receiverId: demo.vaultId,
      actions: [(await import("near-api-js")).actions.functionCall(action, parsed, teraToGas("100"), 0n)],
      waitUntil: "FINAL",
    });
    // An override on an OutLayer payment releases it there too: the guardian votes yes.
    if (action === "execute_override") {
      after(async () => {
        const p = await reader.proposal(parsed.id as string);
        if (p?.external && p.status === "Executing") await approveAndSettle(p).catch((e) => console.error(`override vote for ${p.id} failed:`, (e as Error).message));
      });
    }
    return Response.json({ tx: outcome.transaction.hash });
  } catch (e) {
    const message = (e as Error).message.replace(/^.*Smart contract panicked: /, "");
    return Response.json({ error: message }, { status: 422 });
  }
}
