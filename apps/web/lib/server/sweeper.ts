// Server-only: what the guardian does between payments, for the hosted demo that has no
// always-on guardian. Overrides whose delay has passed are paid out (anyone may call
// execute_override; the demo owner's key does it here), and screenings that missed their
// deadline are expired so they fail closed instead of sitting in "Pending".
import { teraToGas } from "near-api-js";
import { evmParamsFor, payoutIfSigned, quoteFor, type Proposal } from "@veto/core";
import { demo, demoAccounts } from "./demo";
import { approveAndSettle } from "./outlayer";

const busy = new Set<string>();
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

export async function sweep(proposals: Proposal[]) {
  if (!demo.enabled) return;
  const due = proposals.filter(
    (p) =>
      !busy.has(p.id) &&
      ((p.status === "OverridePending" && p.override_executes_at && BigInt(p.override_executes_at) < nowNs()) ||
        (p.status === "Screening" && BigInt(p.screen_deadline) < nowNs())),
  );
  for (const p of due.slice(0, 3)) {
    busy.add(p.id);
    try {
      if (p.status === "Screening") await expire(p);
      else await payOverride(p);
    } catch (e) {
      console.error(`sweep of ${p.id} failed:`, (e as Error).message.replace(/^.*Smart contract panicked: /, ""));
    } finally {
      setTimeout(() => busy.delete(p.id), 60_000);
    }
  }
}

async function expire(p: Proposal) {
  const { guardian } = demoAccounts();
  await guardian.callFunction({ contractId: demo.vaultId, methodName: "expire", args: { id: p.id }, gas: teraToGas("30") });
}

async function payOverride(p: Proposal) {
  const { owner, reader, guardian } = demoAccounts();
  if (!owner) return;
  let evm = null;
  let quote = null;
  if (p.request.chain !== "near") {
    evm = await evmParamsFor(reader, p.request.chain);
    if (!evm) {
      const q = await quoteFor(reader, p, process.env.ONECLICK_JWT);
      quote = { json: q.json, signature: q.signature };
    }
  }
  await owner.callFunction({
    contractId: demo.vaultId,
    methodName: "execute_override",
    args: { id: p.id, quote, evm },
    gas: teraToGas("300"),
    waitUntil: "FINAL",
  });
  const after = await reader.proposal(p.id);
  if (after?.external && after.status === "Executing") await approveAndSettle(after);
  if (after?.evm) await payoutIfSigned({ vault: reader, guardian, proposal: after });
}
