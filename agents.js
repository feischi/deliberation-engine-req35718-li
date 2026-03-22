// agents.js
// Thin wrappers around the Anthropic API for each agent role.
// Orchestration logic lives in index.js; API calls and JSON parsing live here.

import Anthropic from "@anthropic-ai/sdk";
import {
  PROPOSER_SYSTEM_PROMPT,
  CRITIC_SYSTEM_PROMPT,
  SUMMARIZER_SYSTEM_PROMPT,
} from "./prompts.js";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-6";

/**
 * Call the Anthropic API with a given system prompt and conversation history.
 * Returns parsed JSON or throws with context.
 */
async function callAgent(systemPrompt, messages) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: systemPrompt,
    messages,
  });

  const raw = response.content[0].text.trim();

  // Strip markdown code fences if the model wraps output
  const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Agent returned non-JSON output:\n${raw}`);
  }
}

/**
 * Run the Proposer agent.
 * @param {string} featureRequest - The original vague request
 * @param {Array}  history        - Alternating user/assistant messages from prior rounds
 * @param {number} round          - Current round number
 */
export async function runProposer(featureRequest, history, round) {
  const userMessage =
    round === 1
      ? `Feature request: "${featureRequest}"\n\nProduce your initial structured interpretation. Round: 1.`
      : `The Critic has responded. This is round ${round}. Review the Critic's challenges and produce your updated proposal. Defend, revise, or concede each point with explicit reasoning.`;

  const messages = [...history, { role: "user", content: userMessage }];
  const result = await callAgent(PROPOSER_SYSTEM_PROMPT, messages);
  result.round = round; // Ensure round is stamped even if model omits it
  return { result, messages: [...messages, { role: "assistant", content: JSON.stringify(result) }] };
}

/**
 * Run the Critic agent.
 * @param {string} featureRequest  - The original request (for context)
 * @param {object} proposerOutput  - The Proposer's latest structured output
 * @param {Array}  history         - Full conversation so far
 * @param {number} round           - Current round number
 * @param {number} minRounds       - Minimum rounds before satisfaction is allowed
 */
export async function runCritic(featureRequest, proposerOutput, history, round, minRounds) {
  const canBeSatisfied = round >= minRounds;
  const satisfactionNote = canBeSatisfied
    ? `You MAY set "satisfied": true if the proposal is genuinely robust.`
    : `You MUST set "satisfied": false — minimum ${minRounds} rounds have not elapsed yet. Continue challenging.`;

  const userMessage = `
Round ${round}. The Proposer has submitted:
${JSON.stringify(proposerOutput, null, 2)}

Evaluate this proposal. ${satisfactionNote}
Produce your Critic response.
`.trim();

  const messages = [...history, { role: "user", content: userMessage }];
  const result = await callAgent(CRITIC_SYSTEM_PROMPT, messages);
  result.round = round;

  // Enforce minimum rounds — override model if it tries to satisfy early
  if (!canBeSatisfied && result.satisfied === true) {
    result.satisfied = false;
    result.satisfaction_rationale = null;
    result._enforcement_note = `Satisfaction suppressed — minimum ${minRounds} rounds not reached.`;
  }

  return { result, messages: [...messages, { role: "assistant", content: JSON.stringify(result) }] };
}

/**
 * Run the Summarizer agent over the full dialogue.
 * @param {string} featureRequest - Original request
 * @param {Array}  rounds         - Array of { proposer, critic } round objects
 */
export async function runSummarizer(featureRequest, rounds) {
  const transcript = rounds
    .map(
      ({ proposer, critic }, i) =>
        `--- Round ${i + 1} ---\nPROPOSER:\n${JSON.stringify(proposer, null, 2)}\n\nCRITIC:\n${JSON.stringify(critic, null, 2)}`
    )
    .join("\n\n");

  const userMessage = `
Feature request: "${featureRequest}"

Complete deliberation transcript:
${transcript}

Synthesize the final decision document.
`.trim();

  const result = await callAgent(SUMMARIZER_SYSTEM_PROMPT, [
    { role: "user", content: userMessage },
  ]);
  return result;
}
