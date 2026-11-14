import { after } from "next/server";
import { teraToGas } from "near-api-js";
import { allow, demo, demoAccounts, visitor } from "@/lib/server/demo";
import { noteOwnerAction } from "@/lib/server/sandbox";
import { evmParamsFor, payoutIfSigned, quoteFor } from "@veto/core";
import { approveAndSettle, rejectHeld } from "@/lib/server/outlayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An override on an OutLayer payment votes and settles after the response.
export const maxDuration = 120;

type Args = Record<string, unknown>;
const id = (a: Args) => typeof a.id === "string" && /^\d{1,10}$/.test(a.id);
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** What the testnet demo owner may do, and the arguments each action accepts. */
const ACTIONS: Record<string, (a: Args) => Args | null> = {
  override_veto: (a) => (id(a) ? { id: a.id } : null),
  // Let a held first payment through and save its payee, so the next one isn't held: two calls, one transaction.
  override_and_save: (a) => (id(a) && text(a.name, 64) ? { id: a.id, name: (a.name as string).trim() } : null),
  cancel_override: (a) => (id(a) ? { id: a.id } : null),
  execute_override: (a) => (id(a) ? { id: a.id, quote: null } : null),
  keep_blocked: (a) => (id(a) ? { id: a.id } : null),
  freeze: () => ({}),
  unfreeze: () => ({}),
  set_mandate: (a) => (text(a.mandate, 2000) ? { mandate: a.mandate } : null),
  add_payee: (a) => (text(a.name, 64) && a.chain === "near" && text(a.address, 64) ? { name: a.name, chain: "near", address: a.address } : null),
  remove_payee: (a) => (a.chain === "near" && text(a.address, 64) ? { chain: "near", address: a.address } : null),
  set_agent_active: (a) => (text(a.agent, 64) && typeof a.active === "boolean" ? { agent: a.agent, active: a.active } : null),
};

export async function POST(req: Request) {
  if (!demo.enabled) return Response.json({ error: "the testnet demo is not configured" }, { status: 404 });
  const { action, args, vault } = (await req.json().catch(() => ({}))) as { action?: string; args?: Args; vault?: string };
  // Only the sandbox has a demo owner; an owned vault's owner signs with their own wallet.
  if (vault && vault !== demo.vaultId) return Response.json({ error: "only the vault's owner can do that, from their wallet" }, { status: 403 });
  const build = action ? ACTIONS[action] : undefined;
  const parsed = build?.(args ?? {});
  if (!action || !parsed) return Response.json({ error: "unknown action or bad arguments" }, { status: 400 });
  if (!allow(`owner:${visitor(req)}`, 20, 10 * 60_000) || !allow("owner", 60, 10 * 60_000)) return Response.json({ error: "too many demo actions; try again in a few minutes" }, { status: 429 });

  const { owner, reader } = demoAccounts();
  if (!owner) return Response.json({ error: "no demo owner is configured" }, { status: 404 });
  try {
    // An override to another chain needs a fresh 1Click quote, or nonce and fees for the vault's EVM address.
    if (action === "execute_override") {
      const p = await reader.proposal(parsed.id as string);
      if (p && p.request.chain !== "near") {
        parsed.evm = await evmParamsFor(reader, p.request.chain);
        if (!parsed.evm) {
          const q = await quoteFor(reader, p, process.env.ONECLICK_JWT);
          parsed.quote = { json: q.json, signature: q.signature };
        }
      }
    }
    // The payee saved is the one the payment goes to, read from the vault, not from the request.
    if (action === "override_and_save") {
      const p = await reader.proposal(parsed.id as string);
      if (!p || p.request.chain !== "near") return Response.json({ error: "the sandbox saves NEAR payees only" }, { status: 422 });
      parsed.address = p.request.payee;
    }
    noteOwnerAction();
    const { actions } = await import("near-api-js");
    const send = (method: string, args: Args, tgas: "100" | "300") =>
      owner.signAndSendTransaction({ receiverId: demo.vaultId, actions: [actions.functionCall(method, args, teraToGas(tgas), 0n)], waitUntil: "FINAL" });
    // The sandbox owner holds a function-call key, which signs one call per transaction: schedule the
    // payment first, then save the payee. (An owner's own wallet sends both in one transaction.)
    const outcome =
      action === "override_and_save"
        ? await send("override_veto", { id: parsed.id }, "100").then(() => send("add_payee", { name: parsed.name, chain: "near", address: parsed.address }, "100"))
        : await send(action, parsed, action === "execute_override" ? "300" : "100");
    // An override on an OutLayer payment releases it there too: the guardian votes yes.
    if (action === "execute_override") {
      after(async () => {
        const p = await reader.proposal(parsed.id as string);
        if (p?.external && p.status === "Executing") await approveAndSettle(p).catch((e) => console.error(`override vote for ${p.id} failed:`, (e as Error).message));
        if (p?.evm) await payoutIfSigned({ vault: reader, guardian: demoAccounts().guardian, proposal: p }).catch((e) => console.error(`override payout for ${p.id} failed:`, (e as Error).message));
      });
    }
    if (action === "keep_blocked") {
      after(async () => {
        const p = await reader.proposal(parsed.id as string);
        if (p?.external) await rejectHeld(p).catch((e) => console.error(`OutLayer reject for ${p.id} failed:`, (e as Error).message));
      });
    }
    return Response.json({ tx: outcome.transaction.hash });
  } catch (e) {
    const message = (e as Error).message.replace(/^.*Smart contract panicked: /, "");
    return Response.json({ error: message }, { status: 422 });
  }
}
