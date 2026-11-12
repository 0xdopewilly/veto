// Builds the npm package `veto-mcp` from packages/mcp: one bundled ESM file, so `npx -y veto-mcp`
// runs with Node 20+ and no TypeScript, workspace or build step. Writes packages/mcp/npm/ (gitignored).
//   node scripts/pack-mcp.mjs            build
//   node scripts/pack-mcp.mjs --check    also pack it, install the tarball into an empty folder the way
//                                        npx would, and list its tools over a real stdio handshake
import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const out = new URL("packages/mcp/npm/", root);
const pkg = (p) => JSON.parse(readFileSync(new URL(`${p}/package.json`, root), "utf8"));
const mcp = pkg("packages/mcp"), sdk = pkg("packages/sdk"), core = pkg("packages/core");
// Everything from npm stays a dependency; only the workspace's own code is bundled in.
const deps = { ...core.dependencies, ...sdk.dependencies, ...mcp.dependencies };
for (const name of Object.keys(deps)) if (name.startsWith("@veto/")) delete deps[name];

rmSync(out, { recursive: true, force: true });
mkdirSync(new URL("dist/", out), { recursive: true });
const result = await build({
  entryPoints: [fileURLToPath(new URL("packages/mcp/src/main.ts", root))],
  outdir: fileURLToPath(new URL("dist/", out)),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: Object.keys(deps).flatMap((d) => [d, `${d}/*`]),
  banner: { js: "#!/usr/bin/env node" },
  metafile: true,
  legalComments: "none",
});
// Keep only the dependencies the bundle still imports.
const used = new Set();
for (const file of Object.values(result.metafile.outputs)) for (const i of file.imports) if (i.external) used.add(i.path.startsWith("@") ? i.path.split("/").slice(0, 2).join("/") : i.path.split("/")[0]);
const dependencies = Object.fromEntries(Object.entries(deps).filter(([d]) => used.has(d)).sort());

writeFileSync(
  new URL("package.json", out),
  JSON.stringify(
    {
      name: "veto-mcp",
      version: mcp.version,
      description: "MCP server for Veto, a NEAR vault where an AI agent's payments must pass an enclave screen that can only say no. Try it with no keys against the hosted testnet demo, or drive your own vault.",
      license: "MIT",
      type: "module",
      bin: { "veto-mcp": "dist/main.js" },
      files: ["dist", "README.md"],
      engines: { node: ">=20" },
      repository: { type: "git", url: "git+https://github.com/0xdopewilly/veto.git", directory: "packages/mcp" },
      homepage: "https://github.com/0xdopewilly/veto#from-an-mcp-client-claude-code-codex-cursor",
      keywords: ["mcp", "near", "ai-agents", "payments", "tee", "near-ai", "model-context-protocol"],
      dependencies,
    },
    null,
    2,
  ) + "\n",
);
cpSync(new URL("packages/mcp/README.md", root), new URL("README.md", out));
console.log(`veto-mcp@${mcp.version} in packages/mcp/npm: ${Object.keys(result.metafile.outputs).length} files, dependencies ${Object.keys(dependencies).join(", ")}`);

if (process.argv.includes("--check")) {
  // Installed from the tarball, outside the workspace, then a real MCP handshake over stdio.
  const tmp = mkdtempSync(join(tmpdir(), "veto-mcp-"));
  execFileSync("npm", ["pack", "--silent", "--pack-destination", tmp], { cwd: fileURLToPath(out), stdio: ["ignore", "ignore", "inherit"] });
  const tarball = join(tmp, readdirSync(tmp).find((f) => f.endsWith(".tgz")));
  execFileSync("npm", ["install", "--silent", "--no-audit", "--no-fund", "--prefix", tmp, tarball], { stdio: ["ignore", "ignore", "inherit"] });
  const child = spawn(join(tmp, "node_modules/.bin/veto-mcp"), [], { stdio: ["pipe", "pipe", "inherit"] });
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
  let buf = "";
  const tools = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no tools/list answer in 20 s")), 20_000);
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n").slice(0, -1)) {
        const msg = JSON.parse(line);
        if (msg.id === 1) {
          send({ method: "notifications/initialized" });
          send({ id: 2, method: "tools/list" });
        }
        if (msg.id === 2) {
          clearTimeout(timer);
          resolve(msg.result.tools.map((t) => t.name));
        }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    });
    send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pack-check", version: "0" } } });
  });
  child.kill();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`installed from ${tarball.split("/").pop()}; tools: ${tools.join(", ")}`);
}
