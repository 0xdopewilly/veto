// Server-only: the demo agent's replies as HTML, in Veto's colours: the verdict as a coral (vetoed)
// or green (paid) band, why, the player's progress on "Can you fool Veto?" and the next trick with
// an email to send. Mail clients ignore stylesheets and web fonts, so it's tables and inline styles
// with system fonts. The plain-text reply goes alongside it for clients that don't show HTML.
import { LADDER, mailtoFor, type Sandbox, type Trick } from "@/lib/challenge";

const C = {
  black: "#000000",
  card: "#111111",
  tile: "#1c1c1c",
  sand: "#f2f1e9",
  paper: "#f2f1e9",
  muted: "#acaba6",
  ink2: "#5f5e59",
  coral: "#ff7966",
  green: "#00ec97",
  dim: "#3a3a3a",
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const DISPLAY = "'Arial Black','Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface ReplyModel {
  verdict: "vetoed" | "paid" | "other";
  /** "VETOED", "PAID", or the vault's status. */
  word: string;
  amount: string;
  currency: string;
  payee: string;
  reference: string | null;
  /** One line under the payee. */
  line: string;
  /** Reason titles, in the verdict's order. */
  reasons: string[];
  ladder: { done: Set<string>; counted: boolean; sandbox: Sandbox } | null;
  decisionUrl: string;
  challengeUrl: string;
  note: string | null;
  footer: string;
}

function button(href: string, label: string, bg: string, fg: string, border = bg) {
  return `<a href="${esc(href)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:${bg};border:1.5px solid ${border};color:${fg};font:700 15px/1 ${SANS};text-decoration:none;margin:0 8px 10px 0;">${esc(label)}</a>`;
}

function band(m: ReplyModel) {
  const bg = m.verdict === "vetoed" ? C.coral : m.verdict === "paid" ? C.green : C.card;
  const fg = m.verdict === "other" ? C.sand : C.black;
  return `
<tr><td style="background:${bg};border-radius:24px;padding:28px 28px 26px;color:${fg};">
  <div style="font:900 54px/0.95 ${DISPLAY};letter-spacing:-2px;color:${fg};">${esc(m.word)}</div>
  <div style="font:700 34px/1.1 ${SANS};letter-spacing:-1px;margin-top:18px;color:${fg};">${esc(m.amount)} <span style="font-size:20px;font-weight:600;">${esc(m.currency)}</span></div>
  <div style="font:500 14px/1.5 ${MONO};margin-top:6px;color:${fg};word-break:break-all;">to ${esc(m.payee)}${m.reference ? ` &middot; ${esc(m.reference)}` : ""}</div>
  <div style="font:500 15px/1.5 ${SANS};margin-top:14px;color:${fg};">${esc(m.line)}</div>
</td></tr>`;
}

function reasons(m: ReplyModel) {
  if (!m.reasons.length) return "";
  const title = m.verdict === "vetoed" ? "Why Veto said no" : "What Veto checked";
  const rows = m.reasons
    .map(
      (r, i) => `
    <tr>
      <td width="34" valign="top" style="padding:7px 0;">
        <div style="width:24px;height:24px;border-radius:12px;background:${m.verdict === "vetoed" ? C.coral : C.green};color:${C.black};font:700 13px/24px ${SANS};text-align:center;">${i + 1}</div>
      </td>
      <td valign="top" style="padding:9px 0;font:500 16px/1.4 ${SANS};color:${C.black};">${esc(r)}</td>
    </tr>`,
    )
    .join("");
  return `
<tr><td style="padding:26px 6px 4px;">
  <div style="font:700 20px/1.2 ${SANS};letter-spacing:-0.3px;color:${C.black};margin-bottom:6px;">${title}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
</td></tr>`;
}

function ladder(m: ReplyModel) {
  if (!m.ladder) return "";
  const { done, counted, sandbox } = m.ladder;
  const next: Trick | null = LADDER.find((t) => !done.has(t.code)) ?? null;
  const cells = LADDER.map(
    (t) => `<td style="padding:0 3px 0 0;"><div style="height:8px;border-radius:4px;background:${done.has(t.code) ? C.coral : C.dim};font-size:0;line-height:0;">&nbsp;</div></td>`,
  ).join("");
  const rows = LADDER.map((t) => {
    const hit = done.has(t.code);
    return `
      <tr>
        <td width="26" style="padding:5px 0;font:700 15px/1.3 ${SANS};color:${hit ? C.coral : C.ink2};">${hit ? "&#10003;" : "&ndash;"}</td>
        <td style="padding:5px 0;font:${hit ? 600 : 500} 15px/1.3 ${SANS};color:${hit ? C.sand : C.muted};">${t.level}. ${esc(t.name)}</td>
        <td align="right" style="padding:5px 0;font:600 12px/1.3 ${SANS};color:${hit ? C.coral : C.ink2};">${hit ? "caught" : ""}</td>
      </tr>`;
  }).join("");
  const headline = !done.size
    ? `Six tricks real invoice fraud uses. Start with the first.`
    : counted
      ? `You've been caught on ${done.size} of ${LADDER.length} tricks`
      : `This email was caught on ${done.size} of the ${LADDER.length} tricks`;
  const nextBlock = next
    ? `
  <div style="margin-top:22px;padding-top:20px;border-top:1px solid #262626;">
    <div style="font:600 13px/1.3 ${SANS};color:${C.muted};">Next up: trick ${next.level}</div>
    <div style="font:700 22px/1.25 ${SANS};letter-spacing:-0.3px;color:${C.sand};margin-top:4px;">${esc(next.name)}</div>
    <div style="font:500 15px/1.5 ${SANS};color:${C.sand};margin-top:6px;">${esc(next.how)}</div>
    <div style="font:400 14px/1.5 ${SANS};color:${C.muted};margin-top:4px;">${esc(next.why)}</div>
    <div style="margin-top:14px;padding:16px 18px;border-radius:16px;background:${C.tile};">
      <div style="font:500 12.5px/1.6 ${SANS};color:${C.muted};">Subject: <span style="color:${C.sand};">${esc(next.subject)}</span></div>
      <div style="font:400 13.5px/1.6 ${MONO};color:${C.sand};margin-top:8px;white-space:pre-wrap;word-break:break-word;">${esc(next.example(sandbox))}</div>
    </div>
    <div style="margin-top:16px;">${button(mailtoFor(next, sandbox), "Write it in your mail app", C.green, C.black)}</div>
  </div>`
    : `
  <div style="margin-top:22px;padding-top:20px;border-top:1px solid #262626;font:600 17px/1.45 ${SANS};color:${C.sand};">
    That's all six. Invent a seventh: any email that gets the vault to pay what it shouldn't.
  </div>`;
  return `
<tr><td style="padding:22px 0 0;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${C.black};border-radius:24px;">
    <tr><td style="padding:26px 26px 22px;color:${C.sand};">
      <div style="font:900 26px/1.1 ${DISPLAY};letter-spacing:-0.8px;color:${C.sand};">Can you fool Veto?</div>
      <div style="font:500 15px/1.4 ${SANS};color:${C.muted};margin-top:6px;">${headline}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;"><tr>${cells}</tr></table>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px;">${rows}</table>
      ${nextBlock}
    </td></tr>
  </table>
</td></tr>`;
}

function shell(inner: string, preheader: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Veto</title></head>
<body style="margin:0;padding:0;background:${C.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper};">
<tr><td align="center" style="padding:24px 12px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
<tr><td style="padding:0 6px 16px;">
  <span style="font:900 22px/1 ${DISPLAY};color:${C.coral};letter-spacing:-1px;">V</span><span style="font:800 22px/1 ${SANS};color:${C.black};letter-spacing:-0.6px;"> veto</span>
  <span style="font:500 13px/1 ${SANS};color:${C.ink2};padding-left:10px;">demo agent &middot; NEAR testnet</span>
</td></tr>
${inner}
</table>
</td></tr></table>
</body></html>`;
}

/** A decision: the verdict band, why, the challenge card and the links. */
export function decisionHtml(m: ReplyModel): string {
  const actions = `
<tr><td style="padding:24px 0 0;">
  ${button(m.decisionUrl, "See the decision and its proof", C.black, C.sand)}${button(m.challengeUrl, "All six tricks, live counts", "transparent", C.black, C.black)}
</td></tr>`;
  const note = m.note ? `<tr><td style="padding:10px 6px 0;font:500 14px/1.5 ${SANS};color:${C.ink2};">${esc(m.note)}</td></tr>` : "";
  const footer = `<tr><td style="padding:22px 6px 0;border-top:1px solid #dcdbd3;font:400 12.5px/1.55 ${SANS};color:${C.ink2};">${esc(m.footer)}</td></tr>`;
  const pre = m.verdict === "vetoed" ? `Vetoed: ${m.amount} ${m.currency} to ${m.payee}. Nothing was paid.` : m.verdict === "paid" ? `Paid: ${m.amount} ${m.currency} to ${m.payee}.` : `${m.word}: ${m.amount} ${m.currency} to ${m.payee}.`;
  return shell(band(m) + reasons(m) + ladder(m) + actions + note + `<tr><td style="height:18px;"></td></tr>` + footer, pre);
}

/** Any other reply (help, a refusal before screening, NEAR AI down) as the same frame around its text. */
export function noteHtml(text: string): string {
  const linked = esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,)]/g, (u) => `<a href="${u}" style="color:${C.black};font-weight:600;">${u}</a>`);
  const paras = linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font:500 15.5px/1.55 ${SANS};color:${C.black};white-space:pre-wrap;">${p}</p>`)
    .join("");
  return shell(`<tr><td style="background:#ffffff;border-radius:24px;padding:26px 26px 14px;">${paras}</td></tr>`, text.split("\n")[0].slice(0, 140));
}
