// Veto's MCP server over stdio.   node packages/mcp/src/main.ts
//
// Sandbox mode (default): no keys; drives the hosted testnet demo. VETO_SANDBOX_URL (and
// VETO_SANDBOX_VAULT) point it at another copy of the app, e.g. http://localhost:3000.
// Own-vault mode: set VETO_VAULT_ID, VETO_AGENT_ACCOUNT, VETO_AGENT_KEY and VETO_GUARDIAN_URL
// (and VETO_NETWORK=mainnet for mainnet; testnet by default).
//
// stdout carries the protocol, so anything for a person goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, type Mode } from "./server.ts";
import { Sandbox } from "./sandbox.ts";
import { OwnVault, sdkBackend, vaultEnv } from "./vault.ts";

let mode: Mode;
try {
  const env = vaultEnv(process.env);
  const appUrl = process.env.VETO_SANDBOX_URL?.trim() || undefined;
  if (env) {
    mode = { kind: "vault", vault: new OwnVault(await sdkBackend(env), { appUrl }), secrets: [env.agentKey, env.agentKey.split(":")[1]] };
    console.error(`veto-mcp: own-vault mode, vault ${env.vaultId} on ${env.network}, agent ${env.agentAccountId}`);
  } else {
    mode = { kind: "sandbox", sandbox: new Sandbox({ baseUrl: appUrl, vaultId: process.env.VETO_SANDBOX_VAULT?.trim() || undefined }) };
    console.error(`veto-mcp: sandbox mode, ${mode.sandbox.baseUrl} (NEAR testnet, no keys)`);
  }
} catch (e) {
  const key = process.env.VETO_AGENT_KEY?.trim();
  const message = (e as Error).message;
  console.error(`veto-mcp: ${key ? message.split(key).join("[redacted]") : message}`);
  process.exit(1);
}

await createServer(mode).connect(new StdioServerTransport());
