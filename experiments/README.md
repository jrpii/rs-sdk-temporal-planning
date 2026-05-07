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
Pause game | Step tick | State snapshot | Save checkpoint | Load checkpoint
```

`Pause game`, `Step tick`, `Save checkpoint`, and `Load checkpoint` call the engine
debug control endpoints under `/api/experiment/*`, so the engine must be
restarted after changing those endpoints. `State snapshot` downloads the current
browser-side bot state as JSON. `Save checkpoint` downloads the current live
player state as a binary `.sav` file. `Load checkpoint` uploads a `.sav` checkpoint
for the current bot username under the active `NODE_PROFILE`; if the bot is
online, the engine disconnects it without saving over the checkpoint and the
browser refreshes to load the checkpoint.
While paused, the engine keeps browser and SDK I/O alive but does not advance
world ticks until you click `Step tick` or resume.

The bot SDK overlay is split into a left world-state panel and a right column.
The world-state panel has `Copy`, `Save Text`, and `Save JSON` buttons. The
right column stacks the SDK action log above a browser terminal. The terminal can
run short built-in commands such as `state`, `npcs`, `walk 3221 3222`,
`dialog 1`, `pause`, `resume`, `step`, `save`, and `load`; it can also run
JavaScript against the local `client` and `helpers` objects with commands such as
`js client.getBotState()`.

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

The SDK CLI requires a browser bot session with the same username to already be
connected to the gateway. If `ExpBot` is not open at `/bot`, the gateway can
accept the SDK connection but there will be no bot state to return. Open:

```text
http://localhost:8888/bot?bot=ExpBot&password=<PASSWORD_FROM_bot.env>
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

There are two different snapshot/checkpoint concepts:

- JSON state snapshots are observations for logs, deltas, verifiers, and episode traces.
- Binary `.sav` checkpoints are restorable game save files for resetting an experiment start state.

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

```powershell
bun experiments/create-save.ts McPlan --preset LUMBRIDGE_SPAWN --profile experiments
bun experiments/create-save.ts ExpBot --preset FISHER_AT_ALKHARID --profile experiments
bun experiments/create-save.ts McPlan --preset COOK_SHRIMP_LUMBRIDGE --profile experiments
bun experiments/create-save.ts McPlan --preset COOK_SHRIMP_ALKHARID --profile experiments
```

List available presets:

```powershell
bun experiments/create-save.ts --list
```

You can also use a JSON config:

```powershell
bun experiments/create-save.ts CookBot --config experiments/save-configs/cook-shrimp.json --profile experiments
bun experiments/create-save.ts CookBot --config experiments/save-configs/cook-shrimp-alkharid.json --profile experiments
```

Create the checkpoint in the engine save directory and also keep a named copy
under `runs/checkpoints`:

```powershell
bun experiments/create-save.ts McPlan --preset COOK_SHRIMP_LUMBRIDGE --profile experiments --out runs/checkpoints/cook-shrimp.sav
bun experiments/create-save.ts McPlan --preset COOK_SHRIMP_ALKHARID --profile experiments --out runs/checkpoints/cook-shrimp-alkharid.sav
```

`create-save.ts` always generates a synthetic checkpoint from an explicit
`--preset` or `--config`; it is not the same as the browser `Save checkpoint`
button. To save the current live browser bot state from the CLI, use:

```powershell
bun experiments/save-checkpoint.ts McPlan --api http://localhost:8888 --out runs/checkpoints/McPlan-cook-shrimp-alkharid.sav
```

Example config:

```json
{
  "position": { "x": 3222, "z": 3218 },
  "skills": { "Cooking": 1 },
  "inventory": [
    { "id": 317, "count": 1 }
  ]
}
```

The script writes a binary `.sav` to:

```text
server/engine/data/players/experiments/<botname>.sav
```

The live-state save command calls the running engine at
`http://localhost:8888/api/experiment/save` by default, matching the browser
button. Pass `--api http://localhost:8888` explicitly if you want the command to
show which engine it is using.

Load an existing `.sav` from the CLI:

```powershell
# Offline/simple path: copy checkpoint into the active profile save directory.
bun experiments/load-save.ts McPlan server/engine/data/players/experiments/mcplan.sav --profile experiments

# Online path: ask the running engine to verify/install it and disconnect the live player.
bun experiments/load-save.ts McPlan runs/checkpoints/cook-shrimp.sav --api http://localhost:8888
```

If the bot is already online and you use the offline copy path, refresh/relog the
browser after copying. If you use the browser `Load checkpoint` control, the page
will refresh after the engine installs the checkpoint.

For the known-working McPlan Al Kharid checkpoint flow, use:

```powershell
# Optional: save the current hand-tuned browser state.
bun experiments/save-checkpoint.ts McPlan --api http://localhost:8888 --out runs/checkpoints/McPlan-cook-shrimp-alkharid.sav

# If McPlan is online, install through the running engine so it disconnects safely.
bun experiments/load-save.ts McPlan runs/checkpoints/McPlan-cook-shrimp-alkharid.sav --api http://localhost:8888

# Reopen/relog the browser bot page, then confirm state.
bun sdk/cli.ts McPlan --server localhost --timeout 15000 --launch
```

Programmatic usage:

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

Minimal task preset JSON files live in `experiments/task-presets/`. For the
cook-shrimp vertical slice, start with:

```text
experiments/task-presets/cook-shrimp-alkharid.json
```

That file links the initial checkpoint path, records a human task description,
and gives both a minimal `goalState` and executable `success` verifiers.

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

The first planner boundary lives in `experiments/planner.ts`. It exposes both a
scripted cook-shrimp planner (`ScriptedCookShrimpPlanner`) and the symbolic
forward-search planner (`SymbolicDomainPlanner`). **`experiments/run-episode.ts`
defaults to passing a learned domain into `createPlanner`, so `few_shot`,
`static_rag`, `pddl`, and `learned_domain` episode runs all use the same
symbolic planner unless you pass `--scripted-planner`** (only affects `few_shot`
/ `static_rag`). See the comment block at the top of `planner.ts`.

PDDL text export remains useful for inspection and external planners once the
predicate/action set is stable.

### Process exit codes, discovery bootstrap, and transition logs

- **`run-episode` exits 0** when the driver completes normally **even if task verifiers fail**. Inspect `verifier.success` / `trace.metrics.success` in the JSON output file.
- **`run-batch`** subprocess `ok: true` means the episode process exited cleanly; it does **not** guarantee verifier pass — check batch row `success` / trace summaries.
- If **`symbolicPlan` finds no plan**, **`--discovery-on-empty-plan`** (default **on**) injects a **bounded deterministic discovery cycle** (explore → open door → cook for cook-shrimp tasks) so execution produces transitions and traces instead of stopping immediately. Disable with `--no-discovery-on-empty-plan`.
- **Append-only transition logs** (JSONL): default **`runs/transitions/global.jsonl`**. Disable global append with `--no-transition-log-global`. Optional **`--transition-log-task`** writes additional rows under `<task-dir>/by-task/<taskId>.jsonl`, and **`--transition-log-trial PATH`** stores rows only for that file (for isolated experiments).
- **Replay / consistency check** from logs vs task verifiers:

```powershell
bun experiments/replay-transition-log.ts --episode <EpisodeTrace.episodeId> --log runs/transitions/global.jsonl --task experiments/task-presets/cook-shrimp-alkharid.json --trace runs/traces/<same-run>.json
```

- **Symbolic delete semantics** (`item_removed` etc.) are covered by `bun test experiments/pddl-symbolic.test.ts`.

### Structured schema reference (search-friendly)

The experiment layer uses **grouped** structures for nearby entities to reduce redundancy and enable clean lookups like:

- `"nearbyLocs"."Range"` (everything called Range)
- `"nearbyLocs"."Rockslide".variants["474|"]` (a specific id/options variant)

#### `StateSummary.nearbyLocs` / `nearbyNpcs`

`nearbyLocs` is grouped by **name**, then by **variant** (`<id>|<optionsKey>`), then by instances:

```json
{
  "nearbyLocs": {
    "Rockslide": {
      "name": "Rockslide",
      "variants": {
        "474|": {
          "id": 474,
          "options": [],
          "instances": [
            { "x": 3331, "z": 3176, "distance": 1 },
            { "x": 3330, "z": 3174, "distance": 2 }
          ]
        }
      }
    }
  }
}
```

`nearbyNpcs` is grouped by **name**, then by variant (`<combatLevel>|<optionsKey>`):

```json
{
  "nearbyNpcs": {
    "Shop assistant": {
      "name": "Shop assistant",
      "variants": {
        "0|Talk-to|Trade": {
          "combatLevel": 0,
          "options": ["Talk-to", "Trade"],
          "instances": [
            { "index": 5577, "x": 3315, "z": 3181, "distance": 15, "inCombat": false, "hp": 0, "maxHp": 0 }
          ]
        }
      }
    }
  }
}
```

#### `TransitionLogRecord.observedWorldObjects`

For each logged step, transition rows include a compact, low-redundancy snapshot of raw world objects. This is grouped as:

`kind -> name -> variantKey -> instances`

```json
{
  "observedWorldObjects": {
    "loc": {
      "Rockslide": {
        "level": 0,
        "variants": {
          "471|": {
            "id": 471,
            "options": [],
            "instances": [
              { "x": 3331, "z": 3170, "distance": 1 },
              { "x": 3332, "z": 3168, "distance": 2 }
            ]
          }
        }
      }
    }
  }
}
```

#### Knowledge base (`runs/kb/*.json`)

The KB is a **deduped persistent store** fed from raw SDK state each executed step:

- Locs: grouped by **name**, then by **id** (no redundant per-id `name` field)
- NPCs: grouped by **name**, then by **variant key** (`combatLevel|level|optionsKey`). Coordinates are intentionally **not** part of the key to avoid drift duplication.

The initial symbolic layer is now split into:

- `experiments/domain-model.ts` for action documentation, the default cook-shrimp
  domain, and state/goal fact extraction.
- `experiments/pddl.ts` for PDDL domain/problem export plus a small in-process
  STRIPS-style forward-search planner.
- `experiments/extract-domain.ts` for asking local Ollama models to draft
  `LearnedDomainModel` JSON files from action docs, start state, and goal.

Example LLM/domain extraction:

```powershell
bun experiments/extract-domain.ts --task experiments/task-presets/cook-shrimp-alkharid.json --models gemma3:12b,gemma3:4b --out runs/domain-models
```

For the static RAG arm, seed the LLM extraction with the 2004 Graph RAG context:

```powershell
bun experiments/extract-domain.ts --task experiments/task-presets/cook-shrimp-alkharid.json --models gemma3:12b --rag --out runs/domain-models
```

After an episode, refine the model from the trace:

```powershell
bun experiments/refine-domain.ts --domain runs/domain-models/cook_shrimp_alkharid-gemma3_12b.json --trace runs/traces/<episode>.json --model gemma3:12b --out runs/domain-models/cook_shrimp_alkharid-gemma3_12b-refined.json
```

Then run the symbolic/PDDL-backed episode against one extracted model:

```powershell
bun experiments/run-episode.ts experiments/task-presets/cook-shrimp-alkharid.json --bot McPlan --method pddl --model gemma3:12b --domain runs/domain-models/cook_shrimp_alkharid-gemma3_12b.json --server localhost --force-run
```

The first executable episode driver lives in `experiments/run-episode.ts`:

```powershell
bun experiments/run-episode.ts experiments/task-presets/cook-shrimp-alkharid.json --bot McPlan --method few_shot --server localhost --force-run
```

For `cook_shrimp`, the current executor sends `useItemOnLoc` directly through the
SDK after selecting the nearest visible `Range`/`Fire`. It waits for an inventory
or Cooking XP outcome, treats burned shrimp as a valid stochastic action outcome,
and retries while the planner has remaining bounded steps.

The cook-shrimp verifier is transition-based: success requires `inventory_gained`
for cooked `Shrimps` and `xp_gained` for Cooking. This avoids counting shrimp
that were already in inventory before the episode.

## Next Implementation Slice

The first executable vertical slice should be `cook_shrimp`:

1. Load `experiments/task-presets/cook-shrimp-alkharid.json`.
2. Install `startState.checkpointPath` with `experiments/load-save.ts`.
3. Reopen/relog `McPlan` with `sdk/cli.ts --launch` or the browser URL.
4. Snapshot before state.
5. Run `experiments/run-episode.ts`, which executes the bounded plan from
   `experiments/planner.ts`.
6. Inspect the `EpisodeTrace` JSON written under `runs/traces/`.

After that works once, run the same task across `few_shot`, `static_rag`, and
`learned_domain`, then repeat across local Ollama models and aggregate success,
time-to-completion, invalid actions, replans, and learned-domain improvement
over episodes.

The batch wrapper for this is `experiments/run-batch.ts`:

```powershell
bun experiments/run-batch.ts experiments/task-presets/cook-shrimp-alkharid.json --bot McPlan --runs 5 --methods few_shot,static_rag,pddl,learned_domain --models none,gemma3:12b --server localhost --api http://localhost:8888 --rag
```

Use a different starting checkpoint without editing the task JSON:

```powershell
bun experiments/run-batch.ts experiments/task-presets/cook-shrimp-alkharid.json --bot McPlan --runs 5 --methods few_shot,static_rag,pddl,learned_domain --models none,gemma3:12b --server localhost --api http://localhost:8888 --rag --checkpoint runs/checkpoints/McPlan-cook-shrimp-alkharid-2.sav
```

Episode transition logging (forwarded to `run-episode.ts`):

```powershell
# Append per-task JSONL under <domain-dir>/transitions/by-task/<taskId>.jsonl
--episode-transition-log-task

# Also write one JSONL per batch trial under this directory
--episode-transition-log-trial-dir runs/transitions/trials

# Isolated trials without the global log
--episode-no-transition-log-global --episode-transition-log-trial-dir runs/transitions/trials
```

Episode knowledge base (KB) logging + refinement context:

- **Default behavior**: `run-episode.ts` writes/merges into **global KB** at `runs/kb/global.json` unless disabled.
- These batch flags forward into `run-episode.ts` so you can isolate KB per-task or per-trial.
- If you set `--episode-kb-task` or `--episode-kb-trial-dir`, the batch runner will also pass `--kb <path>` into `refine-domain.ts` so the LLM sees the KB during between-episode refinement.

```powershell
# Append per-task KB under <domain-dir>/kb/by-task/<taskId>.json
--episode-kb-task

# Override per-task KB directory (default: <domain-dir>/kb)
--episode-kb-task-dir runs/domain-models/kb

# Also write one KB JSON per batch trial under this directory.
# Filenames include the method so multiple methods can run without bleeding.
--episode-kb-trial-dir runs/kb/trials

# Disable the global KB (use task/trial KB only).
--episode-no-kb-global

# Wipe global KB file before each trial (strong isolation; useful for ablations).
--wipe-global-kb-each-trial
```

Useful batch stability knobs:

```powershell
# Give the browser/engine longer to settle after checkpoint reload.
--settle-ms 8000

# Poll the gateway longer before starting an episode.
--ready-timeout 45000

# Override the task JSON maxSteps for harder starts/tasks.
--max-steps 12

# Batch enables persistent run mode after each relog by default.
# Disable it only when a walking-speed control is useful.
--no-force-run

# learned_domain / <model> enables in-episode LLM replanning by default.
# Disable it for a between-episode-only learning ablation.
--no-agentic-replan

# learned_domain / <model> also enables bounded exploration by default.
# Disable it for a replan-without-exploration ablation.
--no-agentic-explore

# Bound the number of in-episode LLM replans.
--max-replans 2
```

For each run, it installs the checkpoint, relogs the browser bot with
the gateway `/reload/<bot>` endpoint plus `sdk/cli.ts --launch`, runs
`run-episode.ts`, and writes JSON plus CSV summaries under `runs/batch/`. The
summary includes per-run success, duration, invalid action count, verifier
evidence, embedded PDDL artifact status, and aggregate success rates by
method/model.
`run-batch.ts` also passes `--force-run` to `run-episode.ts` by default. This
sets the server-side run toggle through `/api/experiment/run` after the browser
bot relogs, so object/NPC interactions that rely on persistent run mode do not
fall back to walking after checkpoint loads.

For `model != none`, batch extraction happens after the checkpoint is loaded and
the browser bot has relogged. The runner captures a live state snapshot and passes
that snapshot into `extract-domain.ts`, so the LLM sees the actual start
inventory, nearby objects/NPCs, position, and recent messages for that trial.
Non-learned LLM methods generate a fresh domain model per trial. `learned_domain`
generates the first model from the live start state, then intentionally reuses
and refines that model across later runs.

For `learned_domain / <model>`, `run-batch.ts` also enables `run-episode.ts
--agentic-replan --agentic-explore` by default. When a step fails or makes no
progress, the episode controller sends the current domain, task, plan, execution
trace, current state, and optionally Graph RAG context back to the LLM. The LLM
returns a short revised plan, structured learned lessons, and optionally a revised
domain model. Environment failures also add deterministic lessons for common
cases such as unreachable cooking sources, no visible `Range`/`Fire`, and
stochastic burns. After an in-episode domain update, `run-episode.ts` re-runs the
symbolic planner against the updated domain and current world state. It only
falls back to the LLM-authored short plan if the updated symbolic domain still
cannot produce executable recovery steps. Exploration can be ablated separately
with `--no-agentic-explore`; replanning can be ablated separately with
`--no-agentic-replan`.

Current method semantics:

- `few_shot / none`: scripted cook-shrimp control, with no LLM or wiki context.
- `few_shot / <model>`: asks the LLM for a compact symbolic domain from action
  docs, task JSON, live start state, and its internal knowledge only; no wiki/RAG
  context. A fresh domain is generated for each trial.
- `static_rag / none`: scripted control under the static-RAG label; use this only
  as a sanity check, not as a true RAG baseline.
- `static_rag / <model>`: asks the LLM for a compact symbolic domain with 2004
  Graph RAG context when `--rag` is passed, plus the live start state. A fresh
  domain is generated for each trial and is not refined afterward.
- `pddl / none`: uses the default hand-written cook-shrimp symbolic domain.
- `pddl / <model>`: uses an LLM-extracted symbolic domain without persistent
  refinement. A fresh domain is generated for each trial.
- `learned_domain / none`: default symbolic-domain control with no LLM
  refinement.
- `learned_domain / <model>`: starts from an LLM-extracted domain, uses Graph RAG
  context when `--rag` is passed, then calls `refine-domain.ts` after each
  episode and feeds the refined model into the next run. During an episode it can
  also trigger bounded agentic replanning with `use_item_on_cooking_source`,
  `open_nearby_door`, and `explore_for_cooking_source`. In-episode replans are
  now converted back into the domain as `lessons`, negative evidence, and
  executable symbolic action effects before the runner chooses the next steps.

The batch console logs the major LLM/retrieval events: live state snapshot
capture, domain extraction, Graph RAG query text, use of a refined learned model,
domain refinement, planned steps, in-episode agentic replans, symbolic replans
from updated domains, learned environment lessons, exploration actions,
reachability recovery replans, and per-step execution results.

The current exploration action is intentionally bounded for reproducibility. It
scans for a `Range`/`Fire` in a larger radius, tries an obvious nearby openable
door/gate, and walks short probe steps around the current position. This is enough
to handle many "range is nearby but not currently usable/visible" starts without
turning the experiment into an unbounded wander.

Every episode trace records `pddlArtifacts` with initial/final domain and problem
PDDL embedded directly in the trace JSON. The initial problem captures the start
facts for that trial; the final problem captures the observed end-state facts
against the same goal. Traces also include `domainArtifacts.initialDomainModel`
and `domainArtifacts.finalDomainModel`, so you can inspect the learned JSON
domain before and after environment feedback, agentic replans, and refinement.

### Creating More Tasks

The task harness has two layers:

1. A `TaskSpec` JSON file that describes the start checkpoint, minimal goal, and
   executable verifiers.
2. An executor in `experiments/run-episode.ts` that knows how to turn a planned
   `actionSchemaId` into SDK calls.

The JSON/checkpoint side can be created now for any task. Fully automated
execution currently has one implemented action executor:
`use_item_on_cooking_source`. For new tasks like fishing, chopping, or lighting a
fire, add an executor case before treating those tasks as proposal-faithful
automated trials.

Recommended workflow:

1. Manually or synthetically create a stable start state.

```powershell
# Live checkpoint from the currently logged-in browser bot.
bun experiments/save-checkpoint.ts McPlan --api http://localhost:8888 --out runs/checkpoints/McPlan-fish-shrimp-lumbridge.sav

# Or generate a synthetic checkpoint from a preset/config.
bun experiments/create-save.ts McPlan --preset WOODCUTTER_AT_LUMBRIDGE --out runs/checkpoints/McPlan-chop-tree-lumbridge.sav
bun experiments/create-save.ts McPlan --config experiments/save-configs/cook-shrimp-alkharid.json --out runs/checkpoints/McPlan-cook-shrimp-alkharid.sav
```

2. Create a task preset under `experiments/task-presets/`.

Example `fish-shrimp-lumbridge.json`:

```json
{
  "id": "fish_shrimp_lumbridge",
  "description": "Catch one raw shrimp from a checkpoint near a net fishing spot.",
  "maxSteps": 8,
  "startState": {
    "checkpointPath": "runs/checkpoints/McPlan-fish-shrimp-lumbridge.sav",
    "checkpointProfile": "experiments"
  },
  "goalState": {
    "description": "Inventory gains Raw shrimps and Fishing XP increases.",
    "inventoryGained": { "Raw shrimps": 1 },
    "xpGained": { "Fishing": 1 }
  },
  "success": [
    { "kind": "inventory_gained", "item": "^Raw shrimps$", "count": 1 },
    { "kind": "xp_gained", "skill": "Fishing", "minXp": 1 }
  ]
}
```

Example `chop-tree-lumbridge.json`:

```json
{
  "id": "chop_tree_lumbridge",
  "description": "Chop one log from a checkpoint near Lumbridge trees.",
  "maxSteps": 8,
  "startState": {
    "checkpointPath": "runs/checkpoints/McPlan-chop-tree-lumbridge.sav",
    "checkpointProfile": "experiments"
  },
  "goalState": {
    "description": "Inventory gains Logs and Woodcutting XP increases.",
    "inventoryGained": { "Logs": 1 },
    "xpGained": { "Woodcutting": 1 }
  },
  "success": [
    { "kind": "inventory_gained", "item": "^Logs$", "count": 1 },
    { "kind": "xp_gained", "skill": "Woodcutting", "minXp": 1 }
  ]
}
```

Example `chop-and-light-fire-lumbridge.json`:

```json
{
  "id": "chop_and_light_fire_lumbridge",
  "description": "Chop logs and light a fire from a checkpoint near Lumbridge trees.",
  "maxSteps": 12,
  "startState": {
    "checkpointPath": "runs/checkpoints/McPlan-chop-tree-lumbridge.sav",
    "checkpointProfile": "experiments"
  },
  "goalState": {
    "description": "Woodcutting and Firemaking XP both increase.",
    "xpGained": { "Woodcutting": 1, "Firemaking": 1 }
  },
  "success": [
    { "kind": "xp_gained", "skill": "Woodcutting", "minXp": 1 },
    { "kind": "xp_gained", "skill": "Firemaking", "minXp": 1 }
  ]
}
```

3. Add execution support for the task's action schema IDs.

Edit `experiments/run-episode.ts` so `executeStep()` recognizes the new
`actionSchemaId` values. The SDK action mapping will probably be:

- `fish_shrimp`: find a nearby fishing spot and call `bot.interactNpc(spot, 'net')`.
- `chop_tree`: find a nearby tree and call `bot.chopTree(tree)`.
- `light_fire`: find logs in inventory and call `bot.burnLogs(logs)`.

Also update `ACTION_DOCS` / default domains in `experiments/domain-model.ts` when
you want the LLM/PDDL layer to reason about the new actions instead of relying on
hand-scripted behavior.

4. Smoke test one episode, then batch it.

```powershell
bun experiments/load-save.ts McPlan runs/checkpoints/McPlan-fish-shrimp-lumbridge.sav --api http://localhost:8888
bun sdk/cli.ts McPlan --server localhost --timeout 45000 --launch
bun experiments/run-episode.ts experiments/task-presets/fish-shrimp-lumbridge.json --bot McPlan --method pddl --model gemma3:12b --server localhost --force-run --max-steps 8
```

```powershell
bun experiments/run-batch.ts experiments/task-presets/fish-shrimp-lumbridge.json --bot McPlan --runs 5 --methods few_shot,static_rag,pddl,learned_domain --models none,gemma3:12b --server localhost --api http://localhost:8888 --rag --checkpoint runs/checkpoints/McPlan-fish-shrimp-lumbridge.sav --settle-ms 8000 --ready-timeout 45000 --max-steps 8
```

After adding or changing the reload endpoint, restart `server/gateway` and make
sure `server/webclient` is running `bun run watch`, since the browser-side
gateway connection needs to understand the new `reload` message.

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
