// config.js
// Feature request is configurable here, via env var FEATURE_REQUEST, or via CLI arg.
// No feature request is hardcoded in the orchestration logic.

export const EXAMPLES = {
  1: `We need a better way to track who is the right person to contact in each country.`,
  2: `Project managers should be able to see the full history of engagement with a country before starting a new mission.`,
  3: `The CRM should alert us when our relationship with a country goes cold.`,
};

export const DELIBERATION_CONFIG = {
  // Termination: Critic must signal satisfied=true AND at least MIN_ROUNDS must have elapsed.
  // This prevents trivial early agreement while avoiding infinite loops.
  MIN_ROUNDS: 2,
  MAX_ROUNDS: 5, // Hard safety cap — documents in DECISIONS.md why this is a fallback, not the primary termination signal

  // Which example to use if no CLI arg or env var is provided
  DEFAULT_EXAMPLE: 1,

  // Limit assumptions to force prioritization and keep Critic's job tractable
  MAX_ASSUMPTIONS_PER_ROUND: 5,
};
