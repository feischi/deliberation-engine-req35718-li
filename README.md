# Deliberation Engine

A two-agent AI system that takes a vague feature request and produces a structured decision document through multi-round deliberation. Built for a Government CRM context.

## Architecture

```
Input (feature request)
        ↓
   PROPOSER agent   ←→   CRITIC agent
   (interprets &          (challenges &
    defends scope)         signals done)
        ↓
  SUMMARIZER agent
        ↓
  Decision Document (JSON)
```

Three agents with distinct roles:
- **Proposer** — Interprets the request, makes assumptions explicit, defends positions under challenge
- **Critic** — Generates specific, targeted challenges; signals satisfaction when the proposal is robust
- **Summarizer** — Neutral third pass that synthesizes the full dialogue into a final decision document

Termination is driven by **Critic satisfaction** (not a round counter), with a hard cap as a safety fallback. See `DECISIONS.md` for full rationale.

## Setup

### Prerequisites
- Node.js 18+
- An Anthropic API key

### Install

```bash
npm install
```

### Configure

Create a `.env` file:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Running

### Use a built-in example (1, 2, or 3)

```bash
node index.js 1   # "right person to contact in each country"
node index.js 2   # "full history of engagement"
node index.js 3   # "alert when relationship goes cold"
```

### Use your own feature request

```bash
node index.js "We need a way to flag duplicate contact records across countries."
```

### Via environment variable

```bash
FEATURE_REQUEST="Contacts should have a priority tier." node index.js
```

### Default (example 1, no args)

```bash
node index.js
```

## Output

Every run produces two files in `output/`:
- `<example_index>-run-<timestamp>.txt` — full deliberation transcript (console log without ANSI colors)
- `<example_index>-decision-<timestamp>.json` — the final structured decision document

## File Structure

```
deliberation-engine/
├── index.js              # Orchestration logic (the loop)
├── agents.js             # API calls + JSON parsing per agent role
├── config.js             # Feature request resolution + tuning constants
├── logger.js             # Console output + transcript accumulation
├── prompts.js            # ALL agent system prompts (clearly separated)
├── compare.js            # Multi-variant comparison runner
├── compare-config.json   # Comparison variant definitions
├── output/               # Run transcripts and decision documents
├── DECISIONS.md          # Architectural decisions and rationale
├── package.json
└── README.md
```

## Configuration

In `config.js`:

| Constant | Default | Description |
|---|---|---|
| `MIN_ROUNDS` | 2 | Minimum deliberation rounds before Critic can satisfy |
| `MAX_ROUNDS` | 5 | Hard cap — termination fallback if Critic never satisfies |
| `MAX_ASSUMPTIONS_PER_ROUND` | 5 | Max assumptions the Proposer may list per round |
| `DEFAULT_EXAMPLE` | 1 | Which built-in example to use when no input is provided |

## Cost

Uses `claude-sonnet-4-6`. A typical 3-round deliberation costs approximately $0.01–0.03.

## Comparison

Run the same feature request through multiple config variants and compare results side-by-side.

### Define variants in `compare-config.json`

```json
{
  "feature_request": "We need a better way to track who is the right person to contact in each country.",
  "variants": [
    { "label": "baseline", "config": { "MIN_ROUNDS": 2, "MAX_ROUNDS": 5, "MAX_ASSUMPTIONS_PER_ROUND": 5 } },
    { "label": "strict",   "config": { "MIN_ROUNDS": 3, "MAX_ROUNDS": 6, "MAX_ASSUMPTIONS_PER_ROUND": 5 } },
    { "label": "narrow",   "config": { "MIN_ROUNDS": 2, "MAX_ROUNDS": 5, "MAX_ASSUMPTIONS_PER_ROUND": 3 } }
  ]
}
```

The `feature_request` field accepts a plain string or `{ "example": 1 }` to use a built-in example.

### Run

```bash
node compare.js                          # uses ./compare-config.json
node compare.js path/to/other-config.json
```

Variants run sequentially. Each produces its own `<label>-run-<timestamp>.txt` and `<label>-decision-<timestamp>.json` in `output/`. After all variants complete, a console table and `output/comparison-<timestamp>.md` report are saved.

### Metrics compared

| Metric | Description |
|---|---|
| Rounds taken | How many deliberation rounds ran |
| Termination | `critic_satisfied` or `max_rounds_reached` |
| Proposer confidence (final) | Proposer's self-reported confidence in the last round |
| Critic score (final) | Critic's score of the proposal in the last round |
| Confidence gap | `abs(proposer - critic)` — measures alignment |
| Assumptions proposed / defended / revised / conceded | Assumption lifecycle across all rounds |
| Open questions | Count of unresolved questions in the final document |
| Total tokens | Sum of input + output tokens across all agent calls |
| Recommendation | `proceed`, `proceed_with_caution`, or `hold_for_human_review` |

Each decision document also contains a `run_metadata` field with the full per-round scores, assumption breakdown, config used, and total token count.
