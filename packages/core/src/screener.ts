import { Wallet } from "ethers";
import { screen, parseVerdict, type SignedScreening } from "./nearai.ts";
import { sha256Hex } from "./proposal.ts";
import type { Signal } from "./signals.ts";

/** Produces a verdict for one screening prompt, signed over the exact request and response bytes. */
export interface Screener {
  readonly model: string;
  screen(system: string, user: string, hints: { proposalId: string; proposalHash: string; signals: Signal[]; evidence: unknown }): Promise<SignedScreening>;
}

/** The real screener: a model running in a NEAR AI Cloud TEE. */
export class NearAiScreener implements Screener {
  readonly model: string;
  readonly #apiKey: string;

  constructor(apiKey: string, model: string) {
    this.#apiKey = apiKey;
    this.model = model;
  }

  screen(system: string, user: string) {
    return screen({ apiKey: this.#apiKey, model: this.model, system, user });
  }
}

/**
 * Local development only. Signs in NEAR AI's exact format with a throwaway key so the
 * pipeline can run without an API key. A vault only accepts it if its owner approved
 * this key, which the demo vault never does. Its rules are deliberately simple.
 */
export class DevScreener implements Screener {
  readonly model = "veto-dev/local-signer";
  readonly wallet: Wallet;

  constructor(privateKey?: string) {
    this.wallet = privateKey ? new Wallet(privateKey) : (Wallet.createRandom() as unknown as Wallet);
  }

  async screen(system: string, user: string, hints: { proposalId: string; proposalHash: string; signals: Signal[]; evidence: unknown }) {
    const codes = new Set(hints.signals.map((s) => s.code));
    const text = JSON.stringify(hints.evidence ?? "").toLowerCase();
    const reasons: string[] = [];
    if (codes.has("LOOKALIKE_ADDRESS")) reasons.push("LOOKALIKE_ADDRESS");
    if (codes.has("NEW_PAYEE")) reasons.push("NEW_PAYEE");
    if (codes.has("DUPLICATE_INVOICE")) reasons.push("DUPLICATE_INVOICE");
    if (codes.has("AMOUNT_ANOMALY")) reasons.push("AMOUNT_ANOMALY");
    if (/(wallet|account|bank|payment) details? (has |have )?changed|wallet has changed|new (wallet|address)/.test(text)) reasons.push("CHANGED_PAYOUT_DETAILS");
    if (/urgent|immediately|today only|right away/.test(text)) reasons.push("URGENCY_PRESSURE");
    if (/ignore (all|previous|your) (instructions|rules)/.test(text)) reasons.push("UNTRUSTED_INSTRUCTION");

    const verdict = reasons.length ? "VETO" : "PASS";
    const requestBytes = new TextEncoder().encode(JSON.stringify({ model: this.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] }));
    const content = JSON.stringify({ proposal_id: hints.proposalId, proposal_hash: hints.proposalHash, verdict, reasons });
    const chatId = `chatcmpl-dev-${Date.now()}`;
    const responseBytes = new TextEncoder().encode(
      JSON.stringify({ id: chatId, object: "chat.completion", model: this.model, choices: [{ index: 0, message: { role: "assistant", content } }] }),
    );
    const requestHash = sha256Hex(requestBytes);
    const responseHash = sha256Hex(responseBytes);
    const signedText = `${this.model}:${requestHash}:${responseHash}`;
    return {
      model: this.model,
      chatId,
      requestBytes,
      responseBytes,
      requestHash,
      responseHash,
      signedText,
      signature: await this.wallet.signMessage(signedText),
      signingAddress: this.wallet.address.toLowerCase(),
      verdict: parseVerdict(content),
    };
  }
}
