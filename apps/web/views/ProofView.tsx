"use client";

import { metaOf, useVault } from "@/lib/vault";
import { useProposal } from "@/lib/useProposal";
import { isTestSigner, requesterLabel } from "@/lib/decision";
import { explorerAddress, verifierUrl } from "@/lib/config";
import { formatAmount, formatWhen, shortAddress, shortHash, chainLabel } from "@/lib/format";
import { Screen, BackLink, delay } from "@/components/Screen";
import { Icon, type IconName } from "@/components/Icon";
import { Boot } from "@/components/Boot";
import { LineReveal } from "@/components/LineReveal";
import styles from "./ProofView.module.css";

export function ProofView({ id }: { id: string }) {
  const { state, vaultId } = useVault();
  const { proposal: p, missing } = useProposal(id);
  const back = `/app/decisions/${id}`;

  if (missing) {
    return (
      <Screen pushed>
        <BackLink href="/app" label="Back to overview" />
        <h1 className={styles.title}>No payment with that number</h1>
      </Screen>
    );
  }
  if (!state || !p) return <Boot loading caption="Loading the proof" />;

  const v = p.verdict;
  if (!v) {
    return (
      <Screen pushed>
        <BackLink href={back} label="Back to the decision" />
        <h1 className={styles.title}>No verdict yet</h1>
        <p className={styles.lead}>This payment hasn't been screened, so there is nothing to prove yet.</p>
      </Screen>
    );
  }

  const test = isTestSigner(v.model_id);
  const meta = metaOf(state, p.request.asset);
  const steps: { icon: IconName; title: string; text: string; value: string; tone?: "veto" | "pass" }[] = [
    {
      icon: "file",
      title: "Payment request",
      text: `${requesterLabel(p)} asked to send ${formatAmount(p.request.amount, meta)} to ${shortAddress(p.request.payee)}.`,
      value: `request hash ${shortHash(v.request_hash)}`,
    },
    ...(p.external
      ? [
          {
            icon: "lock" as IconName,
            title: "Held by OutLayer",
            text: "The agent's OutLayer wallet held the payment for approval. Its operation hash is part of what the model screened, and Veto votes on it only after your vault's verdict.",
            value: `approval ${shortHash(p.external.approval_id)}`,
          },
        ]
      : []),
    ...(p.evm
      ? [
          {
            icon: "key" as IconName,
            title: "Signed with NEAR Chain Signatures",
            text: `The vault built this exact transfer on ${chainLabel(p.request.chain)} and NEAR's MPC network signed it for the vault's own address. The vault never signs anything else.`,
            value: p.evm.tx_hash ? `tx ${shortHash(p.evm.tx_hash)}` : `signing hash ${shortHash(p.evm.signing_hash)}`,
          },
        ]
      : []),
    {
      icon: "shield",
      title: test ? "Screened by a test signer" : "Screened in an enclave",
      text: test
        ? "This verdict came from a local key used to check the vault before the model key was connected. It did not run in an enclave."
        : "NEAR AI Cloud ran the check inside an Intel TDX enclave. Intel Trust Authority attests the hardware.",
      value: v.model_id,
    },
    {
      icon: "key",
      title: test ? "Signed by the test key" : "Signed by the model",
      text: test
        ? "The test key signed the request and the verdict together, in the same format NEAR AI uses."
        : "The enclave signed the request and the verdict together, so neither can be swapped later.",
      value: shortAddress(v.signer),
    },
    {
      icon: "lock",
      title: "Checked by your vault",
      text: "Your vault contract recovered the signer with ecrecover and matched it to the approved model key.",
      value: `response hash ${shortHash(v.response_hash)}`,
    },
    {
      icon: v.pass ? "check" : "x",
      title: v.pass ? "Verdict: Pass" : "Verdict: Veto",
      text: p.external
        ? v.pass
          ? "Both checks passed, so Veto approved it on OutLayer and the wallet sent it."
          : "Veto never approved it, so the OutLayer wallet kept holding it. Nothing was paid."
        : v.pass
          ? "Both checks passed, so the vault sent the payment."
          : "The payment was refused. The funds never left the vault.",
      value: formatWhen(v.recorded_at),
      tone: v.pass ? "pass" : "veto",
    },
  ];

  return (
    <Boot>
    <Screen pushed wide>
      <BackLink href={back} label="Back to the decision" />
      <div className={styles.layout}>
        <div className={styles.main}>
          <LineReveal as="h1" className={styles.title} text="Proof" />
          <p className={`${styles.lead} rise`} style={delay(60)}>How this decision was made and checked.</p>

          <ol className={styles.timeline}>
            {steps.map((step, i) => (
              <li key={step.title} className={`${styles.step} rise`} style={delay(160 + i * 140)}>
                <span className={`${styles.icon} ${step.tone ? styles[step.tone] : ""} pop`} style={delay(200 + i * 140)}>
                  <Icon name={step.icon} size={16} stroke={2.25} />
                </span>
                <div className={styles.stepBody}>
                  <span className={`${styles.stepTitle} ${step.tone === "veto" ? styles.vetoText : ""}`}>{step.title}</span>
                  <p className={styles.stepText}>{step.text}</p>
                  <span className={`mono ${styles.value}`}>{step.value}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <aside className={`${styles.side} rise`} style={delay(900)}>
          <h2 className={styles.h2}>Check it yourself</h2>
          <a className={`${styles.linkRow} press`} href={verifierUrl(v.model_id)} target="_blank" rel="noreferrer">
            Open in the NEAR AI verifier <Icon name="external" size={16} />
          </a>
          <a className={`${styles.linkRow} press`} href={explorerAddress(vaultId ?? "")} target="_blank" rel="noreferrer">
            View the vault on NearBlocks <Icon name="external" size={16} />
          </a>
          <dl className={styles.facts}>
            <dt>Chat id</dt>
            <dd className="mono">{v.chat_id}</dd>
            <dt>Signer</dt>
            <dd className="mono">{v.signer}</dd>
            <dt>Request hash</dt>
            <dd className="mono">{v.request_hash}</dd>
            <dt>Response hash</dt>
            <dd className="mono">{v.response_hash}</dd>
          </dl>

          <h2 className={styles.h2}>What this proves</h2>
          <p className={styles.note}>
            The verdict came from this model{test ? "'s key" : ", running inside a genuine enclave,"} and nothing changed it on the way to your vault.
          </p>
          <p className={styles.note}>
            It doesn't prove the model judged correctly. That's why the AI can only veto. It can never approve more than your contract limits allow.
          </p>
        </aside>
      </div>
    </Screen>
    </Boot>
  );
}
