// Runs the whole loop on testnet with the local dev screener: approves a throwaway
// signer, starts the guardian, runs the demo agent, then removes the signer again.
// For local testing only; the real demo uses the NEAR AI model key.
//   node scripts/e2e-dev.ts
import { spawn } from "node:child_process";
import { Wallet } from "ethers";
import { teraToGas } from "near-api-js";
import { account, loadState } from "./dev-state.ts";

const state = loadState("testnet");
const owner = account(state.root!, "testnet");
const vaultId = state.vault!.accountId;
const signer = Wallet.createRandom();
const call = (methodName: string, args: Record<string, unknown>) =>
  owner.callFunction({ contractId: vaultId, methodName, args, gas: teraToGas("30") });

await call("add_signer", { address: signer.address, model_id: "veto-dev/local-signer" });
console.log(`• approved temporary dev signer ${signer.address}`);
const guardian = spawn(process.execPath, ["services/guardian/src/main.ts"], {
  cwd: new URL("../", import.meta.url),
  env: { ...process.env, VETO_SCREENER: "dev", VETO_DEV_SIGNER_KEY: signer.privateKey, PORT: "8799" },
  stdio: ["ignore", "inherit", "inherit"],
});
try {
  await new Promise((r) => setTimeout(r, 2500));
  const agent = spawn(process.execPath, ["scripts/demo-agent.ts"], { cwd: new URL("../", import.meta.url), stdio: "inherit" });
  const code = await new Promise<number>((r) => agent.on("exit", (c) => r(c ?? 1)));
  if (code !== 0) throw new Error(`demo agent exited with ${code}`);
} finally {
  guardian.kill();
  await call("remove_signer", { address: signer.address });
  console.log("• removed the dev signer");
}
