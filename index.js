// index.js
// Orchestration logic for the Deliberation Engine.
// Agents are in agents.js. Prompts are in prompts/agents.js. Config is in config.js.

import "dotenv/config";
import { fileURLToPath } from "url";
import { DELIBERATION_CONFIG, EXAMPLES } from "./config.js";
import { runProposer, runCritic, runSummarizer } from "./agents.js";
import * as log from "./logger.js";

/**
 * Resolve the feature request from (in priority order):
 *  1. CLI argument:  node index.js "your feature request"
 *  2. Env variable:  FEATURE_REQUEST="..." node index.js
 *  3. Config example: DELIBERATION_CONFIG.DEFAULT_EXAMPLE
 */
function resolveFeatureRequest() {
  const cliArg = process.argv[2];
  if (cliArg && !["1", "2", "3"].includes(cliArg)) {
    return { featureRequest: cliArg, exampleKey: undefined };
  }

  const envVar = process.env.FEATURE_REQUEST;
  if (envVar) return { featureRequest: envVar, exampleKey: undefined };

  const exampleKey = cliArg ? parseInt(cliArg) : DEFAULT_EXAMPLE;
  return { featureRequest: EXAMPLES[exampleKey] ?? EXAMPLES[DEFAULT_EXAMPLE], exampleKey };
}

export async function deliberate(configOverrides = {}, inputOverride = null) {
  const config = { ...DELIBERATION_CONFIG, ...configOverrides };
  const { MIN_ROUNDS, MAX_ROUNDS, DEFAULT_EXAMPLE, MAX_ASSUMPTIONS_PER_ROUND } = config;
  const { featureRequest, exampleKey } = inputOverride ?? resolveFeatureRequest();

  log.header("DELIBERATION ENGINE");
  log.info(`Feature Request: "${featureRequest}"`);
  log.info(`Termination: Critic satisfaction (min ${MIN_ROUNDS} rounds, hard cap ${MAX_ROUNDS})`);
  log.info(`Max assumptions per round: ${MAX_ASSUMPTIONS_PER_ROUND}`);
  log.info(`Model: claude-haiku-4-5-20251001`);

  // ── State ──────────────────────────────────────────────────────────────────
  let proposerHistory = []; // The Proposer's conversation window
  let criticHistory = [];   // The Critic's conversation window
  const rounds = [];        // Full round log for the Summarizer

  let criticSatisfied = false;
  let round = 0;
  let totalTokens = 0;

  // ── Main Deliberation Loop ─────────────────────────────────────────────────
  while (!criticSatisfied && round < MAX_ROUNDS) {
    round++;
    log.roundHeader(round, MAX_ROUNDS);

    // 1. Proposer turn
    log.info("Proposer is drafting...");
    const { result: proposerOutput, messages: updatedProposerHistory, usage: proposerUsage } = await runProposer(
      featureRequest,
      proposerHistory,
      round
    );
    proposerHistory = updatedProposerHistory;
    totalTokens += (proposerUsage?.input_tokens ?? 0) + (proposerUsage?.output_tokens ?? 0);
    log.agentOutput("PROPOSER", "blue", proposerOutput);

    // 2. Critic turn
    log.info("Critic is reviewing...");
    const { result: criticOutput, messages: updatedCriticHistory, usage: criticUsage } = await runCritic(
      featureRequest,
      proposerOutput,
      criticHistory,
      round,
      MIN_ROUNDS
    );
    criticHistory = updatedCriticHistory;
    totalTokens += (criticUsage?.input_tokens ?? 0) + (criticUsage?.output_tokens ?? 0);
    log.agentOutput("CRITIC", "magenta", criticOutput);

    // 3. Log scores for tension visibility
    log.info(
      `Confidence delta → Proposer: ${proposerOutput.confidence ?? "?"} | Critic score: ${criticOutput.proposal_score ?? "?"}`
    );

    // 4. Cross-feed: give each agent the other's last message for next round
    // Proposer needs to see Critic's challenges
    proposerHistory.push({
      role: "user",
      content: `Critic's response:\n${JSON.stringify(criticOutput, null, 2)}`,
    });
    // Critic needs to see the Proposer's current state (already included via its own history)

    // 5. Store round
    rounds.push({ proposer: proposerOutput, critic: criticOutput });

    // 6. Check termination — primary signal is Critic satisfaction
    criticSatisfied = criticOutput.satisfied === true;

    if (criticSatisfied) {
      log.success(`Critic satisfied after round ${round}. Terminating deliberation.`);
      log.info(`Rationale: ${criticOutput.satisfaction_rationale}`);
    } else if (round >= MAX_ROUNDS) {
      log.warn(`Hard cap reached (${MAX_ROUNDS} rounds). Forcing termination.`);
    } else {
      log.info(`Critic not yet satisfied. Proceeding to round ${round + 1}...`);
    }
  }

  // ── Summarizer ─────────────────────────────────────────────────────────────
  log.header("SUMMARIZER — Synthesizing Final Document");
  log.info("Summarizer is reading the full transcript...");
  const { result: finalDocument, usage: summarizerUsage } = await runSummarizer(featureRequest, rounds);
  totalTokens += (summarizerUsage?.input_tokens ?? 0) + (summarizerUsage?.output_tokens ?? 0);

  // ── Attach run metadata ────────────────────────────────────────────────────
  const terminationReason = criticSatisfied ? "critic_satisfied" : "max_rounds_reached";
  const perRoundScores = rounds.map((r, i) => ({
    round: i + 1,
    proposer_confidence: r.proposer.confidence ?? null,
    critic_score: r.critic.proposal_score ?? null,
  }));
  const assumptionsByStatus = { proposed: 0, defended: 0, revised: 0, conceded: 0 };
  for (const r of rounds) {
    for (const a of (r.proposer.assumptions ?? [])) {
      if (a.status in assumptionsByStatus) assumptionsByStatus[a.status]++;
    }
  }
  const runMetadata = {
    config_used: config,
    rounds_taken: round,
    termination_reason: terminationReason,
    per_round_scores: perRoundScores,
    assumptions_by_status: assumptionsByStatus,
    total_tokens: totalTokens,
  };
  finalDocument.run_metadata = runMetadata;

  log.finalDocument(finalDocument);

  // ── Save output ────────────────────────────────────────────────────────────
  const transcriptFile = log.saveTranscript(exampleKey, featureRequest);

  // Also save the decision document as JSON
  const { writeFileSync } = await import("fs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const docFile = `output/${exampleKey}-decision-${timestamp}.json`;
  try {
    writeFileSync(docFile, JSON.stringify(finalDocument, null, 2), "utf8");
    log.success(`Decision document saved → ${docFile}`);
  } catch {
    log.warn("Could not save decision document.");
  }

  log.header("DELIBERATION COMPLETE");
  log.info(`Rounds completed: ${round}`);
  log.info(`Termination: ${criticSatisfied ? "Critic satisfaction" : "Hard cap reached"}`);
  log.info(`Total tokens used: ${totalTokens}`);
  log.info(`Recommendation: ${finalDocument.recommendation ?? "See document"}`);
  return { finalDocument, runMetadata };
}

// ── Entry point ────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  deliberate().catch((err) => {
    log.error(`Fatal error: ${err.message}`);
    console.error(err);
    process.exit(1);
  });
}
