// Copies the bench summaries into the web app: apps/web/public/bench/results.json.
//   node bench/publish.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const summary = JSON.parse(readFileSync(new URL("results/summary.json", import.meta.url), "utf8"));
// Baselines first (plain policy, then rules only), then the models.
const rank = (model: string) => (model.startsWith("baseline/") ? 0 : model.startsWith("veto-dev/") ? 1 : 2);
const models = Object.values(summary as Record<string, Record<string, unknown>>)
  .sort((a, b) => rank(a.model as string) - rank(b.model as string))
  .map((s) => ({
    model: s.model,
    display: s.display,
    attacks_caught: s.attacks_caught,
    attacks_total: s.attacks_total,
    normal_blocked: s.ordinary_blocked,
    normal_total: s.ordinary_total,
    median_ms: s.median_ms,
    by_category: s.by_category,
  }));
const out = new URL("../apps/web/public/bench/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("results.json", out), JSON.stringify({ ran_at: new Date().toISOString(), models }, null, 2));
console.log(`published ${models.length} result(s): ${models.map((m) => m.display ?? m.model).join(", ")}`);
