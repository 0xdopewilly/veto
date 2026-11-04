"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useWallet, txHashOf } from "@/lib/wallet";
import { accountExists, rememberVault, view, type FactoryVault } from "@/lib/vault";
import { useMyVaults } from "@/lib/myVaults";
import { EXPLORER, FACTORY_ID, NETWORK, SANDBOX_ID } from "@/lib/config";
import { SPRING_UI, useCalm } from "@/lib/motion";
import { BackLink, delay } from "@/components/Screen";
import { Lockup } from "@/components/Logo";
import { Circuit } from "@/components/Circuit";
import { Pill } from "@/components/Pill";
import { Icon, type IconName } from "@/components/Icon";
import { LineReveal } from "@/components/LineReveal";
import { VLoader } from "@/components/VLoader";
import styles from "./StartViews.module.css";

const DEFAULT_MANDATE = "Pay listed suppliers only, in USDC. No single payment over $500. Ask me before paying a new or changed address.";
const MAX_VAULTS = 3;

/** What a new testnet vault starts with; the owner can change all of it. */
const STARTER: { icon: IconName; text: string }[] = [
  { icon: "wallet", text: "$5,000 test USDC" },
  { icon: "shield", text: "Up to $500 a payment and $3,000 a week" },
  { icon: "users", text: "Two test suppliers: Kano Cotton Mills and Ibadan Dye Works" },
  { icon: "bot", text: "Its own test agent, screened by Qwen3 in a NEAR AI enclave" },
];

export function WelcomeView() {
  const router = useRouter();
  const { accountId, connect } = useWallet();

  return (
    <div className={styles.screen}>
      <header className={`${styles.header} rise`}>
        <Lockup size={25} />
        <Link href="/" className={`${styles.aboutLink} press`}>
          About Veto
        </Link>
      </header>

      <section className={styles.intro} aria-label="Introduction">
        <LineReveal as="h1" className={styles.h1} lines={["A second signer", "that can only", "say no."]} delay={80} />
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
          {accountId ? "Create your vault" : "Connect a NEAR wallet"}
        </Pill>
        <Pill
          variant="secondary"
          size="md"
          full
          onClick={() => {
            rememberVault(SANDBOX_ID);
            router.push("/app");
          }}
        >
          Try the shared sandbox
        </Pill>
      </div>
      <p className={styles.footnote}>
        {NETWORK === "testnet" ? "On NEAR testnet: free test tokens, real contracts. " : ""}Built on NEAR AI Cloud, NEAR Intents and NEAR&apos;s access keys.
      </p>
    </div>
  );
}

/** "Ada's Fabrics" -> "adas-fabrics": a valid NEAR sub-account name. */
function slugOf(label: string) {
  return label
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
}

const NAME_OK = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Phase = { step: "form" } | { step: "signing" } | { step: "creating"; tx?: string } | { step: "done"; vault: string };

export function VaultSetupView() {
  const router = useRouter();
  const calm = useCalm();
  const { accountId, ready, connect, callContract, gas } = useWallet();
  const [reload, setReload] = useState(0);
  const mine = useMyVaults(accountId, reload);
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [mandate, setMandate] = useState(DEFAULT_MANDATE);
  const [taken, setTaken] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "form" });
  const [error, setError] = useState<string | null>(null);
  const checkSeq = useRef(0);

  const slug = nameEdited ? name : slugOf(label);
  const vaultId = slug ? `${slug}.${FACTORY_ID}` : "";
  const nameValid = slug.length >= 2 && slug.length <= 24 && NAME_OK.test(slug);
  const atLimit = (mine?.length ?? 0) >= MAX_VAULTS;
  const busy = phase.step === "signing" || phase.step === "creating";
  const fueling = gas.state === "sending";

  // Is the name free? Checked a moment after typing stops.
  useEffect(() => {
    setTaken(null);
    if (!nameValid || !FACTORY_ID) return;
    const seq = ++checkSeq.current;
    const timer = setTimeout(() => {
      accountExists(vaultId)
        .then((exists) => seq === checkSeq.current && setTaken(exists))
        .catch(() => {});
    }, 380);
    return () => clearTimeout(timer);
  }, [vaultId, nameValid]);

  const open = (id: string, name: string) => {
    rememberVault(id, name);
    router.push("/app");
  };

  const create = async () => {
    setError(null);
    if (!accountId) return connect();
    if (!label.trim()) return setError("Give your vault a name.");
    if (!nameValid) return setError("The account name needs 2-24 lowercase letters, digits or single dashes.");
    if (taken) return setError("That account name is taken. Try another.");
    if (fueling) return;
    setPhase({ step: "signing" });
    try {
      const result = await callContract(FACTORY_ID, "create_vault", { name: slug, label: label.trim(), mandate: mandate.trim() === DEFAULT_MANDATE ? null : mandate.trim() }, 150);
      setPhase({ step: "creating", tx: txHashOf(result) });
      // The factory records the vault once the new account is set up; wait for it.
      for (let i = 0; i < 30; i++) {
        const found = await view<FactoryVault | null>(FACTORY_ID, "get_vault", { vault: vaultId }).catch(() => null);
        if (found) {
          rememberVault(vaultId, found.label);
          setPhase({ step: "done", vault: vaultId });
          setReload((n) => n + 1);
          setTimeout(() => router.push("/app"), calm ? 600 : 1500);
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("The vault wasn't created. The name may have just been taken; try another.");
    } catch (e) {
      const message = e instanceof Error ? e.message.replace(/^.*Smart contract panicked: /, "") : "The wallet didn't send the transaction.";
      setError(gas.state === "failed" && /enough test NEAR/.test(message) ? `${message} ${gas.reason}` : message);
      setPhase({ step: "form" });
    }
  };

  if (!FACTORY_ID) {
    return (
      <div className={styles.screen}>
        <div className={styles.topRow}>
          <BackLink href="/start" label="Back" />
        </div>
        <LineReveal as="h1" className={styles.title} text="Your vault" />
        <p className={`${styles.note} rise`} style={delay(60)}>
          <Icon name="shield" size={16} />
          Creating vaults isn&apos;t switched on for this deployment. The shared sandbox works without a wallet.
        </p>
        <div className={styles.spacer} />
        <Pill full href="/app" icon="arrowRight">
          Open the sandbox
        </Pill>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.topRow}>
        <BackLink href="/start" label="Back" />
        <span className={styles.step}>{accountId ? "Step 2 of 2" : "Step 1 of 2"}</span>
      </div>

      <LineReveal as="h1" className={styles.title} text="Create your vault" />
      <p className={`${styles.lead} ${styles.leadTight} rise`} style={delay(60)}>
        A NEAR contract that your wallet owns. Your agent asks it to pay; Veto screens every payment; only you can change the rules or override a veto.
      </p>

      {mine && mine.length > 0 && (
        <section className={`${styles.existing} rise`} style={delay(100)} aria-label="Your vaults">
          <span className={styles.existingLabel}>Your vaults</span>
          {mine.map((v) => (
            <button key={v.id} type="button" className={`${styles.existingRow} press`} onClick={() => open(v.id, v.label)}>
              <span className={styles.existingName}>{v.label}</span>
              <span className={`mono ${styles.existingId}`}>{v.id}</span>
              <Icon name="arrowRight" size={16} />
            </button>
          ))}
        </section>
      )}

      <div className={styles.fields}>
        <div className={`${styles.field} rise`} style={delay(140)}>
          <span>Owner</span>
          {accountId ? (
            <>
              <span className={styles.owner}>
                <span className={styles.ownerDot} aria-hidden="true" />
                <span className="mono">{accountId}</span>
              </span>
              <AnimatePresence initial={false}>
                {(gas.state === "sending" || gas.state === "sent" || gas.state === "failed") && (
                  <motion.span
                    key={gas.state}
                    className={styles.gasNote}
                    data-tone={gas.state}
                    role="status"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={SPRING_UI}
                  >
                    {gas.state === "sending" ? (
                      <>
                        <VLoader size={16} />
                        Your wallet is low on test NEAR. Sending it some for gas, free.
                      </>
                    ) : gas.state === "sent" ? (
                      <>
                        <Icon name="check" size={15} stroke={2.2} />
                        Sent your wallet {gas.amount} test NEAR for gas, free.
                      </>
                    ) : (
                      <>
                        <Icon name="shield" size={15} />
                        {gas.reason}
                      </>
                    )}
                  </motion.span>
                )}
              </AnimatePresence>
            </>
          ) : (
            <button type="button" className={`${styles.connectRow} press`} onClick={connect} disabled={!ready}>
              <Icon name="wallet" size={17} />
              {ready ? "Connect a NEAR testnet wallet" : "Loading wallets…"}
            </button>
          )}
        </div>

        <label className={`${styles.field} rise`} style={delay(190)}>
          <span>Business name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 48))} placeholder="Ada's Fabrics" disabled={busy} autoComplete="organization" />
        </label>

        <label className={`${styles.field} rise`} style={delay(240)}>
          <span>Vault account</span>
          <span className={styles.accountInput}>
            <input
              className="mono"
              value={slug}
              onChange={(e) => {
                setNameEdited(true);
                setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24));
              }}
              placeholder="adas-fabrics"
              disabled={busy}
              spellCheck={false}
              autoCapitalize="off"
            />
            <span className={styles.availability} aria-live="polite">
              {slug && !nameValid ? (
                <span className={styles.bad}>Invalid</span>
              ) : taken === true ? (
                <span className={styles.bad}>Taken</span>
              ) : taken === false ? (
                <span className={styles.good}>
                  <Icon name="check" size={14} stroke={2.4} /> Free
                </span>
              ) : null}
            </span>
          </span>
          <span className={`mono ${styles.suffix}`}>.{FACTORY_ID}</span>
        </label>

        <label className={`${styles.field} rise`} style={delay(290)}>
          <span>Mandate</span>
          <textarea value={mandate} onChange={(e) => setMandate(e.target.value.slice(0, 2000))} rows={3} disabled={busy} />
          <span className={styles.help}>What your agent may pay for, in your words. The AI screen reads it on every payment.</span>
        </label>
      </div>

      <section className={`${styles.fund} rise`} style={delay(340)} aria-labelledby="starter-title">
        <h2 id="starter-title" className={styles.h2}>It starts with</h2>
        <ul className={styles.starter}>
          {STARTER.map((s) => (
            <li key={s.text}>
              <span className={styles.starterIcon}>
                <Icon name={s.icon} size={15} />
              </span>
              {s.text}
            </li>
          ))}
        </ul>
        <p className={styles.help}>Testnet tokens, free. You can change the limits, suppliers and agents from the app; each change is signed by your wallet.</p>
      </section>

      <div className={styles.spacer} />

      <AnimatePresence mode="popLayout" initial={false}>
        {(error || phase.step === "creating" || phase.step === "done") && (
          <motion.div
            key={error ? "error" : phase.step}
            className={`${styles.statusRow} ${error ? styles.statusError : phase.step === "done" ? styles.statusDone : ""}`}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING_UI}
            role="status"
          >
            {error ? (
              <>
                <Icon name="x" size={16} stroke={2.2} />
                {error}
              </>
            ) : phase.step === "creating" ? (
              <>
                <VLoader size={20} />
                <span>
                  Creating {vaultId} on NEAR testnet…
                  {phase.tx && (
                    <a href={`${EXPLORER}/txns/${phase.tx}`} target="_blank" rel="noreferrer" className={styles.txLink}>
                      View transaction
                    </a>
                  )}
                </span>
              </>
            ) : (
              <>
                <Icon name="check" size={16} stroke={2.4} />
                Your vault is live. Opening it…
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`${styles.buttons} rise`} style={delay(400)}>
        <Pill full icon={accountId ? "plus" : "wallet"} onClick={create} loading={busy || fueling} disabled={phase.step === "done" || (!!accountId && atLimit)}>
          {!accountId ? "Connect a wallet" : atLimit ? `You have ${MAX_VAULTS} vaults, the testnet limit` : fueling ? "Getting your wallet gas" : phase.step === "signing" ? "Confirm in your wallet" : phase.step === "creating" ? "Creating your vault" : "Create vault"}
        </Pill>
        <Pill
          variant="secondary"
          size="md"
          full
          onClick={() => {
            rememberVault(SANDBOX_ID);
            router.push("/app");
          }}
        >
          Try the shared sandbox instead
        </Pill>
      </div>
    </div>
  );
}
