// compare.js
// Runs the deliberation engine with multiple config variants against the same feature request
// and produces a side-by-side comparison table + Markdown report.
//
// Usage: node compare.js [path/to/compare-config.json]
// Default config file: ./compare-config.json

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { deliberate } from "./index.js";
import { EXAMPLES } from "./config.js";

// ── Load compare config ────────────────────────────────────────────────────
const configPath = process.argv[2] ?? new URL("./compare-config.json", import.meta.url).pathname;
const compareConfig = JSON.parse(readFileSync(configPath, "utf8"));

// ── Resolve feature request ────────────────────────────────────────────────
function resolveInput() {
  const fr = compareConfig.feature_request;
  if (typeof fr === "string") {
    return { featureRequest: fr, exampleKey: undefined };
  }
  if (fr && typeof fr === "object" && fr.example != null) {
    const key = parseInt(fr.example);
    const text = EXAMPLES[key];
    if (!text) throw new Error(`No built-in example for key: ${key}`);
    return { featureRequest: text, exampleKey: key };
  }
  throw new Error(
    'compare-config.json "feature_request" must be a string or { "example": <number> }'
  );
}

// ── Metrics per result ─────────────────────────────────────────────────────
function getMetrics(result) {
  const { runMetadata, finalDocument } = result;
  const lastRound = runMetadata.per_round_scores.at(-1) ?? {};
  const propConf = lastRound.proposer_confidence ?? "—";
  const critScore = lastRound.critic_score ?? "—";
  const gap =
    propConf !== "—" && critScore !== "—" ? Math.abs(propConf - critScore) : "—";
  const { proposed = 0, defended = 0, revised = 0, conceded = 0 } =
    runMetadata.assumptions_by_status;

  return [
    ["Rounds taken",               String(runMetadata.rounds_taken)],
    ["Termination",                runMetadata.termination_reason],
    ["Proposer confidence (final)", String(propConf)],
    ["Critic score (final)",        String(critScore)],
    ["Confidence gap",              String(gap)],
    ["Assumptions proposed",        String(proposed)],
    ["Assumptions defended",        String(defended)],
    ["Assumptions revised",         String(revised)],
    ["Assumptions conceded",        String(conceded)],
    ["Open questions",              String(finalDocument.open_questions?.length ?? "—")],
    ["Total tokens",                String(runMetadata.total_tokens)],
    ["Recommendation",              finalDocument.recommendation ?? "—"],
  ];
}

// ── Console table ──────────────────────────────────────────────────────────
function printComparisonTable(results) {
  const metricPairs = getMetrics(results[0]);
  const metricNames = metricPairs.map(([k]) => k);
  const metricColW = Math.max(...metricNames.map((m) => m.length));

  const variantCols = results.map((r) => {
    const vals = getMetrics(r).map(([, v]) => v);
    return {
      label: r.label,
      vals,
      width: Math.max(r.label.length, ...vals.map((v) => v.length)),
    };
  });

  const totalWidth =
    metricColW + 3 + variantCols.reduce((sum, c) => sum + c.width + 3, 0);

  const heavy = "━".repeat(totalWidth);
  const header =
    "  " +
    "Metric".padEnd(metricColW) +
    "  │  " +
    variantCols.map((c) => c.label.padEnd(c.width)).join("  │  ");
  const divider =
    "  " +
    "─".repeat(metricColW) +
    "──┼──" +
    variantCols.map((c) => "─".repeat(c.width)).join("──┼──");

  console.log("\n" + heavy);
  console.log("  COMPARISON RESULTS");
  console.log(heavy);
  console.log(header);
  console.log(divider);

  for (let i = 0; i < metricNames.length; i++) {
    const row =
      "  " +
      metricNames[i].padEnd(metricColW) +
      "  │  " +
      variantCols.map((c) => c.vals[i].padEnd(c.width)).join("  │  ");
    console.log(row);
  }

  console.log("━".repeat(totalWidth) + "\n");
}

// ── Markdown report ────────────────────────────────────────────────────────
function buildMarkdown(featureRequest, results) {
  const lines = [];

  lines.push("# Deliberation Comparison Report\n");
  lines.push(`**Feature Request:** "${featureRequest}"`);
  lines.push(`**Generated:** ${new Date().toISOString()}\n`);

  // Summary table
  lines.push("## Summary\n");
  const metricNames = getMetrics(results[0]).map(([k]) => k);
  lines.push(`| Metric | ${results.map((r) => r.label).join(" | ")} |`);
  lines.push(`|---|${results.map(() => "---").join("|")}|`);
  for (let i = 0; i < metricNames.length; i++) {
    const vals = results.map((r) => getMetrics(r)[i][1]);
    lines.push(`| ${metricNames[i]} | ${vals.join(" | ")} |`);
  }

  // Per-variant details
  lines.push("\n## Variants\n");
  for (const r of results) {
    const cfg = r.config;
    lines.push(`### ${r.label}\n`);
    lines.push(
      `**Config:** MIN_ROUNDS=${cfg.MIN_ROUNDS}, MAX_ROUNDS=${cfg.MAX_ROUNDS}, MAX_ASSUMPTIONS_PER_ROUND=${cfg.MAX_ASSUMPTIONS_PER_ROUND}\n`
    );
    lines.push(`**Recommendation:** \`${r.finalDocument.recommendation ?? "—"}\`\n`);

    const scope = r.finalDocument.agreed_scope;
    if (scope?.included?.length) {
      lines.push("**Agreed scope — included:**");
      for (const item of scope.included) lines.push(`- ${item}`);
      lines.push("");
    }
    if (scope?.excluded?.length) {
      lines.push("**Agreed scope — excluded:**");
      for (const item of scope.excluded) lines.push(`- ${item}`);
      lines.push("");
    }

    const oqs = r.finalDocument.open_questions;
    if (oqs?.length) {
      lines.push("**Open questions:**");
      for (const q of oqs) lines.push(`- ${q}`);
      lines.push("");
    }

    const delta = r.finalDocument.confidence_delta;
    if (delta) {
      lines.push(`**Confidence delta:** Proposer ${delta.proposer_final} | Critic ${delta.critic_final_score}`);
      if (delta.assessment) lines.push(`> ${delta.assessment}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const { featureRequest } = resolveInput();

  console.log("\n" + "═".repeat(70));
  console.log(`  DELIBERATION COMPARISON`);
  console.log(`  Feature request: "${featureRequest.slice(0, 60)}${featureRequest.length > 60 ? "…" : ""}"`);
  console.log(`  Variants: ${compareConfig.variants.map((v) => v.label).join(", ")}`);
  console.log("═".repeat(70));

  const results = [];
  for (const variant of compareConfig.variants) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`  VARIANT: ${variant.label}  (MIN_ROUNDS=${variant.config.MIN_ROUNDS}, MAX_ROUNDS=${variant.config.MAX_ROUNDS}, MAX_ASSUMPTIONS_PER_ROUND=${variant.config.MAX_ASSUMPTIONS_PER_ROUND})`);
    console.log("─".repeat(70) + "\n");

    const { finalDocument, runMetadata } = await deliberate(
      variant.config,
      { featureRequest, exampleKey: variant.label }
    );
    results.push({ label: variant.label, config: variant.config, finalDocument, runMetadata });
  }

  printComparisonTable(results);

  mkdirSync("output", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const mdPath = `output/comparison-${timestamp}.md`;
  writeFileSync(mdPath, buildMarkdown(featureRequest, results), "utf8");
  console.log(`Comparison report saved → ${mdPath}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  console.error(err);
  process.exit(1);
});
