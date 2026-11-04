import { Account, actions, teraToGas, type KeyPairString } from "near-api-js";
import { allow, demo } from "@/lib/server/demo";
import { accountBalance, serverRpc } from "@/lib/server/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this a wallet can't pay for a vault's creation (200 Tgas reserved) at testnet prices. */
const LOW = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
const GIFT = "0.2";
const TESTNET_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)+testnet$/;
const IMPLICIT = /^[0-9a-f]{64}$/;

/**
 * New testnet wallets (Meteor makes them empty) can't pay gas for anything. This sends a wallet
 * 0.2 test NEAR, once, through the factory's send_gas method. The server's key on the factory
 * can call nothing else, and the factory refuses a second gift to the same account.
 */
export async function POST(req: Request) {
  const key = process.env.DEMO_FACTORY_GAS_KEY?.trim();
  if (!demo.enabled || !demo.factory || !key) return Response.json({ error: "Free test NEAR isn't switched on here." }, { status: 404 });
  const { accountId } = (await req.json().catch(() => ({}))) as { accountId?: unknown };
  const id = typeof accountId === "string" ? accountId.trim().toLowerCase() : "";
  if (!TESTNET_ACCOUNT.test(id) && !IMPLICIT.test(id)) return Response.json({ error: "That isn't a NEAR testnet account." }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(`gas:${ip}`, 3, 60 * 60_000) || !allow("gas", 40, 60 * 60_000)) {
    return Response.json({ error: "Lots of wallets asked for test NEAR just now. Try again in a few minutes." }, { status: 429 });
  }

  const balance = await accountBalance(id);
  if (balance === undefined) return Response.json({ error: "Couldn't reach NEAR testnet. Try again in a moment." }, { status: 503 });
  if (balance === null && !IMPLICIT.test(id)) return Response.json({ error: "That wallet doesn't exist on testnet yet." }, { status: 404 });
  if (balance !== null && balance >= LOW) return Response.json({ sent: false, enough: true });

  const rpc = serverRpc();
  if (await rpc.callFunction({ contractId: demo.factory, method: "got_gas", args: { account_id: id } })) {
    return Response.json({ error: "This wallet already got its free test NEAR. A testnet faucet can send more." }, { status: 409 });
  }
  try {
    const factory = new Account(demo.factory, rpc, key as KeyPairString);
    const outcome = await factory.signAndSendTransaction({
      receiverId: demo.factory,
      actions: [actions.functionCall("send_gas", { account_id: id }, teraToGas("15"), 0n)],
      waitUntil: "FINAL",
    });
    const failure = (outcome.status as { Failure?: unknown }).Failure;
    if (failure) throw new Error(JSON.stringify(failure));
    return Response.json({ sent: true, amount: GIFT, tx: outcome.transaction.hash });
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (/already got its test NEAR/.test(message)) return Response.json({ error: "This wallet already got its free test NEAR." }, { status: 409 });
    if (/out of test NEAR/.test(message)) return Response.json({ error: "Veto's test NEAR for gas has run out for now. Try again later." }, { status: 503 });
    return Response.json({ error: "Couldn't send test NEAR right now. Try again in a moment." }, { status: 502 });
  }
}
