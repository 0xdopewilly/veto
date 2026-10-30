"use client";

import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { NETWORK, VAULT_ID, VAULT_NAME } from "@/lib/config";
import { BackLink, delay } from "@/components/Screen";
import { Lockup } from "@/components/Logo";
import { Circuit } from "@/components/Circuit";
import { Pill } from "@/components/Pill";
import { Icon } from "@/components/Icon";
import styles from "./StartViews.module.css";

export function WelcomeView() {
  const router = useRouter();
  const { accountId, connect } = useWallet();

  return (
    <div className={styles.screen}>
      <header className={`${styles.header} rise`}>
        <Lockup size={25} />
      </header>

      <section className={styles.intro} aria-label="Introduction">
        <h1 className={`${styles.h1} rise`} style={delay(80)}>A second signer that can only say no.</h1>
        <p className={`${styles.lead} rise`} style={delay(160)}>
          Veto screens every payment your agent makes, privately, before it leaves your vault. It can block a payment. It can never approve more than your limits allow.
        </p>
      </section>

      <figure className={`${styles.figure} rise`} style={delay(260)}>
        <Circuit ai="pass" paid delay={420} />
        <figcaption className={styles.caption}>Money moves only when both checks pass. Either one can stop it.</figcaption>
      </figure>

      <div className={styles.spacer} />

      <div className={`${styles.buttons} rise`} style={delay(380)}>
        <Pill
          full
          icon="wallet"
          onClick={async () => {
            if (!accountId) await connect();
            router.push("/start/vault");
          }}
        >
          {accountId ? "Continue" : "Connect a NEAR wallet"}
        </Pill>
        <Pill variant="secondary" size="md" full href="/app">
          Open the demo vault
        </Pill>
      </div>
      <p className={styles.footnote}>Built on NEAR Intents, Chain Signatures and NEAR AI Cloud.</p>
    </div>
  );
}

export function VaultSetupView() {
  const { accountId } = useWallet();
  const testnet = NETWORK === "testnet";

  return (
    <div className={styles.screen}>
      <div className={styles.topRow}>
        <BackLink href="/start" label="Back" />
        <span className={styles.step}>Step 1 of 2</span>
      </div>

      <h1 className={`${styles.title} rise`}>{testnet ? "Your vault" : "Create your vault"}</h1>
      {testnet && (
        <p className={`${styles.note} rise`} style={delay(60)}>
          <Icon name="shield" size={16} />
          Testnet demo: this opens the shared demo vault. Deploying your own vault takes one script; the README shows how.
        </p>
      )}

      <div className={styles.fields}>
        <label className={`${styles.field} rise`} style={delay(120)}>
          <span>Vault name</span>
          <input value={VAULT_NAME} readOnly />
        </label>
        <label className={`${styles.field} rise`} style={delay(180)}>
          <span>Vault account</span>
          <span className={styles.lockedInput}>
            <Icon name="lock" size={15} />
            <input className="mono" value={VAULT_ID} readOnly />
          </span>
          <span className={styles.help}>A NEAR sub-account. Only the owner's wallet can change its rules.</span>
        </label>
        <div className={`${styles.field} rise`} style={delay(240)}>
          <span>Signed in as</span>
          <span className={`${styles.signedIn} mono`}>{accountId ?? "Not connected"}</span>
        </div>
      </div>

      <section className={`${styles.fund} rise`} style={delay(300)} aria-labelledby="fund-title">
        <h2 id="fund-title" className={styles.h2}>Fund it</h2>
        <p className={styles.help}>
          Send from any chain. NEAR Intents converts it and delivers it to your vault.
          {testnet ? " On testnet the demo vault already holds test funds." : ""}
        </p>
      </section>

      <div className={styles.spacer} />

      <div className={`${styles.buttons} rise`} style={delay(360)}>
        <Pill full href="/app" icon="arrowRight">
          Open the demo vault
        </Pill>
      </div>
    </div>
  );
}
