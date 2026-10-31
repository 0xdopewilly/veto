import Link from "next/link";
import { Lockup } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { Circuit } from "@/components/Circuit";
import { LineReveal } from "@/components/LineReveal";
import { Magnetic } from "@/components/Magnetic";
import { Parallax } from "@/components/Parallax";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import { SmoothScroll } from "@/components/SmoothScroll";
import { StoryScroll } from "@/components/StoryScroll";
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
  { title: "NEAR Intents", text: "Pays a supplier on any chain, in the asset they want, from one vault balance.", icon: "globe" },
  { title: "Chain Signatures", text: "One vault contract controls addresses on Base, Arbitrum and more, and only signs after both gates pass.", icon: "key" },
  { title: "NEAR AI Cloud", text: "Private inference inside TEEs, with every response signed by the model's enclave key.", icon: "shield" },
  { title: "NEAR accounts", text: "The agent is a sub-account whose function-call key can only propose payments. Gas keys give each agent its own budget.", icon: "bot" },
] as const;

export default function Landing() {
  return (
    <div className={styles.page}>
      <SmoothScroll />
      <RevealOnScroll />
      <header className={styles.top}>
        <div className={styles.topInner}>
          <Link href="/" className={styles.brand} aria-label="Veto home">
            <Lockup size={24} />
          </Link>
          <nav aria-label="Site" className={styles.topNav}>
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <Link href="/bench">Bench</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <Magnetic strength={0.22} className={styles.desktopOnly}>
            <Link href="/app" className={`${styles.cta} press`}>
              Open the demo vault
              <span className={styles.ctaArrow} aria-hidden="true">
                <Icon name="arrowRight" size={15} stroke={2.4} />
              </span>
            </Link>
          </Magnetic>
          <Link href="/start" className={`${styles.ctaRound} ${styles.mobileOnly} press`} aria-label="Open the demo vault">
            <Icon name="arrowRight" size={18} stroke={2.4} />
          </Link>
        </div>
      </header>

      <main>
        <section className={styles.hero} aria-label="Introduction">
          <div className={`${styles.heroPanel} notched`}>
            <span className={styles.heroGlow} aria-hidden="true" />
            <div className={styles.heroText}>
              <span className={`${styles.kicker} rise`}>
                <span className={styles.kickerDot} aria-hidden="true" />
                Live on NEAR testnet
              </span>
              <LineReveal as="h1" className={styles.h1} lines={["A second signer", "for money that", "moves on its own."]} delay={80} />
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
            </div>

            <div className={styles.heroVisual}>
              <Parallax speed={-0.06}>
                <div className={`${styles.circuitCard} rise`} style={{ animationDelay: "380ms" }}>
                  <Circuit ai="veto" paid={false} large delay={900} />
                  <p className={styles.circuitCaption}>$300 fits in the $320 left of the $500 weekly cap. A plain spending limit would have paid it.</p>
                </div>
              </Parallax>
              <Parallax speed={0.05} className={styles.slamWrap}>
                <div className={styles.slam} aria-label="Example decision">
                  <span className={styles.slamLabel}>
                    <span className={styles.slamDot} aria-hidden="true" />
                    Vetoed
                  </span>
                  <span className={styles.slamAmount}>
                    $300.00 <span>USDC</span>
                  </span>
                  <span className={styles.slamReason}>Lookalike of Kano Cotton Mills&apos; address</span>
                  <span className={`mono ${styles.slamAddress}`}>0xA11c…D9F2 on Base</span>
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
            <LineReveal as="h2" id="theft-title" className={`${styles.h2} ${styles.lines}`} lines={["Spending limits miss", "the theft that matters"]} />
            <p className={`${styles.sandLead} ${styles.reveal}`} data-reveal>Each of these can sit inside a normal weekly limit.</p>
            <div className={styles.theftGrid}>
              {THEFTS.map((t, i) => (
                <article key={t.title} className={`${styles.theft} ${styles.reveal}`} data-reveal style={{ ["--i" as string]: i }}>
                  <span className={styles.theftNumber} aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <StoryScroll
          title="Two gates. The AI can only say no."
          lead="Every payment your agent requests has to pass both. The AI can block what the contract would allow. It can never allow what the contract would block."
          gates={GATES}
        />

        <section id="proof" className={styles.section} aria-labelledby="proof-title">
          <div className={`${styles.panel} ${styles.proofGrid}`}>
            <div>
              <LineReveal as="h2" id="proof-title" className={`${styles.h2} ${styles.lines}`} text="Proof you can check" />
              <p className={`${styles.lead} ${styles.reveal}`} data-reveal>Every verdict carries evidence that anyone can check without trusting us.</p>
              <a className={`${styles.pillLink} ${styles.reveal} press`} href="https://cloud.near.ai/verify" target="_blank" rel="noreferrer" data-reveal>
                Open the NEAR AI verifier <Icon name="external" size={16} />
              </a>
              <p className={`${styles.note} ${styles.reveal}`} data-reveal>This proves where a verdict came from, not that it was right. That is why the AI can only veto.</p>
            </div>
            <ol className={styles.chain}>
              {CHAIN.map((c, i) => (
                <li key={c.title} className={`${styles.chainStep} ${styles.reveal}`} data-reveal>
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

        <section className={styles.section} aria-labelledby="near-title">
          <div className={styles.wrap}>
            <LineReveal as="h2" id="near-title" className={`${styles.h2} ${styles.lines}`} text="Built on NEAR" />
            <div className={styles.nearGrid}>
              {NEAR.map((n) => (
                <article key={n.title} className={`${styles.nearTile} ${styles.reveal} spot`} data-reveal>
                  <span className={styles.nearIcon} aria-hidden="true">
                    <Icon name={n.icon} size={20} />
                  </span>
                  <span className={styles.nearTitle}>{n.title}</span>
                  <span className={styles.nearText}>{n.text}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="bench-title">
          <div className={`${styles.benchPanel} ${styles.reveal}`} data-reveal>
            <div>
              <h2 id="bench-title" className={styles.h2}>Veto Bench</h2>
              <p className={styles.benchLead}>
                A public set of attack and everyday payment scenarios. Each model is scored on the attacks it catches and the honest payments it wrongly blocks.
              </p>
            </div>
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
