import { compareAddresses } from "@/lib/decision";
import styles from "./AddressCompare.module.css";

/** Both addresses in full; the shared ends in sand, the part that differs in coral. */
export function AddressCompare({ saved, requested, savedLabel }: { saved: string; requested: string; savedLabel: string }) {
  const parts = compareAddresses(saved, requested);
  return (
    <div className={styles.box}>
      <span className={styles.label}>{savedLabel}</span>
      <span className={`mono ${styles.address}`}>
        <span className={styles.same}>{parts.saved.start}</span>
        <span className={styles.oldMiddle}>{parts.saved.middle}</span>
        <span className={styles.same}>{parts.saved.end}</span>
      </span>
      <span className={styles.label}>This request</span>
      <span className={`mono ${styles.address}`}>
        <span className={styles.same}>{parts.requested.start}</span>
        <mark className={styles.newMiddle}>{parts.requested.middle}</mark>
        <span className={styles.same}>{parts.requested.end}</span>
      </span>
    </div>
  );
}
