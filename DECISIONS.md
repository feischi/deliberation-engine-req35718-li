# DECISIONS.md

## Deliberation Engine — Architectural Decisions

---

### 1. How I Designed the Agent Prompts and Why

The most important constraint in the prompt design was **preventing trivial agreement**. A naive system where both agents are helpful assistants will converge immediately — the Proposer will be reasonable, the Critic will say "looks good," and no real deliberation occurs. The prompts are engineered to prevent this.

**`MAX_ASSUMPTIONS_PER_ROUND`:** The Proposer is limited to 5 assumptions per round. Without a cap, the Proposer can bury the Critic in a long list of low-confidence assumptions, making it difficult to challenge any of them rigorously. The cap forces the Proposer to prioritise — only the most significant ones should appear, and the rest belong in `out_of_scope`. This also keeps the Critic's job tractable: the Critic must engage each assumption directly, so a shorter list means deeper challenge. The value is surfaced explicitly in the run transcript so that anyone reviewing the output understands the constraint that shaped the deliberation.

**Proposer prompt:** The key tension-preserving instruction is: *"NEVER simply capitulate to the Critic. If you change a position, explain why the Critic's argument was convincing."* This forces the Proposer to distinguish between genuine persuasion and social capitulation. The output schema reinforces this with an `assumptions[].status` field that must be one of `proposed|defended|revised|conceded` — the Proposer must explicitly account for each assumption's fate. The schema also requires a `response_to_critic` field, which forces direct engagement rather than ignoring challenges.

**Critic prompt:** The critical design decision here was the **specificity constraint**: *"'This is too vague' is not acceptable — name the exact gap."* Generic pushback is the Critic's failure mode, and naming it explicitly in the prompt suppresses it. The Critic also has a `challenges[].target` field that must name which assumption or scope item is being challenged — this prevents floating objections that the Proposer can't respond to. The satisfaction mechanism requires a `satisfaction_rationale` — the Critic cannot just flip a boolean; it must articulate why the proposal is now acceptable.

**Summarizer prompt:** The Summarizer is a distinct third pass, not a round of the existing agents. This separation is intentional: the agents are good at generating tension; they are not necessarily good at synthesizing it neutrally. A Proposer-as-summarizer would bias toward its final position; a Critic-as-summarizer would overweight unresolved concerns. The Summarizer is neutral by instruction and receives the full transcript as a single user message, which means it cannot be influenced by the adversarial dynamic of the deliberation.

---
V
### 2. How Termination Works and What Alternatives I Considered

**Primary termination signal: Critic satisfaction (`satisfied: true`)**

The Critic is the only agent that can declare deliberation complete, via the `satisfied` field in its JSON output. This is intentional: the Critic's role is to find gaps, so it is the right party to certify that no significant gaps remain. Satisfaction requires the Critic to provide a `satisfaction_rationale` — it cannot satisfy silently.

**Minimum rounds enforcement (hard floor)**

The prompt alone cannot guarantee that the Critic won't satisfy in round 1 (language models are trained to be helpful, and "helpful" can mean "agreeable"). To prevent this, the orchestrator enforces `MIN_ROUNDS = 2` programmatically: if the Critic returns `satisfied: true` before the minimum, the orchestrator overrides it and appends a `_enforcement_note` to the round log. The system prompt also explicitly states that the Critic *must not* satisfy in round 1 — belt and suspenders.

**Hard cap (safety fallback)**

`MAX_ROUNDS = 6` is a hard safety cap, not the primary termination mechanism. If the Critic never satisfies within 6 rounds, the system terminates and the Summarizer flags the recommendation as `hold_for_human_review`. This is documented as a fallback, not an expectation. In practice, well-crafted prompts should produce satisfaction within 3–4 rounds.

**Alternatives considered:**

- *Cosine similarity between consecutive proposals:* Terminate when the Proposer's output stops changing significantly. Rejected — this requires embeddings and adds complexity without improving the quality of the termination signal. A proposal can stop changing because it's genuinely good, or because the agents are stuck.
- *Fixed round count:* The simplest approach, and the one AI assistants default to. Rejected as the primary mechanism because it disconnects termination from the actual state of the dialogue. A 3-round cap might terminate a genuinely productive discussion; a 6-round cap might let a broken one run to exhaustion.
- *Mutual satisfaction (both agents signal done):* More symmetric, but the Proposer is structurally incentivized to conclude early (it "wins" when its proposal is accepted). Giving termination authority to the Critic preserves appropriate skepticism longer.

---

### 3. One Thing I Would Do Differently With More Time

**I would add a mediator role that tracks disagreement deltas across rounds.**

Currently, the `confidence_delta` in the Summarizer's output captures the gap between Proposer confidence and Critic score at the end of deliberation. This is useful but static. With more time, I would compute this delta at every round and surface a trend — are the agents converging? Diverging? Stuck in oscillation?

This matters because the current system has a blind spot: two agents can cycle through the same arguments (Proposer defends A1, Critic re-challenges A1, Proposer defends A1 again) while the round counter ticks up. The hard cap will eventually catch this, but a disagreement trend detector could catch it earlier and more gracefully — for example, by injecting a mediator message that says "The following assumption has been challenged and defended in 3 consecutive rounds without movement. Please either produce new evidence or concede."

This would also make the system more honest about what it *didn't* resolve, rather than letting a deadlocked assumption slip into the final document as a quiet open question.

---

### Architectural Notes

**No orchestration framework used.** LangChain, CrewAI, and similar tools were considered. They were rejected because: (1) the state management in this system is simple enough that a framework would add more abstraction than value; (2) prompt transparency is an explicit evaluation criterion, and frameworks tend to bury prompts inside configuration objects; (3) the Anthropic SDK is sufficient and the resulting code is easier for a reviewer to follow without framework knowledge.

**Separate conversation histories per agent.** The Proposer and Critic each maintain their own `messages` array rather than sharing a single thread. This prevents cross-contamination of persona — the Proposer doesn't "see itself" as the Critic, and vice versa. The cross-feed between rounds is explicit (each agent receives the other's last output as a user-turn injection), which makes the information flow traceable.

**JSON-only agent outputs.** Both agents are instructed to respond exclusively in JSON. This is enforced by the output schema in each system prompt and by the parser in `agents.js`, which strips markdown fences if the model adds them. Structured output makes the orchestration logic simple and the final Summarizer pass reliable — the Summarizer can reference specific fields rather than parsing prose.
