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
- `run-<timestamp>.txt` — full deliberation transcript (console log without ANSI colors)
- `<example_index>-decision-<timestamp>.json` — the final structured decision document

## File Structure

```
deliberation-engine/
├── index.js              # Orchestration logic (the loop)
├── agents.js             # API calls + JSON parsing per agent role
├── config.js             # Feature request resolution + tuning constants
├── logger.js             # Console output + transcript accumulation
├── prompts/
│   └── agents.js         # ALL agent system prompts (clearly separated)
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
| `MAX_ROUNDS` | 6 | Hard cap — termination fallback if Critic never satisfies |
| `DEFAULT_EXAMPLE` | 1 | Which built-in example to use when no input is provided |

## Cost

Uses `claude-haiku-4-5-20251001`. A typical 3-round deliberation costs approximately $0.01–0.03.
