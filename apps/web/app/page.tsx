import Link from "next/link";
import { Lockup } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { Circuit } from "@/components/Circuit";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import { GITHUB_URL } from "@/lib/config";
import styles from "./landing.module.css";

const THEFTS = [
  {
    title: "Lookalike addresses",
    text: "An address that shares your supplier's first and last characters. Shortened, the two look identical.",
  },
  {
    title: "Changed payout details",
    text: "An invoice or email says the supplier's wallet has changed. The new address belongs to someone else.",
  },
  {
    title: "Prompt-injected instructions",
    text: "A page or document your agent reads tells it where to send money. The agent can't tell an instruction from data.",
  },
  {
    title: "Unlimited token approvals",
    text: "One signature lets an unverified contract spend every USDC in the vault, now or later.",
  },
];

const GATES = [
  {
    title: "Contract caps",
    text: "Weekly limits, allowed assets and listed payees are enforced by the vault contract on NEAR. An agent can't talk its way past them.",
    tag: "Enforced on-chain",
    tone: "green",
  },
  {
    title: "Private AI screen",
    text: "A model inside a hardware enclave reads the request with your mandate and payment history, then returns a signed pass or veto. Your data stays in the enclave.",
    tag: "Can only veto",
    tone: "coral",
  },
  {
    title: "Your override",
    text: "If Veto blocks a payment you want made, you can override it. The payment waits 24 hours, and you can cancel it until then.",
    tag: "24-hour delay",
    tone: "purple",
  },
] as const;

const CHAIN = [
  { title: "Enclave attestation", text: "Intel Trust Authority confirms the model runs in a genuine Intel TDX enclave.", value: "glm-5.3-flash" },
  { title: "Model signature", text: "The enclave signs the request hash and the verdict with a key that never leaves it.", value: "0x3b75…fa0c" },
  { title: "On-chain check", text: "The vault contract recovers the signer with ecrecover and refuses any verdict not signed by the approved model key.", value: "ecrecover → 0x3b75…fa0c" },
];

const NEAR = [
  { title: "NEAR Intents", text: "Pays a supplier on any chain, in the asset they want, from one vault balance." },
  { title: "Chain Signatures", text: "One vault contract controls addresses on Base, Arbitrum and more, and only signs after both gates pass." },
  { title: "NEAR AI Cloud", text: "Private inference inside TEEs, with every response signed by the model's enclave key." },
  { title: "NEAR accounts", text: "The agent is a sub-account whose function-call key can only propose payments. Gas keys give each agent its own budget." },
];

export default function Landing() {
  return (
    <div className={styles.page}>
      <RevealOnScroll />
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Link href="/" className={styles.brand} aria-label="Veto home">
            <Lockup size={25} />
          </Link>
          <nav aria-label="Site" className={styles.topNav}>
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <Link href="/bench">Bench</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <Link href="/app" className={`${styles.cta} press`}>
            Open the demo vault
          </Link>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-label="Introduction">
          <div className={styles.heroText}>
            <h1 className={`${styles.h1} rise`}>A second signer for money that moves on its own.</h1>
            <p className={`${styles.heroLead} rise`} style={{ animationDelay: "120ms" }}>
              Veto screens every payment your AI agent makes, privately, before it leaves the vault. It can block a payment. It can never approve more than your limits allow.
            </p>
            <div className={`${styles.heroButtons} rise`} style={{ animationDelay: "240ms" }}>
              <Link href="/app" className={`${styles.primary} ${styles.desktopOnly} press`}>
                <Icon name="arrowRight" size={18} stroke={2.25} />
                Open the demo vault
              </Link>
              <Link href="/start" className={`${styles.primary} ${styles.mobileOnly} press`}>
                <Icon name="arrowRight" size={18} stroke={2.25} />
                Open the demo vault
              </Link>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={`${styles.secondary} press`}>
                View on GitHub
              </a>
            </div>
          </div>

          <div className={styles.heroVisual}>
            <div className={`${styles.circuitCard} rise`} style={{ animationDelay: "300ms" }}>
              <Circuit ai="veto" paid={false} large delay={600} />
              <p className={styles.circuitCaption}>$300 fits in the $320 left of the $500 weekly cap. A plain spending limit would have paid it.</p>
            </div>
            <div className={styles.slam} aria-label="Example decision">
              <span className={styles.slamLabel}>Vetoed</span>
              <span className={`${styles.slamAmount} tabular`}>
                $300.00 <span>USDC</span>
              </span>
              <span className={styles.slamReason}>Lookalike of Kano Cotton Mills' address</span>
              <span className={`mono ${styles.slamAddress}`}>0xA11c…D9F2 on Base</span>
            </div>
          </div>
        </section>

        <section className={styles.sand} aria-labelledby="theft-title">
          <div className={styles.wrap}>
            <h2 id="theft-title" className={`${styles.h2} ${styles.reveal} ${styles.reveal}`} data-reveal>Spending limits miss the theft that matters</h2>
            <p className={`${styles.sandLead} ${styles.reveal} ${styles.reveal}`} data-reveal>Each of these can sit inside a normal weekly limit.</p>
            <div className={styles.theftGrid}>
              {THEFTS.map((t) => (
                <article key={t.title} className={`${styles.theft} ${styles.reveal} ${styles.reveal}`} data-reveal>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className={styles.section} aria-labelledby="gates-title">
          <div className={styles.wrap}>
            <h2 id="gates-title" className={`${styles.h2} ${styles.reveal} ${styles.reveal}`} data-reveal>Two gates. The AI can only say no.</h2>
            <p className={`${styles.lead} ${styles.reveal} ${styles.reveal}`} data-reveal>
              Every payment your agent requests has to pass both. The AI can block what the contract would allow. It can never allow what the contract would block.
            </p>
            <div className={styles.gates}>
              {GATES.map((g) => (
                <article key={g.title} className={`${styles.gate} ${styles.reveal} ${styles.reveal}`} data-reveal>
                  <h3>{g.title}</h3>
                  <p>{g.text}</p>
                  <span className={`${styles.tag} ${styles[g.tone]}`}>{g.tag}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="proof" className={`${styles.section} ${styles.bordered}`} aria-labelledby="proof-title">
          <div className={`${styles.wrap} ${styles.proofGrid}`}>
            <div>
              <h2 id="proof-title" className={`${styles.h2} ${styles.reveal} ${styles.reveal}`} data-reveal>Proof you can check</h2>
              <p className={`${styles.lead} ${styles.reveal} ${styles.reveal}`} data-reveal>Every verdict carries evidence that anyone can check without trusting us.</p>
              <a className={`${styles.textLink} ${styles.reveal} press`} href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer" data-reveal>
                Open the NEAR AI verifier <Icon name="external" size={16} />
              </a>
              <p className={`${styles.note} ${styles.reveal} ${styles.reveal}`} data-reveal>This proves where a verdict came from, not that it was right. That is why the AI can only veto.</p>
            </div>
            <ol className={styles.chain}>
              {CHAIN.map((c, i) => (
                <li key={c.title} className={`${styles.chainStep} ${styles.reveal} ${styles.reveal}`} data-reveal>
                  <span className={styles.chainNumber}>{i + 1}</span>
                  <span className={styles.chainBody}>
                    <span className={styles.chainTitle}>{c.title}</span>
                    <span className={styles.chainText}>{c.text}</span>
                    <span className={`mono ${styles.chainValue}`}>{c.value}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={`${styles.section} ${styles.bordered}`} aria-labelledby="near-title">
          <div className={styles.wrap}>
            <h2 id="near-title" className={`${styles.h2} ${styles.reveal} ${styles.reveal}`} data-reveal>Built on NEAR</h2>
            <div className={styles.nearGrid}>
              {NEAR.map((n) => (
                <article key={n.title} className={`${styles.nearRow} ${styles.reveal} ${styles.reveal}`} data-reveal>
                  <span className={styles.nearTitle}>{n.title}</span>
                  <span className={styles.nearText}>{n.text}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.bordered}`} aria-labelledby="bench-title">
          <div className={`${styles.wrap} ${styles.benchRow}`}>
            <div>
              <h2 id="bench-title" className={`${styles.h2} ${styles.reveal} ${styles.reveal}`} data-reveal>Veto Bench</h2>
              <p className={`${styles.lead} ${styles.reveal} ${styles.reveal}`} data-reveal>
                A public set of attack and everyday payment scenarios. Each model is scored on the attacks it catches and the honest payments it wrongly blocks.
              </p>
            </div>
            <Link href="/bench" className={`${styles.secondary} press ${styles.reveal}`} data-reveal>
              See the bench
            </Link>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={`${styles.wrap} ${styles.footerRow}`}>
          <Lockup size={20} />
          <span className={styles.footerText}>
            Built for NEAR HACKATHON 2026 · MIT licence ·{" "}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
