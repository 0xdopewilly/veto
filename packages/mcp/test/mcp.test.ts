// The MCP server's tools, end to end through an MCP client, with fetch and the vault faked: no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Proposal } from "@veto/core/proposal";
import { REASON_TEXT } from "@veto/core/prompt";
import { createServer, type Mode } from "../src/server.ts";
import { Sandbox, SANDBOX_VAULT } from "../src/sandbox.ts";
import { OwnVault, vaultEnv, type VaultBackend } from "../src/vault.ts";
import { toUnits } from "../src/describe.ts";

const BASE = "https://demo.test";
const PROOFS = "https://proofs.test";
const RPC = "https://rpc.test";
const ROOT = "veto-rhwe0krb.testnet";

function proposal(id: string, status: Proposal["status"], over: Partial<Proposal> = {}): Proposal {
  return {
    id,
    agent: `buyer.${ROOT}`,
    request: { chain: "near", asset: `usdc.${ROOT}`, payee: `kano-cottom.${ROOT}`, amount: "300000000", memo: "INV-3041" },
    context_hash: "ab".repeat(32),
    status,
    created_at: "1794422662361923002",
    screen_deadline: "1794423262361923002",
    verdict:
      status === "Screening"
        ? null
        : {
            pass: status === "Paid",
            reasons: status === "Paid" ? [] : ["LOOKALIKE_ADDRESS", "CHANGED_PAYOUT_DETAILS"],
            model_id: "Qwen/Qwen3-VL-30B-A3B-Instruct",
            signer: "0x2665cce942fa427ef30d87f4b0bff67fb7645462",
            chat_id: "chatcmpl-1",
            request_hash: "11".repeat(32),
            response_hash: "22".repeat(32),
            recorded_at: "1794422668418219441",
          },
    override_executes_at: null,
    settled_at: null,
    ...over,
  };
}

function state(proposals: Proposal[]) {
  return {
    config: {
      owner: ROOT,
      guardian: `guardian.${ROOT}`,
      frozen: false,
      mandate: "Pay listed suppliers and staff only.",
      require_listed_payee: false,
      period_secs: "604800",
      period_anchor_secs: "0",
      override_delay_secs: "180",
      raise_delay_secs: "180",
      screen_timeout_secs: "600",
      proposal_count: "144",
    },
    proposals,
    payees: [{ name: "Kano Cotton Mills", chain: "near", address: `kano-cotton.${ROOT}`, added_at: "1" }],
    policies: [[`usdc.${ROOT}`, { period_limit: "50000000000", max_single: "500000000" }]],
    pending: [],
    spend: { [`usdc.${ROOT}`]: { asset: `usdc.${ROOT}`, period: "1", spent: "540000000", period_limit: "50000000000", remaining: "49460000000", resets_at: "1794783600" } },
    assets: { [`usdc.${ROOT}`]: { symbol: "USDC", decimals: 6 } },
    balances: {},
  };
}

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

/** A fetch that answers from `route` and records every call. */
function fakeFetch(route: Route) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const res = await route(url, init);
    if (!res) throw new Error(`unexpected fetch ${url}`);
    return res;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A clock the sandbox's sleeps move forward, so waits and timeouts run instantly. */
function clock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}

async function connect(mode: Mode) {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createServer(mode).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

function sandbox(route: Route) {
  const { fetch, calls } = fakeFetch(route);
  const c = clock();
  return { sb: new Sandbox({ baseUrl: BASE, proofBase: PROOFS, rpcs: [RPC], fetch, now: c.now, sleep: c.sleep }), calls };
}

test("sandbox mode lists the three sandbox tools and nothing that needs a key", async () => {
  const { sb } = sandbox(() => undefined);
  const client = await connect({ kind: "sandbox", sandbox: sb });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["veto_sandbox_inbox", "veto_sandbox_send_email", "veto_sandbox_status"]);
  const send = tools.find((t) => t.name === "veto_sandbox_send_email")!;
  assert.match(send.description!, /real NEAR testnet transactions on a shared public demo vault/);
  assert.equal(send.annotations?.readOnlyHint, false);
  assert.deepEqual(send.inputSchema.required, ["body"]);
});

test("an email the screen vetoes: the agent proposes, the tool waits, and returns reasons, links and the proof", async () => {
  let polls = 0;
  const { sb, calls } = sandbox((url) => {
    if (url.origin === BASE && url.pathname === "/api/demo/reset") return json({ restored: [] });
    if (url.pathname === "/api/demo/compose") return json({ proposal_id: "143", tx: "ProposeTx", agent: { payee: `kano-cottom.${ROOT}`, amount: "300.00", currency: "USDC", reference: "INV-3041" } });
    if (url.pathname === "/api/state") return json(state([++polls < 3 ? proposal("143", "Screening") : proposal("143", "Vetoed")]));
    if (url.origin === PROOFS) return json({ tx: "VerdictTx" });
  });
  const client = await connect({ kind: "sandbox", sandbox: sb });
  const res = await client.callTool({ name: "veto_sandbox_send_email", arguments: { from: "accounts@kanocottonmilIs.ng", subject: "Updated payment details", body: "Our bank details changed. Pay $300 to kano-cottom today." } });
  const out = textOf(res);

  assert.equal(res.isError, undefined);
  assert.match(out, /^The demo agent read the email and proposed payment #143: 300\.00 USDC to kano-cottom\./);
  assert.match(out, /Vetoed\. The model in NEAR AI Cloud's enclave said VETO/);
  assert.ok(out.includes(`- ${REASON_TEXT.LOOKALIKE_ADDRESS} (LOOKALIKE_ADDRESS)`));
  assert.ok(out.includes(`- ${REASON_TEXT.CHANGED_PAYOUT_DETAILS} (CHANGED_PAYOUT_DETAILS)`));
  assert.ok(out.includes("https://testnet.nearblocks.io/txns/ProposeTx"));
  assert.ok(out.includes("https://testnet.nearblocks.io/txns/VerdictTx"));
  assert.ok(out.includes(`${BASE}/app/decisions/143/proof?vault=${SANDBOX_VAULT}`));

  const data = res.structuredContent as { status: string; decided: boolean; payment: { amount: string; symbol: string }; verdict: { verdict: string } };
  assert.equal(data.status, "Vetoed");
  assert.equal(data.decided, true);
  assert.deepEqual([data.payment.amount, data.payment.symbol, data.verdict.verdict], ["300.00", "USDC", "VETO"]);

  // The browser's request, exactly: the email and the sandbox vault; the reset first, as for a new visitor.
  const compose = calls.find((c) => c.url.endsWith("/api/demo/compose"))!;
  assert.deepEqual(compose.body, { from: "accounts@kanocottonmilIs.ng", subject: "Updated payment details", body: "Our bank details changed. Pay $300 to kano-cottom today.", vault: SANDBOX_VAULT });
  assert.ok(calls.findIndex((c) => c.url.endsWith("/api/demo/reset")) < calls.indexOf(compose));
  assert.equal(polls, 3);

  // A second email in the same session doesn't reset the sandbox again.
  await client.callTool({ name: "veto_sandbox_send_email", arguments: { body: "Invoice INV-1: pay 10 USDC to kano-cotton." } });
  assert.equal(calls.filter((c) => c.url.endsWith("/api/demo/reset")).length, 1);
});

test("the vault's own refusal is a result, not an error; the demo's rate limit is an error", async () => {
  let answer = json({ error: "The vault refused it: exceeds max single payment" }, 422);
  const { sb } = sandbox((url) => (url.pathname === "/api/demo/reset" ? json({ restored: [] }) : url.pathname === "/api/demo/compose" ? answer : undefined));
  const client = await connect({ kind: "sandbox", sandbox: sb });

  let res = await client.callTool({ name: "veto_sandbox_send_email", arguments: { body: "Invoice: pay 9000 USDC to kano-cotton." } });
  assert.equal(res.isError, undefined);
  assert.equal((res.structuredContent as { status: string }).status, "RefusedByVault");
  assert.match(textOf(res), /Refused by the vault before any screening; nothing was paid/);

  answer = json({ error: "The agent read it and found nothing to pay." }, 422);
  res = await client.callTool({ name: "veto_sandbox_send_email", arguments: { body: "Lunch on Friday?" } });
  assert.equal((res.structuredContent as { status: string }).status, "NotProposed");

  answer = json({ error: "too many emails; try again in a few minutes" }, 429);
  res = await client.callTool({ name: "veto_sandbox_send_email", arguments: { body: "Invoice: pay 10 USDC to kano-cotton." } });
  assert.equal(res.isError, true);
  assert.match(textOf(res), /429.*too many emails.*about 8 emails every 10 minutes/s);
});

test("a screening that outlasts the wait returns the current status and says how to check later", async () => {
  const { sb } = sandbox((url) => {
    if (url.pathname === "/api/demo/reset") return json({ restored: [] });
    if (url.pathname === "/api/demo/compose") return json({ proposal_id: "150", tx: "T", agent: { payee: `kano-cotton.${ROOT}`, amount: "10", currency: "USDC", reference: "" } });
    if (url.pathname === "/api/state") return json(state([proposal("150", "Screening")]));
  });
  const client = await connect({ kind: "sandbox", sandbox: sb });
  const res = await client.callTool({ name: "veto_sandbox_send_email", arguments: { body: "Invoice: pay 10 USDC to kano-cotton.", wait_seconds: 10 } });
  const out = textOf(res);
  assert.match(out, /^Screening\./m);
  assert.match(out, /Screening deadline: 2026-/);
  assert.match(out, /Not decided after 10 s\. .*veto_sandbox_status \(id 150\)/);
  assert.equal((res.structuredContent as { decided: boolean }).decided, false);
});

test("status by id reads a payment older than the app's newest 100 straight from NEAR's RPC", async () => {
  const old = proposal("7", "Paid", { request: { chain: "near", asset: `usdc.${ROOT}`, payee: `kano-cotton.${ROOT}`, amount: "180000000", memo: "INV-2291" } });
  const { sb, calls } = sandbox((url, init) => {
    if (url.pathname === "/api/state") return json(state([proposal("143", "Vetoed")]));
    if (url.origin === RPC) {
      const params = JSON.parse(String(init!.body)).params;
      assert.equal(params.method_name, "get_proposal");
      assert.deepEqual(JSON.parse(Buffer.from(params.args_base64, "base64").toString()), { id: "7" });
      return json({ jsonrpc: "2.0", id: "x", result: { result: [...Buffer.from(JSON.stringify(old))] } });
    }
    if (url.origin === PROOFS) return new Response("not found", { status: 404 });
  });
  const client = await connect({ kind: "sandbox", sandbox: sb });
  const res = await client.callTool({ name: "veto_sandbox_status", arguments: { id: "7" } });
  const out = textOf(res);
  assert.match(out, /^Paid\./);
  assert.match(out, /180\.00 USDC to Kano Cotton Mills \(kano-cotton\.veto-rhwe0krb\.testnet\), reference INV-2291/);
  assert.ok(calls.some((c) => c.url.startsWith(PROOFS)));
  assert.ok(!out.includes("Verdict transaction"));

  const missing = await client.callTool({ name: "veto_sandbox_status", arguments: { id: "abc" } });
  assert.equal(missing.isError, true);
});

test("the inbox tool lists the example emails and the vault's caps, what's left and its payees", async () => {
  const { sb } = sandbox((url) => {
    if (url.pathname === "/api/demo")
      return json({
        enabled: true,
        vault: SANDBOX_VAULT,
        agent: { account: `buyer.${ROOT}` },
        guardian: { account: `guardian.${ROOT}`, model: "Qwen/Qwen3-VL-30B-A3B-Instruct", test_signer: false },
        nearai: "up",
        scenarios: [{ id: "wallet-changed", title: "Changed payout details", from: "accounts@kanocottonmilIs.ng", subject: "Updated payment details for INV-3041", preview: "Our wallet has changed.", amount: "300.00", payee: `kano-cottom.${ROOT}`, expect: "veto" }],
      });
    if (url.pathname === "/api/state") return json(state([]));
  });
  const client = await connect({ kind: "sandbox", sandbox: sb });
  const out = textOf(await client.callTool({ name: "veto_sandbox_inbox", arguments: {} }));
  assert.match(out, /Expected VETO: "Updated payment details for INV-3041" from accounts@kanocottonmilIs\.ng, 300\.00 USDC to kano-cottom\./);
  assert.match(out, /USDC \(usdc\.veto-rhwe0krb\.testnet\): at most 500\.00 a payment and 50,000\.00 a week; 540\.00 spent, 49,460\.00 left/);
  assert.match(out, /Kano Cotton Mills: kano-cotton\.veto-rhwe0krb\.testnet \(near\)/);
});

const KEY = "ed25519:3D4YudUahN1nawWogh8pAKSj92sUNMdbZGjn7kERKzYoTy8tnFQuwoGUC51DowKqorvkr2pytJSnwuSbsNVfqygr";

function fakeVault(over: Partial<VaultBackend> = {}) {
  const proposed: Parameters<VaultBackend["propose"]>[0][] = [];
  const backend: VaultBackend = {
    vaultId: "shop.vaults.veto-rhwe0krb.testnet",
    network: "testnet",
    propose: async (p) => (proposed.push(p), { id: "3", tx: "AgentTx" }),
    proposal: async (id) => proposal(id, "Paid", { request: { chain: "near", asset: "usdc.test", payee: "kano.test", amount: "180500000", memo: "INV-9" } }),
    view: (async (method: string) => {
      const s = state([]);
      if (method === "get_policies") return [["near", { period_limit: "1", max_single: "1" }], ["usdc.test", { period_limit: "3000000000", max_single: "500000000" }]];
      if (method === "get_payees") return [{ name: "Kano", chain: "near", address: "kano.test", added_at: "1" }];
      if (method === "get_config") return s.config;
      if (method === "get_pending_policies") return [];
      if (method === "get_spend") return { asset: "usdc.test", spent: "0", period_limit: "3000000000", remaining: "3000000000", resets_at: "1794783600" };
      throw new Error(`unexpected view ${method}`);
    }) as VaultBackend["view"],
    ftMetadata: async () => ({ symbol: "USDC", decimals: 6 }),
    ...over,
  };
  const c = clock();
  return { vault: new OwnVault(backend, { appUrl: BASE, now: c.now, sleep: c.sleep }), proposed };
}

test("own-vault mode: human amounts become the asset's units, the default asset is the vault's token, and the key never shows", async () => {
  const { vault, proposed } = fakeVault();
  const client = await connect({ kind: "vault", vault, secrets: [KEY] });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["veto_payment_status", "veto_propose_payment", "veto_vault_rules"]);

  const res = await client.callTool({
    name: "veto_propose_payment",
    arguments: { payee: "kano.test", amount: "180.50", memo: "INV-9", evidence: { source: "email", from: "a@kano.ng", body: "Invoice INV-9, $180.50" } },
  });
  const out = textOf(res);
  assert.deepEqual(proposed, [{ payee: "kano.test", amount: "180500000", asset: "usdc.test", chain: "near", memo: "INV-9", evidence: { source: "email", from: "a@kano.ng", body: "Invoice INV-9, $180.50" } }]);
  assert.match(out, /^Paid\./);
  assert.match(out, /180\.50 USDC to Kano \(kano\.test\), reference INV-9/);
  assert.ok(out.includes("https://testnet.nearblocks.io/txns/AgentTx"));
  // A factory vault opens in the hosted app.
  assert.ok(out.includes(`${BASE}/app/decisions/3/proof?vault=shop.vaults.veto-rhwe0krb.testnet`));

  const rules = textOf(await client.callTool({ name: "veto_vault_rules", arguments: {} }));
  assert.match(rules, /USDC \(usdc\.test\): at most 500\.00 a payment and 3,000\.00 a week; 0\.00 spent, 3,000\.00 left/);

  const bad = await client.callTool({ name: "veto_propose_payment", arguments: { payee: "kano.test", amount: "1.0000001" } });
  assert.equal(bad.isError, true);
  assert.match(textOf(bad), /more than 6 decimal places/);
  assert.equal(proposed.length, 1);
});

test("own-vault mode: a cap refusal reads as the vault's no, and an error that quotes the key is redacted", async () => {
  let fail = new Error("Transaction failed: Smart contract panicked: exceeds max single payment");
  const { vault } = fakeVault({ propose: async () => Promise.reject(fail) });
  const client = await connect({ kind: "vault", vault, secrets: [KEY] });

  let res = await client.callTool({ name: "veto_propose_payment", arguments: { payee: "kano.test", amount: "900", asset: "usdc.test" } });
  assert.equal(res.isError, undefined);
  assert.equal((res.structuredContent as { status: string }).status, "RefusedByVault");
  assert.match(textOf(res), /exceeds max single payment/);

  fail = new Error(`bad signer ${KEY}`);
  res = await client.callTool({ name: "veto_propose_payment", arguments: { payee: "kano.test", amount: "9", asset: "usdc.test" } });
  assert.equal(res.isError, true);
  assert.ok(!JSON.stringify(res).includes(KEY.slice(8)));
  assert.match(textOf(res), /\[redacted\]/);
});

test("the mode comes from the environment: none set is the sandbox, some set is an error naming what's missing", () => {
  assert.equal(vaultEnv({}), null);
  assert.throws(() => vaultEnv({ VETO_VAULT_ID: "v.testnet", VETO_AGENT_KEY: KEY }), /missing VETO_AGENT_ACCOUNT, VETO_GUARDIAN_URL/);
  const full = { VETO_VAULT_ID: "v.testnet", VETO_AGENT_ACCOUNT: "a.testnet", VETO_AGENT_KEY: KEY, VETO_GUARDIAN_URL: "http://localhost:8799/" };
  assert.deepEqual(vaultEnv(full), { vaultId: "v.testnet", agentAccountId: "a.testnet", agentKey: KEY, guardianUrl: "http://localhost:8799", network: "testnet" });
  assert.throws(() => vaultEnv({ ...full, VETO_NETWORK: "betanet" }), /testnet or mainnet/);
  assert.throws(
    () => vaultEnv({ ...full, VETO_AGENT_KEY: "not-a-key-but-secret" }),
    (e: Error) => /VETO_AGENT_KEY must be/.test(e.message) && !e.message.includes("not-a-key-but-secret"),
  );
});

test("amounts: plain numbers only, never more places than the asset has", () => {
  assert.equal(toUnits("180", 6), "180000000");
  assert.equal(toUnits("1,250.5", 6), "1250500000");
  assert.equal(toUnits("0.0001", 18), "100000000000000");
  assert.throws(() => toUnits("0", 6), /more than zero/);
  assert.throws(() => toUnits("$5", 6), /plain number/);
  assert.throws(() => toUnits("1e3", 6), /plain number/);
});

test("main.ts starts over stdio in sandbox mode, and refuses half an own-vault setup without echoing the key", async () => {
  const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("VETO_")));

  const half = spawnSync(process.execPath, [main], { env: { ...clean, VETO_VAULT_ID: "v.testnet", VETO_AGENT_KEY: KEY }, input: "", encoding: "utf8", timeout: 20_000 });
  assert.equal(half.status, 1);
  assert.match(half.stderr, /missing VETO_AGENT_ACCOUNT, VETO_GUARDIAN_URL/);
  assert.ok(!half.stderr.includes(KEY) && !half.stdout.includes(KEY));

  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [main], env: clean as Record<string, string>, stderr: "pipe" }));
  try {
    assert.match(client.getInstructions() ?? "", /sandbox mode/);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["veto_sandbox_inbox", "veto_sandbox_send_email", "veto_sandbox_status"]);
  } finally {
    await client.close();
  }
});
