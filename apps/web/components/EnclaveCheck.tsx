"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { EnclaveVerification } from "@veto/core/attest";
import { SPRING_BOUNCE, SPRING_UI, useCalm } from "@/lib/motion";
import { Icon } from "./Icon";
import { VLoader } from "./VLoader";
import styles from "./EnclaveCheck.module.css";

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "done"; result: EnclaveVerification } | { kind: "error"; message: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Verifies NEAR AI's enclave now, from scratch: Intel's quote, NVIDIA's GPUs, that the hardware
 * binds the model key and a fresh nonce, and that the key is the one that signed this verdict.
 */
export function EnclaveCheck({ model, signer }: { model: string; signer: string }) {
  const calm = useCalm();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // The first look may share a check another viewer ran in the last minute; Check again always runs a new one.
  const run = async (fresh = false) => {
    setStatus({ kind: "checking" });
    try {
      const res = await fetch(`/api/attestation?model=${encodeURIComponent(model)}&signer=${encodeURIComponent(signer)}${fresh ? "&fresh=1" : ""}`);
      const body = (await res.json()) as EnclaveVerification & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `the check answered ${res.status}`);
      setStatus({ kind: "done", result: body });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  if (status.kind === "idle") {
    return (
      <button type="button" className={`${styles.start} press`} onClick={() => run()}>
        <span className={styles.startIcon} aria-hidden="true">
          <Icon name="shield" size={17} stroke={2.25} />
        </span>
        <span className={styles.startText}>
          <strong>Check the enclave now</strong>
          <span>Verifies NEAR AI&apos;s hardware from scratch with a fresh nonce: Intel&apos;s quote, NVIDIA&apos;s GPUs and the key that signed this verdict. It runs on our server; <code className="mono">node bench/verify.ts --attested</code> runs the same checks on yours.</span>
        </span>
        <Icon name="arrowRight" size={16} className={styles.chevron} />
      </button>
    );
  }

  return (
    <div className={styles.panel} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {status.kind === "checking" && (
          <motion.div key="checking" className={styles.checking} initial={calm ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <VLoader size={22} />
            <span>Asking NEAR AI for fresh evidence, then checking it with Intel and NVIDIA…</span>
          </motion.div>
        )}
        {status.kind === "error" && (
          <motion.div key="error" className={styles.error} initial={calm ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <p>{status.message}</p>
            <button type="button" className={`${styles.again} press`} onClick={() => run()}>
              Try again
            </button>
          </motion.div>
        )}
        {status.kind === "done" && (
          <motion.div key="done" initial={calm ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className={styles.head}>
              <motion.span
                className={`${styles.badge} ${status.result.ok ? styles.ok : styles.bad}`}
                initial={calm ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={SPRING_BOUNCE}
              >
                <Icon name={status.result.ok ? "check" : "x"} size={13} stroke={3} />
                {status.result.ok ? "Verified" : "Not verified"}
              </motion.span>
              <span className={styles.meta}>
                {status.result.checks.filter((c) => c.ok).length} of {status.result.checks.length} checks · {time(status.result.checked_at)}
              </span>
            </div>
            <ol className={styles.list}>
              {status.result.checks.map((c, i) => (
                <motion.li
                  key={c.id}
                  className={styles.item}
                  initial={calm ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING_UI, delay: 0.08 + i * 0.07 }}
                >
                  <span className={`${styles.mark} ${c.ok ? styles.ok : styles.bad}`} aria-label={c.ok ? "passed" : "failed"}>
                    <Icon name={c.ok ? "check" : "x"} size={11} stroke={3.25} />
                  </span>
                  <span className={styles.itemBody}>
                    <strong>{c.title}</strong>
                    <span>{c.detail}</span>
                  </span>
                </motion.li>
              ))}
            </ol>
            <div className={styles.foot}>
              <span className={styles.nonce}>
                Nonce <span className="mono">{status.result.nonce.slice(0, 10)}…{status.result.nonce.slice(-6)}</span>
              </span>
              <button type="button" className={`${styles.again} press`} onClick={() => run(true)}>
                Check again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
