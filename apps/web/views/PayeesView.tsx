"use client";

import Link from "next/link";
import { useState } from "react";
import { useVault } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { compareAddresses, imitated, payeeHistory } from "@/lib/decision";
import { formatWhen, shortAddress, chainLabel } from "@/lib/format";
import { Screen, delay } from "@/components/Screen";
import { Icon } from "@/components/Icon";
import { OwnerButton } from "@/components/OwnerButton";
import { Boot } from "@/components/Boot";
import { LineReveal } from "@/components/LineReveal";
import head from "./PageHead.module.css";
import styles from "./PayeesView.module.css";

const CHAINS = [
  { id: "near", label: "NEAR" },
  { id: "base", label: "Base" },
  { id: "arbitrum", label: "Arbitrum" },
  { id: "ethereum", label: "Ethereum" },
  { id: "solana", label: "Solana" },
];


export function PayeesView() {
  const { state } = useVault();
  const { isOwner } = useWallet();
  const [name, setName] = useState("");
  const [chain, setChain] = useState("near");
  const [address, setAddress] = useState("");

  if (!state) return <Boot loading caption="Loading payees" />;

  // One row per lookalike address: its latest attempt, and how many times it was tried.
  const attempts = new Map<string, number>();
  const blocked = state.proposals
    .filter((p) => p.status === "Vetoed" || p.status === "Cancelled")
    .map((p) => ({ p, look: imitated(state.payees, p) }))
    .filter((x): x is { p: typeof x.p; look: NonNullable<typeof x.look> } => !!x.look)
    .filter(({ p }) => {
      const key = `${p.request.chain}:${p.request.payee.toLowerCase()}`;
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      return attempts.get(key) === 1;
    });
  const tries = (p: { request: { chain: string; payee: string } }) => attempts.get(`${p.request.chain}:${p.request.payee.toLowerCase()}`) ?? 1;
  const canAdd = name.trim().length > 0 && name.trim().length <= 64 && address.trim().length > 0;

  return (
    <Boot>
    <Screen>
      <div className={styles.titleRow}>
        <LineReveal as="h1" className={head.title} text="Payees" />
        <a href="#add" className={`${styles.add} press rise`}>
          <Icon name="plus" size={16} stroke={2.25} /> Add payee
        </a>
      </div>
      <p className={`${head.lead} rise`} style={delay(60)}>
        Veto only pays these addresses. A changed address is never trusted automatically.
      </p>

      <div className={styles.table} role="table" aria-label="Saved payees">
        <div className={styles.head} role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Chain</span>
          <span role="columnheader">Address</span>
          <span role="columnheader">Payments</span>
          <span role="columnheader">Last paid</span>
          <span role="columnheader"><span className="visually-hidden">Actions</span></span>
        </div>
        {state.payees.length === 0 && <p className={styles.empty}>No payees yet. Add the first one below.</p>}
        {state.payees.map((payee, i) => {
          const history = payeeHistory(state.proposals, payee);
          return (
            <div key={`${payee.chain}:${payee.address}`} role="row" className={`${styles.row} rise`} style={delay(120 + i * 60)}>
              <span role="cell" className={styles.name}>
                <span className={styles.initial} aria-hidden="true">{payee.name[0]?.toUpperCase()}</span>
                <span className={styles.nameText}>
                  {payee.name}
                  <span className={`${styles.mobileMeta} mono`}>
                    {chainLabel(payee.chain)} · {shortAddress(payee.address)}
                  </span>
                </span>
              </span>
              <span role="cell" className={styles.cell}>{chainLabel(payee.chain)}</span>
              <span role="cell" className={`${styles.cell} mono ${styles.address}`}>{payee.address}</span>
              <span role="cell" className={styles.count}>
                {history.count} <span className={styles.mobileOnly}>payment{history.count === 1 ? "" : "s"}</span>
              </span>
              <span role="cell" className={styles.cell}>{history.last ? formatWhen(history.last.settled_at ?? history.last.created_at) : "Never"}</span>
              <span role="cell" className={styles.actions}>
                {isOwner && (
                  <OwnerButton method="remove_payee" args={{ chain: payee.chain, address: payee.address }} variant="ghost" size="sm" success="Removed">
                    Remove
                  </OwnerButton>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className={styles.lower}>
        <section id="add" className={`${styles.form} rise`} style={delay(260)} aria-labelledby="add-title">
          <h2 id="add-title" className={styles.h2}>Add a payee</h2>
          <label className={styles.field}>
            <span>Name</span>
            <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Kano Cotton Mills" />
          </label>
          <label className={styles.field}>
            <span>Chain</span>
            <select value={chain} onChange={(e) => setChain(e.target.value)}>
              {CHAINS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Address</span>
            <input className="mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={chain === "near" ? "supplier.near" : "0x…"} spellCheck={false} autoCapitalize="off" />
          </label>
          <p className={styles.helper}>Veto won't trust a new address until you confirm it with your wallet.</p>
          {canAdd ? (
            <OwnerButton
              method="add_payee"
              args={{ name: name.trim(), chain, address: address.trim() }}
              success="Added"
              onDone={() => {
                setName("");
                setAddress("");
              }}
            >
              Confirm with wallet
            </OwnerButton>
          ) : (
            <p className={styles.helper}>Enter a name and an address to add them.</p>
          )}
        </section>

        <section className={`${styles.blocked} rise`} style={delay(320)} aria-labelledby="blocked-title">
          <h2 id="blocked-title" className={styles.h2}>Blocked lookalikes</h2>
          <p className={styles.helper}>Addresses Veto refused because they imitate a saved payee. They stay off your list unless you add them.</p>
          {blocked.length === 0 && <p className={styles.emptyBlocked}>None so far.</p>}
          {blocked.map(({ p, look }) => {
            const parts = compareAddresses(look.payee.address, p.request.payee);
            return (
              <Link key={p.id} href={`/app/decisions/${p.id}`} className={`${styles.blockedRow} press`}>
                <span className={styles.blockedIcon} aria-hidden="true">
                  <Icon name="x" size={16} stroke={2.5} />
                </span>
                <span className={styles.blockedText}>
                  <span className="mono">
                    {parts.requested.start}
                    <mark>{parts.requested.middle}</mark>
                    {parts.requested.end}
                  </span>
                  <span className={styles.blockedSub}>
                    Lookalike of {look.payee.name} · blocked {tries(p) > 1 ? `${tries(p)} times, last ` : ""}{formatWhen(p.verdict?.recorded_at ?? p.created_at)}
                  </span>
                </span>
                <Icon name="arrowRight" size={16} />
              </Link>
            );
          })}
        </section>
      </div>
    </Screen>
    </Boot>
  );
}
