// Server-only: what the guardian does between payments, for the hosted demo that has no
// always-on guardian. Overrides whose delay has passed are paid out (anyone may call
// execute_override: the sandbox's demo owner key does it there, the shared guardian on owned
// vaults), and screenings that missed their deadline are expired so they fail closed instead of
// sitting in "Pending".
import { teraToGas } from "near-api-js";
import { evmParamsFor, payoutIfSigned, quoteFor, type Proposal } from "@veto/core";
import type { VaultAccounts } from "./demo";
import { approveAndSettle } from "./outlayer";

const busy = new Set<string>();
const nowNs = () => BigInt(Date.now()) * 1_000_000n;

export async function sweep(accounts: VaultAccounts, proposals: Proposal[]) {
  const key = (p: Proposal) => `${accounts.vaultId}#${p.id}`;
  const due = proposals.filter(
    (p) =>
      !busy.has(key(p)) &&
      ((p.status === "OverridePending" && p.override_executes_at && BigInt(p.override_executes_at) < nowNs()) ||
        (p.status === "Screening" && BigInt(p.screen_deadline) < nowNs())),
  );
  for (const p of due.slice(0, 3)) {
    busy.add(key(p));
    try {
      if (p.status === "Screening") await expire(accounts, p);
      else await payOverride(accounts, p);
    } catch (e) {
      console.error(`sweep of ${key(p)} failed:`, (e as Error).message.replace(/^.*Smart contract panicked: /, ""));
    } finally {
      setTimeout(() => busy.delete(key(p)), 60_000);
    }
  }
}

async function expire({ vaultId, guardian }: VaultAccounts, p: Proposal) {
  await guardian.callFunction({ contractId: vaultId, methodName: "expire", args: { id: p.id }, gas: teraToGas("30") });
}

async function payOverride({ vaultId, owner, reader, guardian }: VaultAccounts, p: Proposal) {
  const caller = owner ?? guardian;
  let evm = null;
  let quote = null;
  if (p.request.chain !== "near") {
    evm = await evmParamsFor(reader, p.request.chain);
    if (!evm) {
      const q = await quoteFor(reader, p, process.env.ONECLICK_JWT);
      quote = { json: q.json, signature: q.signature };
    }
  }
  await caller.callFunction({
    contractId: vaultId,
    methodName: "execute_override",
    args: { id: p.id, quote, evm },
    // A NEAR payout needs far less than a cross-chain one, and the call reserves all of it up front.
    gas: teraToGas(evm || quote ? "300" : "100"),
    waitUntil: "FINAL",
  });
  const after = await reader.proposal(p.id);
  if (after?.external && after.status === "Executing") await approveAndSettle(after);
  if (after?.evm) await payoutIfSigned({ vault: reader, guardian, proposal: after });
}
