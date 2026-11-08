// Server-only: puts the shared sandbox's owner settings back the way demo:setup left them, so a
// freeze, a rewritten mandate or a removed supplier from one visitor doesn't greet the next. Only the
// settings a visitor can change through /api/demo/owner are restored; payments and history stay.
import { teraToGas } from "near-api-js";
import { SANDBOX_MANDATE, SANDBOX_SUPPLIERS } from "@veto/core";
import { demo, demoAccounts } from "./demo";

/** Someone who acted as the owner this recently is probably mid-test: leave their changes alone. */
const BUSY_MS = 3 * 60_000;
let lastOwnerAction = 0;
export const noteOwnerAction = () => void (lastOwnerAction = Date.now());

/** Restores the defaults and returns the owner methods it called (none when nothing differed). */
export async function restoreSandbox(): Promise<string[]> {
  const { owner, reader } = demoAccounts();
  if (!owner || Date.now() - lastOwnerAction < BUSY_MS) return [];
  const [config, payees, agents] = await Promise.all([reader.config(), reader.payees(), reader.view<[string, { active: boolean }][]>("get_agents")]);
  const suppliers = SANDBOX_SUPPLIERS.map(({ prefix, name }) => ({ name, address: `${prefix}.${demo.root}` }));

  const calls: [string, Record<string, unknown>][] = [];
  if (config.frozen) calls.push(["unfreeze", {}]);
  if (config.mandate !== SANDBOX_MANDATE) calls.push(["set_mandate", { mandate: SANDBOX_MANDATE }]);
  // Visitors can only add and remove NEAR payees, so the Base payees (freight, payroll) never change.
  for (const p of payees) if (p.chain === "near" && !suppliers.some((s) => s.address === p.address)) calls.push(["remove_payee", { chain: "near", address: p.address }]);
  for (const s of suppliers) if (!payees.some((p) => p.chain === "near" && p.address === s.address)) calls.push(["add_payee", { name: s.name, chain: "near", address: s.address }]);
  for (const [agent, info] of agents) if (!info.active) calls.push(["set_agent_active", { agent, active: true }]);

  // One transaction each: the demo owner's function-call key can sign only a single call at a time.
  for (const [methodName, args] of calls) await owner.callFunction({ contractId: demo.vaultId, methodName, args, gas: teraToGas("30") });
  return calls.map(([m]) => m);
}
