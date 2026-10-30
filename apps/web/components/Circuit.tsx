import { Icon } from "./Icon";
import styles from "./Circuit.module.css";

/**
 * Vault → contract cap → AI screen → payee. `ai` is the screen's result; `paid` closes the
 * last line. Nodes pop in and lines draw in order when `animate` is on.
 */
export function Circuit({
  ai,
  paid,
  animate = true,
  large = false,
  delay = 0,
}: {
  ai: "pass" | "veto" | "pending";
  paid: boolean;
  animate?: boolean;
  large?: boolean;
  delay?: number;
}) {
  const at = (ms: number) => (animate ? { animationDelay: `${delay + ms}ms` } : undefined);
  const pop = animate ? "pop" : "";
  const draw = animate ? "draw" : "";
  const lineToPayee = paid ? styles.lineOn : styles.lineBroken;

  return (
    <div className={`${styles.circuit} ${large ? styles.large : ""}`}>
      <div className={`${styles.node} ${pop}`} style={at(0)}>
        <span className={`${styles.dot} ${styles.vault}`}>
          <Icon name="lock" size={large ? 22 : 16} />
        </span>
        <span className={styles.label}>Vault</span>
      </div>
      <span aria-hidden="true" className={`${styles.line} ${styles.lineOn} ${draw}`} style={at(120)} />
      <div className={`${styles.node} ${pop}`} style={at(280)}>
        <span className={`${styles.dot} ${styles.pass}`}>
          <Icon name="check" size={large ? 22 : 16} stroke={2.75} />
        </span>
        <span className={styles.label}>Contract cap</span>
        <span className={styles.passText}>Pass</span>
      </div>
      <span
        aria-hidden="true"
        className={`${styles.line} ${ai === "pending" ? styles.lineBroken : styles.lineOn} ${draw}`}
        style={at(400)}
      />
      <div className={`${styles.node} ${pop}`} style={at(560)}>
        <span
          className={`${styles.dot} ${ai === "veto" ? `${styles.veto} ${animate ? "ring" : ""}` : ai === "pass" ? styles.pass : styles.waiting}`}
        >
          <Icon name={ai === "veto" ? "x" : ai === "pass" ? "check" : "clock"} size={large ? 22 : 16} stroke={ai === "pending" ? 2 : 3} />
        </span>
        <span className={styles.label}>AI screen</span>
        <span className={ai === "veto" ? styles.vetoText : ai === "pass" ? styles.passText : styles.waitText}>
          {ai === "veto" ? "Veto" : ai === "pass" ? "Pass" : "Screening"}
        </span>
      </div>
      <span aria-hidden="true" className={`${styles.line} ${lineToPayee} ${draw}`} style={at(720)} />
      <div className={`${styles.node} ${styles.payee} ${pop}`} style={at(840)}>
        <span className={`${styles.dot} ${paid ? styles.paid : styles.unpaid}`}>
          <Icon name="user" size={large ? 22 : 16} />
        </span>
        <span className={styles.label}>Payee</span>
        <span className={paid ? styles.passText : styles.idleText}>{paid ? "Paid" : "Not paid"}</span>
      </div>
    </div>
  );
}
