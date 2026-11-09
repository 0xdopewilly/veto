// Recovers the address that signed a NEAR AI verdict, the way the vault does on-chain with ecrecover:
// an EIP-191 personal message over "model:sha256(request):sha256(response)". Browser-safe, so the
// Proof page can check a signature without trusting the server that shows it.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

/** The text NEAR AI signs for a completion. */
export const signedVerdictText = (model: string, requestHash: string, responseHash: string) => `${model}:${requestHash}:${responseHash}`;

/** The lowercase 0x address whose key produced `signature` (65 bytes, r‖s‖v) over `text`. */
export function recoverVerdictSigner(text: string, signature: string): string {
  const msg = utf8ToBytes(text);
  const hash = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
  const sig = hexToBytes(signature.replace(/^0x/, ""));
  if (sig.length !== 65) throw new Error("a verdict signature is 65 bytes");
  const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
  const pub = secp256k1.recoverPublicKey(new Uint8Array([v, ...sig.slice(0, 64)]), hash, { prehash: false });
  const full = secp256k1.Point.fromBytes(pub).toBytes(false);
  return `0x${bytesToHex(keccak_256(full.slice(1)).slice(-20))}`;
}
