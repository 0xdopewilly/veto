"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { canonicalJson, sha256Hex, type Proposal } from "@veto/core/proposal";
import { formatAmount, SYSTEM_PROMPT } from "@veto/core/prompt";
import { recoverVerdictSigner, signedVerdictText } from "@veto/core/verdictsig";
import { EXPLORER, PROOF_BASE, PUBLIC_RPCS } from "@/lib/config";
import { SPRING_UI, useCalm } from "@/lib/motion";
import { shortAddress, shortHash } from "@/lib/format";
import { reasonText } from "@/lib/decision";
import { Icon } from "./Icon";
import { VLoader } from "./VLoader";
import styles from "./ProofBytes.module.css";

/** The sandbox publishes every decision's bytes from this one on (lib/server/proofs.ts). */
export const FIRST_PUBLISHED = 109;

/** meta.json, written by lib/server/proofs.ts next to the raw request and response bytes. */
interface ProofMeta {
  model: string;
  chat_id: string;
  signature: string;
  evidence: unknown;
  tx: string;
}

interface Check {
  ok: boolean;
  title: string;
  detail: string;
}

type Email = { from?: string; to?: string; subject?: string; body?: string; sender_checks?: string };
type Status =
  | { kind: "loading" }
  | { kind: "missing"; expected: boolean }
  | { kind: "error"; message: string }
  | { kind: "done"; checks: Check[]; email: Email | null; meta: ProofMeta };

/** A view call straight to a public NEAR RPC: what the chain says, not what our server says. */
async function chain<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  let last = "no RPC answered";
  for (const url of PUBLIC_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "proof", method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }),
      });
      const body = (await res.json()) as { result?: { result: number[] }; error?: { message?: string } };
      if (body.result) return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
      last = body.error?.message ?? String(res.status);
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`NEAR's RPC: ${last}`);
}

/**
 * Whether the vault rebuilt this verdict's request itself (checked screening), from the verdict
 * transaction's own event on NEAR. Null when the RPC no longer holds the transaction (regular
 * nodes keep a few days) or the vault predates checked screening.
 */
async function rebuiltByVault(guardian: string, txHash: string, id: string): Promise<boolean | null> {
  for (const url of PUBLIC_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "proof", method: "tx", params: { tx_hash: txHash, sender_account_id: guardian, wait_until: "NONE" } }),
      });
      const body = (await res.json()) as { result?: { receipts_outcome: { outcome: { logs: string[] } }[] } };
      if (!body.result) continue;
      for (const log of body.result.receipts_outcome.flatMap((r) => r.outcome.logs)) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        const event = JSON.parse(log.slice("EVENT_JSON:".length)) as { event: string; data: { id: string; checked?: boolean }[] };
        if (event.event === "verdict_recorded" && event.data[0]?.id === id) return event.data[0].checked ?? null;
      }
      return null;
    } catch {
      // Try the next RPC.
    }
  }
  return null;
}

async function bytesOf(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`the proof store answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * The sandbox publishes the exact bytes each verdict was signed over. This reads the decision from
 * NEAR's public RPC and checks the published bytes against it, here in the browser: the request and
 * response hashes, the signature (recovered here), the prompt (Veto's system prompt, asking about this
 * exact payment) and the email the agent committed to before any screening.
 */
export function ProofBytes({ vault, id }: { vault: string; id: string }) {
  const calm = useCalm();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const base = `${PROOF_BASE}/proofs/${vault}/${id}`;

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt: number) => {
      try {
        const p = await chain<Proposal | null>(vault, "get_proposal", { id });
        if (!p?.verdict) throw new Error("the chain has no verdict for this payment yet");
        const v = p.verdict;
        const [request, response, metaBytes] = await Promise.all([bytesOf(`${base}/request.json`), bytesOf(`${base}/response.json`), bytesOf(`${base}/meta.json`)]);
        if (cancelled) return;
        if (!request || !response || !metaBytes) {
          // Published right after the verdict lands, so a decision seconds old may not be there yet.
          const fresh = Date.now() - Number(BigInt(v.recorded_at) / 1_000_000n) < 120_000;
          if (fresh && attempt < 5) retry = setTimeout(() => load(attempt + 1), 3000);
          else setStatus({ kind: "missing", expected: Number(id) >= FIRST_PUBLISHED });
          return;
        }
        const meta = JSON.parse(text(metaBytes)) as ProofMeta;
        const [hash, signers, config] = await Promise.all([
          chain<string>(vault, "get_proposal_hash", { id }),
          chain<[string, unknown][]>(vault, "get_signers"),
          chain<{ guardian: string }>(vault, "get_config"),
        ]);
        const rebuilt = await rebuiltByVault(config.guardian, meta.tx, id);
        const decimals = p.request.asset === "near" ? 24 : p.request.chain !== "near" ? 18 : (await chain<{ decimals: number }>(p.request.asset, "ft_metadata")).decimals;

        // 1–2: the bytes are the ones the enclave signed and the vault checked.
        const requestHash = sha256Hex(request), responseHash = sha256Hex(response);
        const answer = (() => {
          try {
            const c = JSON.parse(JSON.parse(text(response)).choices[0].message.content) as { verdict: string; reasons: string[] };
            return { verdict: c.verdict, reasons: c.reasons ?? [] };
          } catch {
            return null;
          }
        })();
        const sameAnswer = !!answer && (answer.verdict === "PASS") === v.pass && canonicalJson(answer.reasons) === canonicalJson(v.reasons);
        // 3: the signature, recovered here, is the enclave key the vault approved.
        let signer = "";
        try {
          signer = recoverVerdictSigner(signedVerdictText(v.model_id, v.request_hash, v.response_hash), meta.signature);
        } catch {
          signer = "";
        }
        const approved = signers.some(([a]) => a.toLowerCase() === signer);
        // 4–5: the prompt is Veto's, about this payment, with the email the agent committed to.
        let system = "", facts: Record<string, any> | null = null, inRequest: unknown;
        try {
          const body = JSON.parse(text(request)) as { messages: { role: string; content: string }[] };
          system = body.messages.find((m) => m.role === "system")?.content ?? "";
          const user = body.messages.find((m) => m.role === "user")?.content ?? "";
          facts = JSON.parse(user.slice(0, user.indexOf("\n\n<evidence>")));
          const block = user.match(/<evidence>\n([\s\S]*)\n<\/evidence>/);
          inRequest = block ? JSON.parse(block[1]) : undefined;
        } catch {
          facts = null;
        }
        const pay = facts?.payment ?? {};
        const aboutThis =
          system === SYSTEM_PROMPT &&
          facts?.proposal_id === p.id &&
          facts?.proposal_hash === hash &&
          pay.payee === p.request.payee &&
          pay.chain === p.request.chain &&
          pay.asset === p.request.asset &&
          (pay.reference ?? null) === (p.request.memo ?? null) &&
          pay.amount === formatAmount(p.request.amount, decimals);
        const evidenceHash = sha256Hex(canonicalJson(meta.evidence));
        const sameEmail = inRequest !== undefined && canonicalJson(inRequest) === canonicalJson(meta.evidence) && evidenceHash === (p.context_hash ?? "").toLowerCase();

        const checks: Check[] = [
          {
            ok: requestHash === v.request_hash.toLowerCase(),
            title: "The request is the one the enclave signed",
            detail: `sha256 of these ${request.length.toLocaleString("en-GB")} bytes, computed in your browser: ${shortHash(requestHash)}. The chain records ${shortHash(v.request_hash)}.`,
          },
          {
            ok: responseHash === v.response_hash.toLowerCase() && sameAnswer,
            title: "The response is the one your vault checked",
            detail: `sha256 here: ${shortHash(responseHash)}; the chain records ${shortHash(v.response_hash)}. The model answered ${answer ? `${answer.verdict}${answer.reasons.length ? ` (${answer.reasons.map(reasonText).join("; ").toLowerCase()})` : ""}` : "something unreadable"}, ${sameAnswer ? "the verdict the vault recorded" : "not the verdict the vault recorded"}.`,
          },
          {
            ok: !!signer && signer === v.signer.toLowerCase() && approved,
            title: "The enclave's key signed it",
            detail: signer
              ? `Recovered in your browser from the signature: ${shortAddress(signer)}, ${approved ? "a key this vault approved" : "not a key this vault approved"}${signer === v.signer.toLowerCase() ? ", the signer the vault recorded" : ""}.`
              : "The published signature doesn't recover to a key.",
          },
          {
            ok: aboutThis,
            title: "It asked about this exact payment",
            detail: aboutThis
              ? `Veto's system prompt, word for word, and payment #${p.id} to ${shortAddress(p.request.payee)}${p.request.memo ? `, reference ${p.request.memo}` : ""}, with its amount and the proposal hash the vault computes.`
              : "The prompt differs from Veto's system prompt or from this payment's facts on-chain.",
          },
          {
            ok: sameEmail,
            title: "The model read the email the agent committed to",
            detail: sameEmail
              ? `The agent put this email's hash on-chain when it proposed the payment, before any screening: ${shortHash(p.context_hash ?? "")}. The email inside the request hashes to the same.`
              : "The email inside the request doesn't match the hash committed on-chain.",
          },
        ];
        // 6: with checked screening the vault didn't take the request on trust: it rebuilt it.
        if (rebuilt) {
          checks.push({
            ok: true,
            title: "Your vault rebuilt this request itself",
            detail:
              "The verdict transaction carried the email, not a hash of the request. The vault wrote the facts from its own state, checked the email against the hash the agent committed, rebuilt the request around its pinned prompt, and accepted the signature only over those bytes.",
          });
        }
        const e = meta.evidence as Email | null;
        setStatus({ kind: "done", checks, email: e && typeof e === "object" ? e : null, meta });
      } catch (err) {
        if (!cancelled) setStatus({ kind: "error", message: (err as Error).message });
      }
    };
    load(0);
    return () => {
      cancelled = true;
      clearTimeout(retry);
    };
  }, [base, id, vault]);

  if (status.kind === "loading") {
    return (
      <div className={styles.panel}>
        <div className={styles.checking}>
          <VLoader size={20} />
          <span>Reading the decision from NEAR and hashing the published bytes in your browser…</span>
        </div>
      </div>
    );
  }
  if (status.kind === "missing") {
    return status.expected ? (
      <p className={`${styles.note} ${styles.missing}`}>
        Missing: every sandbox decision from #{FIRST_PUBLISHED} on should have its bytes published, and this one doesn&apos;t.
      </p>
    ) : (
      <p className={styles.note}>Not published: the sandbox publishes the bytes of every decision from #{FIRST_PUBLISHED} on, and a vault someone owns keeps them private.</p>
    );
  }
  if (status.kind === "error") return <p className={styles.note}>Couldn&apos;t check the published bytes: {status.message}</p>;

  const ok = status.checks.every((c) => c.ok);
  return (
    <motion.div className={styles.panel} initial={calm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI}>
      <div className={styles.head}>
        <span className={`${styles.badge} ${ok ? styles.ok : styles.bad}`}>
          <Icon name={ok ? "check" : "x"} size={13} stroke={3} />
          {ok ? "Matches the chain" : "Doesn't match"}
        </span>
        <span className={styles.meta}>{status.checks.length} checks in your browser, against NEAR&apos;s public RPC</span>
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
          {status.email.to && (
            <p>
              <span>To</span> {status.email.to}
            </p>
          )}
          {status.email.sender_checks && (
            <p>
              <span>Sender</span> {status.email.sender_checks}
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
