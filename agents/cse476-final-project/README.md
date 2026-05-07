## OSRS Graph RAG Agent

This folder vendors and adapts the original CSE-476 agent framework into a local
OSRS Wiki Graph RAG agent for the `rs-sdk-temporal-planning` project.

The goal is no longer generic course-question answering. The new purpose is to
help an agent use crawled OSRS Wiki data to propose domain-model facts for game
planning: entities, actions, preconditions, effects, resources, locations, and
uncertainties that should be verified in-game.

## Setup

Create a Python environment and install the small dependency set:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Install and start Ollama, then pull a local model:

```bash
ollama pull gemma3:12b
ollama serve
```

The default API configuration is Ollama's OpenAI-compatible endpoint:

```env
OPENAI_API_KEY=ollama
API_BASE=http://127.0.0.1:11434/v1
MODEL_NAME=gemma3:12b
```

For an RTX 3090-class machine, `gemma3:12b` is the recommended default for
domain-model drafting. `gemma3:4b` is still useful for cheap fast feedback,
`deepseek-r1:7b` is a good 7B-class fallback, and `gpt-oss:20b` fits but did not
outperform `gemma3:12b` on the small OSRS Graph RAG benchmark.

## Required Data

From the parent repository, generate the structured wiki dataset and graph first:

```powershell
bun tools/osrs-wiki-structure.ts --out data/wiki/osrs-wiki-structured.jsonl
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured.jsonl --out-dir data/wiki/graph-gephi-small --max-page-links 25 --page-rank-iterations 25
bun tools/osrs-wiki-filter-temporal.ts --out data/wiki/osrs-wiki-structured-2004.jsonl --stats-out data/wiki/osrs-wiki-structured-2004-stats.json
bun tools/osrs-wiki-filter-temporal.ts --include-unknown-added --out data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --stats-out data/wiki/osrs-wiki-structured-2004-plus-unknown-stats.json
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured-2004.jsonl --out-dir data/wiki/graph-2004 --max-page-links 25 --page-rank-iterations 25 --no-missing-pages
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --out-dir data/wiki/graph-2004-plus-unknown --max-page-links 25 --page-rank-iterations 25 --no-missing-pages
```

The agent defaults to:

- `../../data/wiki/osrs-wiki-structured-2004.jsonl`
- `../../data/wiki/graph-2004`

Those paths are relative to this folder.

**LostHQ (2004 client NPC/item data):** from the repo root, sync static JSON used by [LostHQ](https://2004.losthq.rs/):

```powershell
bun tools/losthq-sync.ts
```

That writes `data/losthq/npc_data.json`, `item_data.json`, and `shared_drops.json`. Then pass `--losthq` to `osrs_agent.py` to append catalog matches to the prompt, or use ReAct tools `losthq_search`, `losthq_npc`, `losthq_item` from `src/tools.py`.

## Run

Retrieval-only smoke test:

```bash
python osrs_agent.py --question "How do I craft a perfect ring?" --no-llm --show-context
```

Ask the local model with retrieved graph context:

```bash
python osrs_agent.py --question "Build a small domain model for crafting a perfect ring."
```

Interactive mode:

```bash
python osrs_agent.py --interactive --show-context
```

Useful options:

- `--model gemma3:12b`
- `--api-base http://127.0.0.1:11434/v1`
- `--top-k 6`
- `--neighbors 14`
- `--primary-type item`
- `--no-llm`

## Benchmark Models

Run the reproducible benchmark with:

```bash
python benchmark_osrs_models.py --models gemma3:12b deepseek-r1:7b gemma3:4b
```

The benchmark writes JSON, CSV, and Markdown reports under
`results/osrs_benchmarks/`. The current post-retrieval-fix run on an RTX 3090
tested recipe domain modeling, recipe planning feedback, and NPC variant banking:

| Model | Avg generation s | Avg total s | Avg score | Notes |
|---|---:|---:|---:|---|
| `gemma3:12b` | 4.96 | 5.49 | 6.00 | Recommended default for domain-model generation. |
| `gemma3:4b` | 5.52 | 6.05 | 6.33 | Fast, surprisingly competitive for short planning feedback. |
| `deepseek-r1:7b` | 5.98 | 6.51 | 5.67 | Good 7B-class option, especially for variant-style reasoning. |
| `gpt-oss:20b` | 5.80 | 6.33 | 6.00 | Fits locally, but added no clear benefit in this benchmark. |

Retrieval-only latency after index load was roughly `0.5s` per query. The index
load itself was about `27s` for `35,003` pages, so long-running interactive
sessions should keep the index in memory.

## How It Works

`src/osrs_graph_rag.py` loads the structured wiki records and graph exports,
then builds:

- A lexical index over titles, aliases, categories, leads, and infobox fields.
- Page metadata for filtering by coarse type, dates, categories, actions, recipes,
  equipment, variants, and map facts.
- A graph expansion layer over semantic wiki edges such as `lead_link`,
  `infobox_link`, `requires_material`, `requires_skill`, `produces_item`,
  `variant_location`, and `has_action`.

`osrs_agent.py` retrieves direct matches and important graph neighbors, then
sends the grounded context to the local model with a domain-model prompt.

The older ReAct loop is still present. It now has two OSRS tools:

- `wiki_search[query]`
- `graph_expand[page title]`

## Agent Behavior

The local LLM is instructed to:

- Use retrieved wiki context as evidence.
- Separate hard structured facts from planning hypotheses.
- Express domain-model answers as entities, actions, preconditions, effects,
  resources/locations, and uncertainty.
- Identify which wiki pages or graph edges support the answer.
- Ask for additional wiki/game observations when evidence is insufficient.

This is meant to support the earlier proposal: learning a domain model from wiki
text plus environmental feedback, then using that domain model for LLM planning
in a dynamic game environment.
