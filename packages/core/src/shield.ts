// NEAR Intents Shield: the live incident feed for chains, bridges, tokens and addresses.
// Before a cross-chain payout leaves through NEAR Intents, the guardian checks it; while an
// incident touches the payout's route, the payment is held (and fails closed if it outlasts
// the screening deadline) instead of being sent into a known problem.
import type { Route } from "./intents.ts";
import type { PaymentRequest } from "./proposal.ts";

export const SHIELD_URL = "https://shield.chaindefuser.com";

export interface Incident {
  scopeType: "chain" | "bridge" | "token" | "address" | string;
  scopeValue: string;
  direction?: string;
  publicDescription?: string | null;
}

let cached: { at: number; incidents: Incident[] } | null = null;

/** Active incidents. Cached for 30 s so a busy guardian doesn't hammer the feed. */
export async function shieldIncidents(key: string): Promise<Incident[]> {
  if (cached && Date.now() - cached.at < 30_000) return cached.incidents;
  const res = await fetch(`${SHIELD_URL}/incident`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Shield answered ${res.status}`);
  const body = (await res.json()) as { status: string; incidents?: Incident[] };
  cached = { at: Date.now(), incidents: body.status === "incidents" ? (body.incidents ?? []) : [] };
  return cached.incidents;
}

/**
 * The first incident that touches this payout: its destination chain, either asset of its
 * route, the bridge that carries the destination asset (e.g. "poa" for *.omft.near tokens), or
 * the payee's address. Incidents about deposits into NEAR don't block a payout out of it.
 */
export function blockingIncident(incidents: Incident[], route: Route, request: PaymentRequest): Incident | undefined {
  const lower = (v: string) => v.trim().toLowerCase();
  const assets = [route.origin_asset, route.destination_asset].map(lower);
  const bridges = route.destination_asset.endsWith(".omft.near") ? ["poa"] : [];
  return incidents.find((i) => {
    if (i.direction && !["withdraw", "both", "all"].includes(lower(i.direction))) return false;
    const value = lower(i.scopeValue);
    switch (lower(i.scopeType)) {
      case "chain":
        return value === lower(request.chain) || (value === "eth" && request.chain === "ethereum");
      case "token":
        return assets.includes(value);
      case "bridge":
        return bridges.includes(value);
      case "address":
        return value === lower(request.payee);
      default:
        return false;
    }
  });
}

export class ShieldHold extends Error {
  readonly incident: Incident;

  constructor(incident: Incident) {
    super(`held by Shield: ${incident.publicDescription ?? `${incident.scopeType} ${incident.scopeValue} incident`}`);
    this.incident = incident;
  }
}
