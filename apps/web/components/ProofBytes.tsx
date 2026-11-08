"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { canonicalJson, sha256Hex, type Proposal } from "@veto/core/proposal";
import { EXPLORER, PROOF_BASE } from "@/lib/config";
import { SPRING_UI, useCalm } from "@/lib/motion";
import { shortHash } from "@/lib/format";
import { Icon } from "./Icon";
import { VLoader } from "./VLoader";
import styles from "./ProofBytes.module.css";

/** meta.json, written by lib/server/proofs.ts next to the raw request and response bytes. */
interface ProofMeta {
  model: string;
  chat_id: string;
  evidence: unknown;
  tx: string;
}

interface Check {
  ok: boolean;
  title: string;
  detail: string;
}

type Status =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "done"; checks: Check[]; email: { from?: string; subject?: string; body?: string } | null; meta: ProofMeta; answer: string };

/** The evidence block inside the user message the model read (packages/core/src/prompt.ts). */
function evidenceInRequest(request: Uint8Array): unknown {
  const body = JSON.parse(new TextDecoder().decode(request)) as { messages?: { role: string; content: string }[] };
  const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
  const block = user.match(/<evidence>\n([\s\S]*)\n<\/evidence>/);
  return block ? JSON.parse(block[1]) : undefined;
}

/** The verdict JSON the model returned, as one short line. */
function answerIn(response: Uint8Array): string {
  const completion = JSON.parse(new TextDecoder().decode(response)) as { choices?: { message?: { content?: string } }[] };
  const content = completion.choices?.[0]?.message?.content ?? "";
  try {
    const v = JSON.parse(content) as { verdict?: string; reasons?: string[] };
    return `${v.verdict ?? "?"}${v.reasons?.length ? `: ${v.reasons.join(", ")}` : ""}`;
  } catch {
    return content.slice(0, 120);
  }
}

async function bytesOf(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the proof store answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * The sandbox publishes the exact bytes each verdict was signed over. This fetches them from the
 * public store and checks them here, in the browser, against what is on-chain: the request and
 * response hashes the enclave signed and the vault checked, and the email's hash the agent
 * committed to when it proposed the payment.
 */
export function ProofBytes({ vault, proposal }: { vault: string; proposal: Proposal }) {
  const calm = useCalm();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const v = proposal.verdict!;
  const base = `${PROOF_BASE}/proofs/${vault}/${proposal.id}`;

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // Published right after the verdict lands, so a decision seconds old may not be there yet.
    const fresh = Date.now() - Number(BigInt(v.recorded_at) / 1_000_000n) < 120_000;
    const load = async (attempt: number) => {
      try {
        const [request, response, metaBytes] = await Promise.all([bytesOf(`${base}/request.json`), bytesOf(`${base}/response.json`), bytesOf(`${base}/meta.json`)]);
        if (cancelled) return;
        if (!request || !response || !metaBytes) {
          if (fresh && attempt < 5) retry = setTimeout(() => load(attempt + 1), 3000);
          else setStatus({ kind: "missing" });
          return;
        }
        const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as ProofMeta;
        const requestHash = sha256Hex(request);
        const responseHash = sha256Hex(response);
        const evidenceHash = sha256Hex(canonicalJson(meta.evidence));
        let sameEmail = false;
        try {
          sameEmail = canonicalJson(evidenceInRequest(request)) === canonicalJson(meta.evidence);
        } catch {
          sameEmail = false;
        }
        const answer = answerIn(response);
        const checks: Check[] = [
          {
            ok: requestHash === v.request_hash.toLowerCase(),
            title: "The request is the one the enclave signed",
            detail: `sha256 of these ${request.length.toLocaleString("en-GB")} bytes, computed in your browser: ${shortHash(requestHash)}. The enclave signed ${shortHash(v.request_hash)}.`,
          },
          {
            ok: responseHash === v.response_hash.toLowerCase(),
            title: "The response is the one your vault checked",
            detail: `sha256 here: ${shortHash(responseHash)}; the vault recorded ${shortHash(v.response_hash)}. The model answered ${answer}.`,
          },
          {
            ok: !!proposal.context_hash && evidenceHash === proposal.context_hash.toLowerCase() && sameEmail,
            title: "The model read the email the agent committed to",
            detail: sameEmail
              ? `The agent put this email's hash on-chain when it proposed the payment, before any screening: ${shortHash(proposal.context_hash ?? "none")}. The email inside the request hashes to ${shortHash(evidenceHash)}.`
              : "The email inside the request differs from the one published with it.",
          },
        ];
        const e = meta.evidence as { from?: string; subject?: string; body?: string } | null;
        setStatus({ kind: "done", checks, email: e && typeof e === "object" ? e : null, meta, answer });
      } catch (err) {
        if (!cancelled) setStatus({ kind: "error", message: (err as Error).message });
      }
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [base, proposal.context_hash, v.recorded_at, v.request_hash, v.response_hash]);

  if (status.kind === "loading") {
    return (
      <div className={styles.panel}>
        <div className={styles.checking}>
          <VLoader size={20} />
          <span>Fetching the exact bytes and hashing them in your browser…</span>
        </div>
      </div>
    );
  }
  if (status.kind === "missing") {
    return (
      <p className={styles.note}>
        Not published for this decision. The sandbox publishes the bytes of every verdict since 8 Nov 2026; a vault someone owns keeps them private.
      </p>
    );
  }
  if (status.kind === "error") return <p className={styles.note}>Couldn&apos;t load the published bytes: {status.message}</p>;

  const ok = status.checks.every((c) => c.ok);
  return (
    <motion.div className={styles.panel} initial={calm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI}>
      <div className={styles.head}>
        <span className={`${styles.badge} ${ok ? styles.ok : styles.bad}`}>
          <Icon name={ok ? "check" : "x"} size={13} stroke={3} />
          {ok ? "Matches the chain" : "Doesn't match"}
        </span>
        <span className={styles.meta}>3 checks, hashed in your browser</span>
      </div>
      <ol className={styles.list}>
        {status.checks.map((c) => (
          <li key={c.title} className={styles.item}>
            <span className={`${styles.mark} ${c.ok ? styles.ok : styles.bad}`} aria-label={c.ok ? "passed" : "failed"}>
              <Icon name={c.ok ? "check" : "x"} size={11} stroke={3.25} />
            </span>
            <span className={styles.itemBody}>
              <strong>{c.title}</strong>
              <span>{c.detail}</span>
            </span>
          </li>
        ))}
      </ol>
      {status.email && (
        <figure className={styles.email}>
          <figcaption>The email the model read</figcaption>
          {status.email.from && (
            <p>
              <span>From</span> {status.email.from}
            </p>
          )}
          {status.email.subject && (
            <p>
              <span>Subject</span> {status.email.subject}
            </p>
          )}
          {status.email.body && <pre>{status.email.body}</pre>}
        </figure>
      )}
      <div className={styles.links}>
        <a href={`${base}/request.json`} target="_blank" rel="noreferrer">
          Request bytes <Icon name="external" size={12} />
        </a>
        <a href={`${base}/response.json`} target="_blank" rel="noreferrer">
          Response bytes <Icon name="external" size={12} />
        </a>
        {status.meta.tx && (
          <a href={`${EXPLORER}/txns/${status.meta.tx}`} target="_blank" rel="noreferrer">
            Verdict transaction <Icon name="external" size={12} />
          </a>
        )}
      </div>
      <p className={styles.cli}>
        Without a browser: <code className="mono">curl -s {base}/request.json | sha256sum</code> prints the request hash.
      </p>
    </motion.div>
  );
}
