// The shared testnet sandbox's default owner settings: what `scripts/demo-setup.ts` sets up and what
// the hosted app puts back for each new visitor (apps/web/lib/server/sandbox.ts).

export const SANDBOX_MANDATE =
  "Pay listed suppliers and staff only. Salaries go out once a month, to the wallet and chain each person chose. No single payment over $500. Ask me before paying a new or changed address.";

/** The sandbox's NEAR suppliers, as `<prefix>.<demo root>` accounts. */
export const SANDBOX_SUPPLIERS = [
  { prefix: "kano-cotton", name: "Kano Cotton Mills" },
  { prefix: "ibadan-dye", name: "Ibadan Dye Works" },
] as const;
