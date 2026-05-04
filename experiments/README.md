# Experiment Reproduction Guide

This folder contains the initial experiment contract for comparing few-shot,
static RAG, and learned-domain planners in the local 2004 RuneScape environment.

The goal of this README is to let a grader or interested reader recreate the
experiment runtime, data, Graph RAG context, local bot, and structured state
snapshots from a fresh checkout.

## Quick Path

From the repository root:

```powershell
# 1. Install root dependencies used by tools and SDK scripts.
bun install

# 2. Generate the 2004 strict and fallback wiki datasets.
bun tools/osrs-wiki-filter-temporal.ts --out data/wiki/osrs-wiki-structured-2004.jsonl --stats-out data/wiki/osrs-wiki-structured-2004-stats.json
bun tools/osrs-wiki-filter-temporal.ts --include-unknown-added --out data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --stats-out data/wiki/osrs-wiki-structured-2004-plus-unknown-stats.json

# 3. Generate the strict and fallback graphs.
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured-2004.jsonl --out-dir data/wiki/graph-2004 --max-page-links 25 --page-rank-iterations 25 --no-missing-pages
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --out-dir data/wiki/graph-2004-plus-unknown --max-page-links 25 --page-rank-iterations 25 --no-missing-pages

# 4. Start the local game server in a separate terminal.
cd server/engine
bun install
bun --env-file=.env.experiment run src/app.ts
```

In a second terminal, build/watch the web client used by `/bot`:

```powershell
cd server/webclient
bun install
bun run watch
```

In a third terminal, start the SDK gateway:

```powershell
cd server/gateway
bun install
bun run gateway
```

Then, in a fourth terminal from the repository root:

```powershell
# 5. Create a local bot account. Name must be 12 chars or fewer.
bun bots/create-bot.ts ExpBot --local

# 6. Launch/connect the bot client. This opens the browser client if needed.
bun bots/ExpBot/script.ts

# 7. Inspect state.
bun sdk/cli.ts ExpBot --server localhost --timeout 15000

# 8. Capture structured JSON state.
bun experiments/snapshot.ts ExpBot --server localhost
```

Optional Graph RAG smoke test:

```powershell
cd agents/cse476-final-project
python osrs_agent.py --question "What facts support cooking shrimp?" --no-llm --show-context
```

## Prerequisites

- Bun available on PATH.
- Java JDK available on PATH for the first engine cache pack/build. Verify with `java -version`.
- Python 3 for the Graph RAG agent.
- Ollama only if you want LLM answers rather than retrieval-only smoke tests.

Useful model setup:

```powershell
ollama pull gemma3:12b
ollama serve
```

## Local Runtime

Use the experiment env file for 2004/realtime settings. Install dependencies in
`server/engine` before the first run:

```powershell
cd server/engine
bun install
bun --env-file=.env.experiment run src/app.ts
```

The first engine startup may pack the cache. If Java is missing, startup can
fail with missing generated files such as `data/pack/server/script.dat`. Install
a JDK, confirm `java -version` works in the same shell, then run the engine
again.

Important settings in `server/engine/.env.experiment`:

```env
NODE_TICKRATE=600
NODE_XPRATE=1
NODE_PROFILE=experiments
NODE_RANDOM_EVENTS=false
NODE_DEBUG=true
NODE_DEBUG_SOCKET=true
NODE_INFINITE_RUN=true
```

Notes:

- `NODE_TICKRATE=600` is one server tick every 0.6 seconds.
- `NODE_XPRATE=1` disables accelerated XP.
- `NODE_PROFILE=experiments` isolates generated saves under `server/engine/data/players/experiments`.
- `NODE_INFINITE_RUN=true` ignores run energy for evaluation.
- I did not find an existing pause-and-step engine console. For now, use SDK tick observation commands below. True single-tick stepping will need a small engine control endpoint or a world-loop pause mode.

Expected success line:

```text
World ready: Visit http://localhost:8888/rs2.cgi
```

## Web Client Watcher

Run the web client watcher when developing locally:

```powershell
cd server/webclient
bun install
bun run watch
```

The engine serves browser assets directly from `server/webclient/out`:

```text
/client/* -> server/webclient/out/standard/*
/bot/*    -> server/webclient/out/bot/*
```

The bot route at `http://localhost:8888/bot` uses the bot build with the SDK
overlay enabled. This is the right place to add experiment monitoring UI, agent
output panels, episode IDs, verifier summaries, or action traces. Useful files:

```text
server/webclient/src/bot/BotOverlay.ts
server/webclient/src/bot/OverlayUI.ts
server/webclient/src/bot/StateCollector.ts
server/webclient/src/bot/GatewayConnection.ts
```

The local bot page command bar includes experiment controls:

```text
Pause game | Step tick | State snapshot
```

`Pause game` and `Step tick` call the engine debug control endpoints under
`/api/experiment/*`, so the engine must be restarted after changing those
endpoints. `State snapshot` downloads the current browser-side bot state as JSON.

For non-UI smoke tests, an existing build in `server/webclient/out` may be
enough. If the route fails to load `/bot/client.js`, or if you are editing any
webclient code, run `bun run watch`.

## SDK Gateway

The SDK does not connect directly to the game engine. It connects to the gateway
on `ws://localhost:7780`. The browser bot client connects to the engine origin
at `ws://localhost:8888/gateway`, and the engine proxies that connection to the
gateway on `7780`.

Start the gateway in its own terminal:

```powershell
cd server/gateway
bun install
bun run gateway
```

Expected success lines:

```text
[Gateway] Gateway running at http://localhost:7780
[Gateway] Bot/SDK: ws://localhost:7780
```

Health checks:

```powershell
# Engine web server
curl http://localhost:8888/engine-status

# SDK gateway
curl http://localhost:7780/status
```

If `bun sdk/cli.ts ExpBot --server localhost` fails with `ws://localhost:7780`
connection errors, the gateway is not running or is on a different `AGENT_PORT`.

Do not use `--server localhost:8888` for normal SDK commands. Port `8888` is the
game/web server. The SDK gateway is `7780`.

## Data Artifacts

The target game version is the 2004 preservation cutoff documented in
`RS_SDK_HARNESS_AUDIT.md`: `2004-09-07`.

Strict dataset:

```text
data/wiki/osrs-wiki-structured-2004.jsonl
data/wiki/graph-2004/
```

Fallback dataset including unknown release dates:

```text
data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl
data/wiki/graph-2004-plus-unknown/
```

Use strict first. Use the fallback dataset only when strict retrieval is sparse
or lacks needed structured facts. Fallback facts should be marked with weaker
provenance.

## Create and Run a Local Bot

From the repo root:

```powershell
bun bots/create-bot.ts ExpBot --local
```

Bot names must be alphanumeric and at most 12 characters. For example,
`ExperimentBot` is too long, while `McPlan` or `ExpBot` are valid.

`--local` writes `SERVER=localhost` in `bots/<name>/bot.env`, which makes SDK
commands use `ws://localhost:7780`.

Launch the browser bot client with the starter script:

```powershell
bun bots/ExpBot/script.ts
```

Or open the bot client manually after the engine and gateway are running:

```text
http://localhost:8888/bot?bot=ExpBot&password=<PASSWORD_FROM_bot.env>
```

Current local `McPlan` browser URL:

```text
http://localhost:8888/bot?bot=McPlan&password=VVmo41xNJHPg
```

With the local server running, inspect state:

```powershell
bun sdk/cli.ts ExpBot --server localhost --timeout 15000
```

Run the starter script:

```powershell
bun bots/ExpBot/script.ts
```

If the bot is on tutorial island, scripts should call:

```typescript
await bot.skipTutorial();
```

On first browser login, the bot client auto-logs in but does not automatically
click `Skip Tutorial`. Click it manually for ad hoc setup, or call
`await bot.skipTutorial()` at the start of experiment scripts. After skipping,
`McPlan` landed at Lumbridge spawn around `(3221, 3222)` with the standard
tutorial completion inventory.

Generated experiment saves usually set tutorial varp `281 = 1000`, so tests that
use `generateSave()` should pass `skipTutorial: false`.

## Snapshot and Tick Commands

JSON state snapshot:

```powershell
bun experiments/snapshot.ts ExpBot --server localhost
```

Full raw state plus compact summary:

```powershell
bun experiments/snapshot.ts ExpBot --server localhost --full --out runs/expbot-snapshot.json
```

Wait one tick and print before/after/delta:

```powershell
bun experiments/tick.ts ExpBot --server localhost --ticks 1
```

Wait five ticks:

```powershell
bun experiments/tick.ts ExpBot --server localhost --ticks 5 --full
```

These commands do not pause the world. They connect to the SDK, wait for the requested number of server ticks, and print structured state summaries/deltas.

## Checkpointed Save States

Local experiments can start from controlled checkpoint saves. Use:

```typescript
import { generateSave, Items, Locations } from '../sdk/test/utils/save-generator';

await generateSave('ExpCook', {
  position: Locations.ALKHARID_FISHING,
  skills: { Cooking: 1 },
  inventory: [
    { id: Items.RAW_SHRIMPS, count: 1 },
  ],
});
```

Generated saves are written under the active engine profile, usually:

```text
server/engine/data/players/experiments/<botname>.sav
```

This lets few-shot, static RAG, and learned-domain planners start from identical
state for fair comparisons.

Run an existing SDK test that uses checkpoint generation:

```powershell
bun sdk/test/anvil-smithing.ts
```

Many examples live under `sdk/test/*.ts`.

## Graph RAG Commands

The Graph RAG agent defaults to the strict 2004 dataset:

```powershell
cd agents/cse476-final-project
python osrs_agent.py --question "Build a small domain model for cooking shrimp."
```

Retrieval-only:

```powershell
python osrs_agent.py --question "What facts support cooking shrimp?" --no-llm --show-context
```

Fallback retrieval:

```powershell
python osrs_agent.py --structured ../../data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --graph-dir ../../data/wiki/graph-2004-plus-unknown --question "What is combat?" --no-llm --show-context
```

Model benchmark:

```powershell
python benchmark_osrs_models.py --models gemma3:12b gemma3:4b deepseek-r1:7b --out-dir results/osrs_benchmarks/reproduction
```

## Schemas

Core schemas live in `experiments/schemas.ts`.

The main artifacts are:

- `TaskSpec`
- `StateSummary`
- `StateDelta`
- `VerifierSpec`
- `VerifierResult`
- `LearnedActionSchema`
- `EpisodeTrace`

State helpers live in `experiments/state-summary.ts`.

Verifier helpers live in `experiments/verifier.ts`.

Smoke task definitions live in `experiments/tasks.ts`.

Connection helpers live in `experiments/connect.ts`.

Snapshot CLI lives in `experiments/snapshot.ts`.

Tick observation CLI lives in `experiments/tick.ts`.

## Planner Interface Direction

All planner methods should eventually consume the same input:

```typescript
interface PlannerInput {
  task: TaskSpec;
  state: StateSummary;
  learnedActions?: LearnedActionSchema[];
  retrievalContext?: string;
}
```

And produce:

```typescript
interface PlannerOutput {
  plan: PlanStep[];
  candidateActions?: LearnedActionSchema[];
  verifierHints?: VerifierSpec[];
}
```

The difference between methods should be what context they receive:

- Few-shot: task + state + SDK action summary only.
- Static RAG: task + state + strict 2004 Graph RAG context, with lax fallback if needed.
- Learned domain: task + state + RAG context + persistent learned action schemas + prior episode traces.

## Next Implementation Slice

The first executable vertical slice should be `cook_shrimp`:

1. Generate a local save with `Raw shrimps`, Cooking level 1, and a nearby cooking facility.
2. Snapshot before state.
3. Run one planner-produced bounded action script.
4. Snapshot after state.
5. Compute `StateDelta`.
6. Evaluate `VerifierSpec[]`.
7. Write an `EpisodeTrace` JSON file.

## Troubleshooting

If `sdk/cli.ts` says no state was received:

- Make sure the local engine is running.
- Make sure the gateway is running on `localhost:7780`.
- Visit `http://localhost:8888/bot` or run a bot script so the browser client connects.
- Confirm the bot was created with `--local`.

If `sdk/cli.ts` fails to connect to `ws://localhost:7780`:

- Start the gateway with `cd server/gateway; bun install; bun run gateway`.
- Check `curl http://localhost:7780/status`.
- Do not point SDK commands at `localhost:8888`; that is the engine web server, not the SDK gateway.

If the bot state is stale:

- Refresh the browser client.
- Re-run `bun sdk/cli.ts ExpBot --server localhost --timeout 15000`.

If data retrieval seems missing:

- Try the fallback Graph RAG dataset with `graph-2004-plus-unknown`.
- Remember that strict filtering excludes unknown release dates.

If XP values look accelerated:

- Confirm the server was started with `server/engine/.env.experiment`.
- Confirm `NODE_XPRATE=1`.

If first engine startup fails with `java` not found or missing
`data/pack/server/script.dat`:

- Install a Java JDK.
- Confirm `java -version` works in the same terminal.
- Re-run `cd server/engine; bun --env-file=.env.experiment run src/app.ts`.
