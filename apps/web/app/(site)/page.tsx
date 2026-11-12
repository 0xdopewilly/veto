import Link from "next/link";
import { Icon } from "@/components/Icon";
import { Circuit } from "@/components/Circuit";
import { LineReveal } from "@/components/LineReveal";
import { Magnetic } from "@/components/Magnetic";
import { Parallax } from "@/components/Parallax";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import { SmoothScroll } from "@/components/SmoothScroll";
import { StoryScroll } from "@/components/StoryScroll";
import { GITHUB_URL } from "@/lib/config";
import { formatAmount, formatShort } from "@/lib/format";
// Built into the page, so the Bench figures below are the published run's (bench/publish.ts writes it).
import bench from "@/public/bench/results.json";
import styles from "./landing.module.css";

const USDC = { symbol: "USDC", decimals: 6 };

// The hero's example is the sandbox's own scam email: Kano Cotton Mills' "new account" is
// kano-cottom, one letter off the saved kano-cotton. The sandbox vetoed it as decision #163.
const EXAMPLE = { amount: "140000000", cap: "500000000", payee: "kano-cottom", saved: "kano-cotton" };

const THEFTS = [
  {
    title: "Lookalike addresses",
    text: "An address that shares your supplier's first and last characters. Shortened, the two look the same.",
  },
  {
    title: "Changed payout details",
    text: "An invoice says a supplier's wallet has changed, or a “worker” asks for their salary at a new one. The new address belongs to someone else.",
  },
  {
    title: "Planted instructions",
    text: "A page or document your agent reads tells it where to send money. The agent can't tell an instruction from data.",
  },
  {
    title: "Unlimited token approvals",
    text: "One signature lets an unverified contract spend every USDC in the vault, now or later.",
  },
  {
    title: "Invoices paid twice",
    text: "A reminder for an invoice you already paid. Right supplier, right address, so an allowlist pays it again.",
  },
  {
    title: "Padded amounts",
    text: "The agent pays a listed supplier more than the invoice says. It's under the limit and on the list, so a plain policy pays it.",
  },
];

const GATES = [
  {
    title: "Hard limits",
    text: "The vault contract on NEAR enforces the per-payment and weekly limits and the allowed assets, and can require listed payees. An agent can't talk its way past them.",
    tag: "Enforced on-chain",
    tone: "green",
  },
  {
    title: "Private AI screen",
    text: "A model inside a hardware enclave reads each request against your rules and payment history, then signs a pass or a veto. The contract checks that signature.",
    tag: "Can only veto",
    tone: "coral",
  },
  {
    title: "Your override",
    text: "If Veto blocks a payment you want made, you can override it. It pays only after a delay (3 minutes in the demo), and you can cancel it until then.",
    tag: "Time-delayed",
    tone: "purple",
  },
] as const;

// A real chain of checks, in order: each step rests on the one before.
const CHAIN = [
  {
    title: "The enclave is genuine",
    text: "Intel's TDX quote and NVIDIA's GPU evidence show the model runs in a real enclave. Any Proof page can re-check both live.",
    value: "Qwen3-VL-30B on NEAR AI Cloud",
    mono: false,
  },
  {
    title: "The enclave signed the verdict",
    text: "It signs the request and the verdict with a key that never leaves the enclave.",
    value: "Signing key 0x2665…5462",
    mono: true,
  },
  {
    title: "The contract checked the signer",
    text: "The vault recovers who signed each verdict. It refuses any verdict not signed by a model key the owner approved.",
    value: "Checked on-chain, every payment",
    mono: false,
  },
];

const NEAR = [
  { title: "NEAR Intents", text: "Pays a supplier on another chain from one vault balance. The vault checks that 1Click's signed quote pays exactly the screened payee and amount. The first mainnet payout, $2.00 to a supplier on Base, landed on 12 Nov 2026.", icon: "globe" },
  { title: "Chain Signatures", text: "The vault has its own address on Base. It builds each passed transfer itself, and NEAR's MPC network signs exactly that, nothing else.", icon: "key" },
  { title: "NEAR AI Cloud", text: "Private inference inside hardware enclaves, with every response signed by the model's enclave key.", icon: "shield" },
  { title: "NEAR accounts", text: "In a vault you create, the agent's only key can only propose payments. The guardian's can only record verdicts and settle payments.", icon: "bot" },
  { title: "Intents Agent API", text: "An agent account on NEAR Intents whose owner-signed policy is the hard limit. Veto holds its only grant, so the agent can only ask, and only a pass is sent.", icon: "wallet" },
  { title: "OutLayer agent wallets", text: "Veto is an approver on an OutLayer wallet's policy, so a wallet it doesn't hold gets the same caps, screen and record.", icon: "lock" },
] as const;

/** The published run's headline figures: the screen model against the caps-and-allowlist baseline. */
function benchFigures() {
  const policy = bench.models.find((m) => m.model.startsWith("baseline/"));
  const model = bench.models.find((m) => !m.model.startsWith("baseline/") && !m.model.startsWith("veto-dev/"));
  if (!policy || !model) return null;
  const honest = model.normal_total - model.normal_blocked;
  return [
    { value: `${model.attacks_caught} of ${model.attacks_total}`, label: "attacks caught by Veto" },
    { value: `${policy.attacks_total - policy.attacks_caught} of ${policy.attacks_total}`, label: "attacks paid by caps and an allowlist" },
    { value: `${honest} of ${honest}`, label: "honest payments to saved suppliers paid" },
  ];
}

export default function Landing() {
  const figures = benchFigures();
  const held = bench.models.find((m) => m.model.startsWith("baseline/"))?.normal_blocked;

  return (
    <div className={styles.page}>
      <SmoothScroll />
      <RevealOnScroll />
      <main>
        <section className={styles.hero} aria-label="Introduction">
          <div className={`${styles.heroPanel} notched`}>
            <div className={styles.heroText}>
              <LineReveal as="h1" className={styles.h1} lines={["A second signer", "that can only", "say no."]} delay={80} />
              <p className={`${styles.heroLead} rise`} style={{ animationDelay: "320ms" }}>
                Veto screens every payment your AI agent makes, privately, before it leaves the vault. It can block a payment. It can never approve more than your limits allow.
              </p>
              <div className={`${styles.heroButtons} rise`} style={{ animationDelay: "420ms" }}>
                <Magnetic className={styles.desktopOnly}>
                  <Link href="/app" className={`${styles.primary} press`}>
                    Open the demo vault
                    <span className={styles.primaryArrow} aria-hidden="true">
                      <Icon name="arrowRight" size={17} stroke={2.4} />
                    </span>
                  </Link>
                </Magnetic>
                <Link href="/start" className={`${styles.primary} ${styles.mobileOnly} press`}>
                  Open the demo vault
                  <span className={styles.primaryArrow} aria-hidden="true">
                    <Icon name="arrowRight" size={17} stroke={2.4} />
                  </span>
                </Link>
                <Magnetic>
                  <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={`${styles.secondary} press`}>
                    <Icon name="github" size={17} />
                    View on GitHub
                  </a>
                </Magnetic>
              </div>
              <p className={`${styles.heroStatus} rise`} style={{ animationDelay: "500ms" }}>
                Live on NEAR testnet. No wallet needed.
              </p>
            </div>

            <div className={styles.heroVisual}>
              <Parallax speed={-0.06}>
                <div className={`${styles.circuitCard} rise`} style={{ animationDelay: "380ms" }}>
                  <Circuit ai="veto" paid={false} large delay={900} />
                  <p className={styles.circuitCaption}>
                    {formatShort(EXAMPLE.amount, USDC)} is under the {formatShort(EXAMPLE.cap, USDC)} per-payment limit. A plain spending limit would have paid it.
                  </p>
                </div>
              </Parallax>
              <Parallax speed={0.05} className={styles.slamWrap}>
                <div className={styles.slam} role="group" aria-label="Example decision">
                  <span className={styles.slamLabel}>Vetoed</span>
                  <span className={`${styles.slamAmount} tabular`}>{formatAmount(EXAMPLE.amount, USDC)}</span>
                  <span className={styles.slamReason}>Lookalike of Kano Cotton Mills</span>
                  <span className={styles.slamAddress}>
                    <span className="mono">{EXAMPLE.payee}</span>, not <span className="mono">{EXAMPLE.saved}</span>
                  </span>
                </div>
              </Parallax>
            </div>
          </div>
          <a href="#theft" className={`${styles.scrollPill} press`}>
            See what it stops
            <Icon name="chevronDown" size={16} />
          </a>
        </section>

        <section id="theft" className={styles.sand} aria-labelledby="theft-title">
          <div className={styles.sandInner}>
            <LineReveal as="h2" id="theft-title" className={`${styles.h2} ${styles.lines}`} lines={["Caps and allowlists", "stop strangers"]} />
            <p className={`${styles.sandLead} ${styles.reveal}`} data-reveal>
              Veto stops the payments that look legitimate. Every one of these fits inside a normal weekly limit, and the last two pay a supplier already on your list.
            </p>
            <ul className={styles.theftGrid}>
              {THEFTS.map((t) => (
                <li key={t.title} className={`${styles.theft} ${styles.reveal}`} data-reveal>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <StoryScroll
          title="Two gates. The AI can only say no."
          lead="Every payment your agent asks for has to pass both. The AI can block what the contract would allow. It can never allow what the contract would block."
          gates={GATES}
        />

        <section id="proof" className={styles.section} aria-labelledby="proof-title">
          <div className={`${styles.panel} ${styles.proofGrid}`}>
            <div>
              <LineReveal as="h2" id="proof-title" className={`${styles.h2} ${styles.lines}`} text="Proof you can check" />
              <p className={`${styles.lead} ${styles.reveal}`} data-reveal>
                Every decision has a Proof page. It checks the verdict&apos;s signer against NEAR&apos;s public RPC and re-checks NEAR AI&apos;s enclave, in your own browser.
              </p>
              <a className={`${styles.pillLink} ${styles.reveal} press`} href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer" data-reveal>
                Open the NEAR AI verifier <Icon name="external" size={16} />
              </a>
              <p className={`${styles.note} ${styles.reveal}`} data-reveal>
                This proves where a verdict came from. It can&apos;t prove the verdict was right, which is why the AI can only say no.
              </p>
            </div>
            <ol className={styles.chain}>
              {CHAIN.map((c, i) => (
                <li key={c.title} className={`${styles.chainStep} ${styles.reveal}`} data-reveal>
                  <span className={styles.chainNumber} aria-hidden="true">{i + 1}</span>
                  <span className={styles.chainBody}>
                    <span className={styles.chainTitle}>{c.title}</span>
                    <span className={styles.chainText}>{c.text}</span>
                    <span className={`${styles.chainValue} ${c.mono ? "mono" : ""}`}>{c.value}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="near-title">
          <div className={styles.wrap}>
            <LineReveal as="h2" id="near-title" className={`${styles.h2} ${styles.wrapTitle} ${styles.lines}`} text="Built on NEAR" />
            <div className={styles.nearGrid}>
              {NEAR.map((n) => (
                <article key={n.title} className={`${styles.nearTile} ${styles.reveal} spot`} data-reveal>
                  <span className={styles.nearIcon} aria-hidden="true">
                    <Icon name={n.icon} size={20} />
                  </span>
                  <h3 className={styles.nearTitle}>{n.title}</h3>
                  <p className={styles.nearText}>{n.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="bench-title">
          <div className={`${styles.benchPanel} ${styles.reveal}`} data-reveal>
            <div className={styles.benchText}>
              <h2 id="bench-title" className={styles.h2}>Veto Bench</h2>
              <p className={styles.benchLead}>
                100 payment scenarios, half of them attacks, screened by <span className={styles.nowrap}>Qwen3-VL-30B</span> inside NEAR AI&apos;s enclave.
                {held ? ` Both Veto and the plain policy hold the ${held} first payments to new suppliers for the owner.` : ""} Every verdict is signed and re-checks offline.
              </p>
            </div>
            {figures && (
              <dl className={styles.benchFigures}>
                {figures.map((f) => (
                  <div key={f.label}>
                    <dt>{f.label}</dt>
                    <dd className="tabular">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Magnetic>
              <Link href="/bench" className={`${styles.benchButton} press`}>
                See the bench
                <span className={styles.primaryArrow} aria-hidden="true">
                  <Icon name="arrowRight" size={17} stroke={2.4} />
                </span>
              </Link>
            </Magnetic>
          </div>
        </section>
      </main>
    </div>
  );
}
