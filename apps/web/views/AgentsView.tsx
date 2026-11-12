"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { accessKeys, metaOf, useVault, type VaultState } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { RPC_UPSTREAM } from "@/lib/config";
import { STATUS_TEXT, outcomeOf, payeeLabel } from "@/lib/decision";
import { formatAmount, formatWhenInline, NATIVE, shortAddress } from "@/lib/format";
import { Screen, delay } from "@/components/Screen";
import { OwnerButton } from "@/components/OwnerButton";
import { Boot } from "@/components/Boot";
import { LineReveal } from "@/components/LineReveal";
import head from "./PageHead.module.css";
import styles from "./AgentsView.module.css";

interface KeyInfo {
  publicKey: string;
  methods: string[];
  allowance: string | null;
}

/** The agent's keys that can only call this vault. */
function useVaultKeys(accountId: string, vaultId: string): KeyInfo[] | null {
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    accessKeys(accountId)
      .then((list) => {
        if (cancelled) return;
        const scoped: KeyInfo[] = [];
        for (const k of list.keys) {
          const permission = k.access_key.permission as unknown;
          if (permission && typeof permission === "object" && "FunctionCall" in permission) {
            const fc = (permission as { FunctionCall: { receiver_id: string; method_names: string[]; allowance?: unknown } }).FunctionCall;
            if (fc.receiver_id === vaultId) {
              scoped.push({ publicKey: String(k.public_key), methods: fc.method_names, allowance: fc.allowance == null ? null : String(fc.allowance) });
            }
          }
        }
        setKeys(scoped);
      })
      .catch(() => !cancelled && setKeys([]));
    return () => {
      cancelled = true;
    };
  }, [accountId, vaultId]);
  return keys;
}

/** "ed25519:BLVq3w…xUki": the curve, then the key's ends. */
const shortKey = (key: string) => {
  const [curve, body] = key.includes(":") ? key.split(":") : ["", key];
  const ends = body.length > 12 ? `${body.slice(0, 6)}…${body.slice(-4)}` : body;
  return curve ? `${curve}:${ends}` : ends;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "53 payments · 21 paid · 32 vetoed", the same counts as everywhere else. */
function counts(list: { status: Parameters<typeof outcomeOf>[0] }[]) {
  const n = { paid: 0, vetoed: 0, pending: 0, closed: 0 };
  for (const p of list) n[outcomeOf(p.status)]++;
  return [
    plural(list.length, "payment"),
    `${n.paid} paid`,
    `${n.vetoed} vetoed`,
    ...(n.pending ? [`${n.pending} pending`] : []),
    ...(n.closed ? [`${n.closed} expired or failed`] : []),
  ].join(" · ");
}

export function AgentsView() {
  const { state, isSandbox } = useVault();
  if (!state) return <Boot loading caption="Loading agents" />;

  return (
    <Boot>
    <Screen>
      <LineReveal as="h1" className={head.title} text="Agents" />
      <p className={`${head.lead} rise`} style={delay(60)}>
        Agents can ask to pay. Veto screens every request the same way, whichever wallet the agent pays from, and no agent can change your rules.
      </p>

      <div className={styles.list}>
        {state.agents.length === 0 && <p className={styles.empty}>No agents yet. Connect one with the code below.</p>}
        {state.agents.map(([agent, info], i) => (
          <AgentCard key={agent} state={state} agent={agent} active={info.active} style={delay(120 + i * 80)} />
        ))}
        {(state.wallets ?? []).map(([wallet, info], i) => (
          <WalletCard key={wallet} state={state} wallet={wallet} name={info.name} provider={info.provider} style={delay(120 + (state.agents.length + i) * 80)} />
        ))}
        {isSandbox && <AgentApiCard style={delay(120 + (state.agents.length + (state.wallets ?? []).length) * 80)} />}
      </div>

      <ConnectAgent />
    </Screen>
    </Boot>
  );
}

function AgentCard({ state, agent, active, style }: { state: VaultState; agent: string; active: boolean; style?: React.CSSProperties }) {
  const { isOwner } = useWallet();
  const { vaultId } = useVault();
  const keys = useVaultKeys(agent, vaultId ?? "");
  const periodStartNs = (BigInt(state.config.period_anchor_secs) + BigInt(state.spend[state.primaryAsset]?.period ?? "0") * BigInt(state.config.period_secs)) * 1_000_000_000n;
  const mine = state.proposals.filter((p) => p.agent === agent);
  const thisPeriod = mine.filter((p) => BigInt(p.created_at) >= periodStartNs);
  const last = mine[0];
  const proposeKey = keys?.find((k) => k.methods.includes("propose"));

  return (
    <article className={`${styles.card} rise`} style={style}>
      <header className={styles.cardHead}>
        <div className={styles.nameBlock}>
          <h2 className={styles.agentName}>{`${shortAddress(agent).charAt(0).toUpperCase()}${shortAddress(agent).slice(1)} agent`}</h2>
          <span className={styles.kind}>
            On this vault · <span className="mono">{agent}</span>
          </span>
        </div>
        <span className={`${styles.badge} ${active ? styles.on : styles.off}`}>{active ? "Active" : "Paused"}</span>
      </header>
      <p className={styles.cardText}>Can ask to pay. Can&apos;t move funds or change your rules, payees or limits.</p>

      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Access</dt>
          <dd>
            {keys === null ? (
              "Checking keys…"
            ) : proposeKey ? (
              <>
                A key that can only ask this vault to pay
                <span className={`mono ${styles.key}`} title={`${proposeKey.publicKey}: may call ${proposeKey.methods.join(", ")} on ${vaultId}`}>
                  {shortKey(proposeKey.publicKey)}
                </span>
              </>
            ) : (
              "No key limited to this vault yet."
            )}
          </dd>
        </div>
        {proposeKey?.allowance && (
          <div className={styles.fact}>
            <dt>Gas allowance</dt>
            <dd>{formatAmount(proposeKey.allowance, NATIVE)} left</dd>
          </div>
        )}
        <div className={styles.fact}>
          <dt>This week</dt>
          <dd>{counts(thisPeriod)}</dd>
        </div>
        {last && (
          <div className={styles.fact}>
            <dt>Last action</dt>
            <dd>
              Asked to pay {formatAmount(last.request.amount, metaOf(state, last.request.asset))} to{" "}
              <span className={last.request.payee.startsWith("0x") ? "mono" : ""}>{payeeLabel(state.payees, last)}</span>,{" "}
              {STATUS_TEXT[last.status].toLowerCase()} {formatWhenInline(last.created_at)}.{" "}
              <Link href={`/app/decisions/${last.id}`} className={styles.link}>View decision</Link>
            </dd>
          </div>
        )}
      </dl>

      {isOwner && (
        <div className={styles.cardActions}>
          <OwnerButton method="set_agent_active" args={{ agent, active: !active }} variant="secondary" size="md" success={active ? "Paused" : "Resumed"}>
            {active ? "Pause agent" : "Resume agent"}
          </OwnerButton>
          <OwnerButton method="remove_agent" args={{ agent }} variant="ghost" size="md" success="Revoked">
            Revoke access
          </OwnerButton>
        </div>
      )}
    </article>
  );
}

/** An agent that pays from its own OutLayer wallet; Veto is an approver on that wallet's policy. */
interface AgentApiView {
  enabled: boolean;
  name: string;
  status: string;
  owner: string | null;
  wallet: string | null;
  in_force: boolean;
  usdc: string;
  policy: {
    frozen: boolean;
    limits: { per_transaction?: Record<string, string>; daily?: Record<string, string> };
    destinations: { mode: string; list: unknown[] };
  } | null;
  grants: { label: string; expires_at: string }[];
  payees: { name: string; address: string; chain?: string }[];
}

const usd = (raw: string | undefined) => (raw ? formatAmount(raw, { symbol: "USDC", decimals: 6 }) : "none");

/** The NEAR Intents Agent API wallet (mainnet) whose only grant Veto holds; read live from the API. */
function AgentApiCard({ style }: { style?: React.CSSProperties }) {
  const [view, setView] = useState<AgentApiView | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/agentapi")
      .then((r) => r.json())
      .then((v: AgentApiView) => live && v.enabled && setView(v))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!view) return null;
  const perPayment = view.policy?.limits.per_transaction && Object.values(view.policy.limits.per_transaction)[0];
  const daily = view.policy?.limits.daily && Object.values(view.policy.limits.daily)[0];
  const withdrawals = ((view.policy?.destinations.list ?? []) as { action?: string; chain?: string }[]).filter((d) => d.action === "withdraw");
  return (
    <article className={`${styles.card} rise`} style={style}>
      <header className={styles.cardHead}>
        <div className={styles.nameBlock}>
          <h2 className={styles.agentName}>{view.name}</h2>
          <span className={styles.kind}>NEAR Intents wallet · mainnet</span>
        </div>
        <span className={`${styles.badge} ${view.policy?.frozen ? styles.off : styles.on}`}>{view.policy?.frozen ? "Frozen" : "Active"}</span>
      </header>
      <p className={styles.cardText}>
        Its owner&apos;s signed policy is the hard limit, and Veto holds its only spending grant, so the AI agent can only ask. Veto screens each request and sends just what passes.
      </p>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Wallet</dt>
          <dd>
            {view.wallet ? (
              <a href={`https://nearblocks.io/address/${view.wallet}`} target="_blank" rel="noreferrer" className={`mono ${styles.key}`}>
                {shortAddress(view.wallet)}
              </a>
            ) : (
              "Setting up"
            )}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Owner&apos;s policy</dt>
          <dd>
            {view.in_force ? "In force: " : "Syncing: "}USDC only, up to {usd(perPayment)} a payment and {usd(daily)} a day. Transfers to {view.payees.map((p) => p.name).join(" and ")}
            {withdrawals.length > 0 && <>, and salary payouts to {withdrawals.length === 1 ? "one worker's wallet" : `${withdrawals.length} workers' wallets`} on {withdrawals[0].chain === "base" ? "Base" : withdrawals[0].chain}</>}.
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Spending grant</dt>
          <dd>{view.grants.length === 1 ? "One, held by Veto" : `${view.grants.length} live grants`}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Balance</dt>
          <dd>{usd(view.usdc)}{view.usdc === "0" ? ". A payment that passes waits until it's funded." : ""}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Owner</dt>
          <dd>
            Held by Veto&apos;s demo, like the sandbox owner: <span className="mono">{view.owner ? shortAddress(view.owner) : "unknown"}</span>
          </dd>
        </div>
      </dl>
    </article>
  );
}

function WalletCard({ state, wallet, name, provider, style }: { state: VaultState; wallet: string; name: string; provider: string; style?: React.CSSProperties }) {
  const mine = state.proposals.filter((p) => p.external?.wallet === wallet);
  const last = mine[0];
  return (
    <article className={`${styles.card} rise`} style={style}>
      <header className={styles.cardHead}>
        <div className={styles.nameBlock}>
          <h2 className={styles.agentName}>{name || "Agent wallet"}</h2>
          <span className={styles.kind}>{provider === "outlayer" ? "OutLayer wallet" : provider}</span>
        </div>
        <span className={`${styles.badge} ${styles.on}`}>Active</span>
      </header>
      <p className={styles.cardText}>
        Pays from its own wallet, which holds every payment until Veto approves it. Veto approves only what passes your limits and the AI screen.
      </p>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Wallet</dt>
          <dd>
            <span className={`mono ${styles.key}`}>{shortAddress(wallet)}</span>
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>Approvals</dt>
          <dd>Veto or you. After a veto Veto never signs, so the wallet keeps holding the payment.</dd>
        </div>
        <div className={styles.fact}>
          <dt>All payments</dt>
          <dd>{counts(mine)}</dd>
        </div>
        {last && (
          <div className={styles.fact}>
            <dt>Last action</dt>
            <dd>
              Asked to pay {formatAmount(last.request.amount, metaOf(state, last.request.asset))} to {payeeLabel(state.payees, last)},{" "}
              {STATUS_TEXT[last.status].toLowerCase()} {formatWhenInline(last.created_at)}.{" "}
              <Link href={`/app/decisions/${last.id}`} className={styles.link}>View decision</Link>
            </dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function ConnectAgent() {
  const { vaultId } = useVault();
  const lines: { text: string; tone?: "kw" | "str" | "muted" }[][] = [
    [{ text: "import", tone: "kw" }, { text: " { Account, JsonRpcProvider, teraToGas } " }, { text: "from", tone: "kw" }, { text: ' "near-api-js"', tone: "str" }, { text: ";" }],
    [],
    [{ text: "const", tone: "kw" }, { text: " agent = " }, { text: "new", tone: "kw" }, { text: " Account(" }, { text: '"buyer.your-vault.near"', tone: "str" }, { text: "," }],
    [{ text: "  " }, { text: "new", tone: "kw" }, { text: " JsonRpcProvider({ url: " }, { text: `"${RPC_UPSTREAM}"`, tone: "str" }, { text: " })," }],
    [{ text: "  process.env.AGENT_KEY);" }, { text: " // a key that can only call propose", tone: "muted" }],
    [],
    [{ text: "const", tone: "kw" }, { text: " id = " }, { text: "await", tone: "kw" }, { text: " agent.callFunction({" }],
    [{ text: "  contractId: " }, { text: `"${vaultId ?? ""}"`, tone: "str" }, { text: "," }],
    [{ text: "  methodName: " }, { text: '"propose"', tone: "str" }, { text: "," }],
    [{ text: "  args: { request: { chain: " }, { text: '"near"', tone: "str" }, { text: ", asset: " }, { text: '"near"', tone: "str" }, { text: "," }],
    [{ text: "    payee: " }, { text: '"supplier.near"', tone: "str" }, { text: ", amount: " }, { text: '"180000000000000000000000"', tone: "str" }, { text: "," }],
    [{ text: "    memo: " }, { text: '"INV-2288"', tone: "str" }, { text: " }, context_hash: " }, { text: "null", tone: "kw" }, { text: " }," }],
    [{ text: "  gas: teraToGas(" }, { text: '"30"', tone: "str" }, { text: ")," }],
    [{ text: "});" }],
    [{ text: "// Veto screens it; read the verdict with get_proposal(id).", tone: "muted" }],
  ];
  return (
    <section className={`${styles.connect} rise`} style={delay(280)} aria-labelledby="connect-title">
      <h2 id="connect-title" className={styles.h2}>Connect an agent</h2>
      <p className={styles.cardText}>Give it a key that can only ask to pay. Every request goes through your limits and the AI screen, and the agent never holds your funds.</p>
      <pre className={styles.code} aria-label="Example: an agent proposing a payment">
        <code>
          {lines.map((line, i) => (
            <span key={i} className={styles.line} style={delay(420 + i * 70)}>
              {line.length === 0 ? " " : line.map((part, j) => (
                <span key={j} className={part.tone ? styles[part.tone] : undefined}>{part.text}</span>
              ))}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
