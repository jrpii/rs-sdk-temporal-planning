# From Wiki to Domain Model: Learning Symbolic Planning Models for RuneScape Agents

James Price II  
CSE 476 Final Project, Type 1  
Spring 2026

> **Figure placeholder:** Add a one-page system diagram here: Wiki crawl/filter -> Graph RAG -> LLM domain extraction -> symbolic planner/PDDL export -> rs-sdk execution -> verifier/trace/KB -> domain refinement.

## Abstract

Large language models can describe plans fluently, but they often fail when their plans must be executed in a grounded, dynamic environment. This project studies a narrower and more useful role for LLMs: extracting and refining symbolic domain models from text and experience. I built an experimental harness on top of `rs-sdk`, a controllable 2004-era RuneScape environment, to test whether wiki-derived knowledge and environmental feedback can be converted into executable action schemas for planning. The resulting system includes a temporally filtered RuneScape wiki corpus, a graph-based retrieval layer, a learned-domain representation with PDDL export, checkpointed tasks, transition logging, persistent in-world memory, and an episode runner that executes plans through the game SDK.

The project is best viewed as a framework and vertical slice rather than a completed benchmark. The most successful demonstration is a shrimp-cooking agent that uses retrieved/world knowledge to find a cooking source, update its domain model with exploration and stochastic-cooking lessons, and execute a verified plan that produces cooked Shrimps and Cooking XP. Initial results show that persistent learned-domain runs can solve this task, while static controls often fail due to missing reachability and recovery knowledge. Mining experiments expose the current limitations: general executors, failure attribution, and domain refinement need more work before the framework supports a broad task suite.

## 1. Introduction

Classical planners are reliable when a correct symbolic domain model is available, but constructing that model by hand is expensive in large, open-ended environments. LLMs have the opposite profile: they have broad commonsense and textual knowledge, but their direct plans are brittle when grounded in a stateful simulator. This project explores a hybrid approach: use an LLM to extract and refine symbolic action schemas, then let a planner and verifier handle execution.

The test environment is a local 2004-style RuneScape server exposed through `rs-sdk`. RuneScape is a useful planning domain because tasks are symbolic enough to describe with items, skills, locations, NPCs, and actions, but dynamic enough to surface real execution problems such as reachability, stochastic outcomes, inventory constraints, and hidden UI state. The central research question is:

**Can an LLM learn an executable symbolic domain model from wiki text and environmental feedback, and can that model improve planning behavior over non-persistent RAG or hand/default symbolic controls?**

This report focuses on the framework built to answer that question. It addresses the main feedback from the proposal by specifying the domain representation, explaining how updates are triggered and validated, and separating model-learning gains from the confound of persistent feedback.

## 2. System Overview

The project extends `rs-sdk` into an agentic planning and learning playground. The core loop is:

1. A task JSON file defines a checkpoint, natural-language goal, maximum steps, optional exploration hints, and executable verifiers.
2. The Graph RAG layer retrieves relevant 2004-era RuneScape wiki facts.
3. An LLM converts the task, state snapshot, and retrieved context into a `LearnedDomainModel`.
4. The symbolic planner converts the current state and learned actions into plan steps.
5. `run-episode.ts` executes each step through `BotSDK`/`BotActions`, records before/after state summaries, and evaluates verifiers.
6. Failures can trigger discovery actions, LLM replanning, symbolic replanning, KB-assisted exploration, and domain-model updates.
7. Batch runs save traces, transition logs, learned domains, PDDL artifacts, CSV summaries, and persistent KB files.

The main implementation files are `experiments/run-episode.ts`, `experiments/run-batch.ts`, `experiments/domain-model.ts`, `experiments/extract-domain.ts`, `experiments/refine-domain.ts`, `experiments/pddl.ts`, `experiments/knowledge-base.ts`, and `experiments/transition-log.ts`.

> **Figure placeholder:** Add a screenshot or diagram of one episode trace showing state -> plan -> execute -> verifier -> learned lesson.

## 3. Domain Model Representation

The learned model is a JSON representation of symbolic action schemas, with optional PDDL export for inspection or future external planners. Each model contains:

- `id`, `taskId`, `description`, `notes`, and provenance.
- A list of `actions`, where each action has an executable `id`, parameters, preconditions, effects, negative evidence, and confidence/provenance metadata.
- A list of cross-episode `lessons` inferred from environmental traces.

Preconditions and effects use a constrained vocabulary rather than arbitrary LLM text. Examples include `has_item`, `skill_at_least`, `near_loc`, `reachable`, `inventory_space`, `item_added`, `item_removed`, `xp_gained`, `position_changed`, and `message_observed`. The sanitizer in `experiments/domain-model.ts` filters invalid action IDs and predicate/effect kinds before planning. This keeps the LLM from inventing schemas that cannot be executed.

For the shrimp-cooking task, the learned domain converged on actions such as:

- `explore_for_cooking_source`, which establishes `near_loc(Range|Fire)` and `reachable(Range|Fire)`.
- `use_item_on_cooking_source`, which requires `has_item(Raw shrimps)` and a nearby cooking source, removes Raw shrimps, and may add Shrimps plus Cooking XP.
- `open_nearby_door`, a recovery action for reachability failures.

The model also records stochastic evidence. Cooking at low level can produce `Burnt fish` instead of `Shrimps`, so a failed cooking attempt is not always an invalid domain action. This distinction became important for interpreting traces correctly.

## 4. Wiki Data and Graph RAG

The data pipeline starts from the Old School RuneScape wiki and filters it toward a 2004 preservation cutoff. The strict temporal snapshot retains pages with known release dates before `2004-09-07`; a fallback snapshot includes pages with unknown release dates for recall. The documented strict dataset reads 35,003 structured pages and retains 3,915 pages; the fallback retains 11,053 pages. The strict graph contains 4,876 nodes and 72,898 edges, while the fallback graph contains 12,818 nodes and 165,793 edges.

> **Table placeholder:** Add "Wiki Dataset Statistics" from `RS_SDK_HARNESS_AUDIT.md`: strict/fallback retained pages, nodes, edges, and major page types.

The Graph RAG layer is implemented in `agents/cse476-final-project/src/osrs_graph_rag.py` and called through `agents/cse476-final-project/osrs_agent.py`. Despite the name, this is not dense vector retrieval. It is a structured lexical retriever over wiki fields plus one-hop graph expansion over typed relations. It returns formatted context sections such as direct matches, hard planning facts, graph neighbors, and traversed edges. This context is injected into LLM prompts for domain extraction and optional agentic replanning.

This design gives the LLM task-specific textual evidence while keeping the actual planner symbolic. The planner does not consume raw wiki text directly; it consumes the extracted domain model. That separation is intentional because it makes the learned representation inspectable and exportable.

## 5. Execution, Verification, and Learning

The environment exposes rich state through `BotSDK.getState()`, including player position, skills, inventory, equipment, nearby NPCs, nearby locations, ground items, dialogs, shops, banks, combat events, and recent messages. The experiment layer compresses this into `StateSummary` and `StateDelta` objects. Each executed step records before/after summaries, the action result, observed world objects, verifier progress, and cumulative deltas from the episode start.

Task success is determined by explicit verifiers rather than by trusting the planner. For example, `cook_shrimp_alkharid` succeeds only if inventory gains `Shrimps` and Cooking XP increases. `mine_iron_varrock` similarly requires an Iron ore gain and Mining XP gain.

The update step is more concrete than the original proposal. The system distinguishes several sources of feedback:

- **Verifier success:** reinforces that the current action sequence achieved the intended task-level effects.
- **Action failure message:** records negative evidence and can trigger recovery, such as opening a door or exploring.
- **State delta:** checks whether claimed effects actually occurred, such as item gain, item loss, XP gain, or position change.
- **Cumulative episode delta:** avoids missing task success when the final state alone is ambiguous.
- **Recent game messages:** help distinguish stochastic or environmental outcomes from impossible actions.

An agentic wiki query is triggered during replanning when an execution step fails and `--replan-rag` is enabled. The query includes the task, failed action, failure message, and requested recovery facts. Otherwise, the episode relies on the existing domain model and the persistent in-world KB.

The most important limitation is failure attribution. The environment gives state transitions and messages, not explicit labels saying "bad precondition" or "bad sequence." The implementation therefore uses conservative heuristics. If an action fails before any relevant state delta, the framework treats it as possible missing precondition, reachability problem, or executor limitation. If an action consumes an item and produces a burned result, it is treated as stochastic evidence rather than an invalid action. This avoids some false updates, but it is not a complete causal learner.

## 6. Experimental Setup

The evaluation harness supports controlled checkpoint starts through generated `.sav` files and live checkpoint loading. This is important because each method should begin from the same position, inventory, skills, and progression variables.

Two task presets are currently implemented:

| Task | Goal | Checkpoint | Verifier |
|---|---|---|---|
| `cook_shrimp_alkharid` | Cook one raw shrimp near Al Kharid | `runs/checkpoints/McPlan-cook-shrimp-alkharid.sav` | Gain `Shrimps` and Cooking XP |
| `mine_iron_varrock` | Mine one iron ore from a Varrock mine checkpoint | `runs/checkpoints/McPlan-mine-iron-1.sav` | Gain Iron ore and Mining XP |

The implemented method labels are:

- **PDDL/default symbolic:** uses the symbolic forward planner and default/hand domain artifacts. PDDL is exported, but the current runner uses an in-process planner rather than an external PDDL solver.
- **Static RAG:** uses Graph RAG to extract a domain model, then executes without persistent learned updates across episodes.
- **Learned domain:** uses Graph RAG + LLM domain extraction, in-episode replanning/exploration, persistent KB, trace logging, and optional cross-episode domain refinement.

One important caveat is that this comparison is not yet a clean isolation of "symbolic model" versus "memory." The learned-domain condition has persistent feedback and KB support, while static baselines are mostly non-persistent. This is a deliberate design choice for the framework, but it means observed gains should be interpreted as the value of the full learned-domain loop, not solely the representation. A future ablation should add persistent feedback to RAG without symbolic schema updates.

## 7. Results

The current result artifacts are exploratory but informative. The shrimp-cooking vertical slice reached verified success in repeated learned-domain runs. In one successful trace, the agent:

1. Executed `explore_for_cooking_source`.
2. Used the KB to target a known Range at `(3318, 3138)`.
3. Arrived near the cooking source.
4. Used Raw shrimps on the Range.
5. Produced `Shrimps` and gained `+30` Cooking XP.

The trace `runs/traces/2026-05-07T04-49-09-620Z-learned_domain-cook_shrimp_alkharid.json` records `success: true`, `invalidActionCount: 0`, `replanningCount: 0`, and verifier success. Earlier learned-domain traces show the agent failing to find a cooking source, querying Graph RAG for recovery context, adding a lesson about exploration, symbolically replanning, and then completing the task.

> **Table placeholder:** Replace or expand this table after selecting the final run set. These rows summarize selected exploratory artifacts, not a statistically powered final benchmark.

| Task | Method | Runs | Successes | Success Rate | Avg Duration | Avg Invalid Actions | Notes |
|---|---|---:|---:|---:|---:|---:|---|
| Cook shrimp | Learned domain + Graph RAG + KB | 2 | 2 | 100% | 38.3s | 0.0 | Later clean run set with KB/task memory |
| Cook shrimp | Learned domain + Graph RAG | 5 | 4 | 80% | 77.5s | 0.8 | Earlier run set with one failed process/run |
| Cook shrimp | Static RAG | 2 | 0 | 0% | 27.6s | 1.0 | Extracted domain but no successful recovery |
| Cook shrimp | PDDL/default symbolic | 3 | 0 | 0% | 27.0s | 1.0 | Recent default-domain control failed |
| Mine iron | Learned domain + Graph RAG | 2 | 0 | 0% | 1.0s | 1.0 | Domain extraction exists, executor/task grounding incomplete |

The strongest positive result is not that the system has solved RuneScape broadly, but that the framework can close the loop for a real dynamic task: retrieve text, form an executable schema, execute through the SDK, learn that exploration/reachability matters, remember useful world coordinates, and verify success through game state changes.

The mining failures are equally useful. The learned domains correctly mention pickaxe and Mining-level requirements, and the KB records many rock IDs and positions, but the current generic mining executor and failure attribution are not robust enough to complete the task. This shows that wiki knowledge alone is insufficient; the action adapter and verifier-grounded transition interpretation must be extended for each new mechanic family.

## 8. Contributions

This project contributes:

- A reproducible local experiment harness for `rs-sdk`, including engine settings, browser bot workflow, SDK gateway, checkpoint save/load, and batch execution.
- A 2004-filtered RuneScape wiki data pipeline with strict/fallback temporal slices and graph artifacts.
- A Graph RAG bridge that supplies task-specific wiki facts to local LLM prompts.
- A typed learned-domain representation with sanitization, confidence/provenance metadata, negative evidence, lessons, and PDDL export.
- A symbolic forward planner that consumes learned action schemas and summarized world state.
- An episode runner that executes plan steps through `BotSDK`/`BotActions`, records state transitions, checks verifiers, and supports discovery/replanning.
- A persistent in-world KB that remembers observed locations/NPCs/options and helps exploration target known facilities.
- A shrimp-cooking vertical slice demonstrating a verified, KB-assisted, learned-domain plan in the live environment.

These pieces turn the original proposal into a concrete framework for learning symbolic models from text and interaction. The main value is the instrumentation: every episode produces traces and transition rows that can be audited, replayed, and used for future domain refinement.

## 9. Limitations

The system is still a framework that needs extension before it can support a broad benchmark.

First, execution support is uneven. Shrimp cooking has a strong vertical slice with a specialized `use_item_on_cooking_source` executor. Mining and other tasks depend on more generic actions such as `interact_loc`, which need better waiting logic, target grounding, and state-delta interpretation.

Second, the symbolic planner is simplified. It uses forward search over facts and limited add/delete semantics. PDDL export exists, but the current experiments do not yet call an external PDDL planner.

Third, failure attribution remains approximate. State transitions can show that a goal was not achieved, but they do not directly identify whether the cause was a wrong precondition, missing effect, bad sequence, unavailable target, stochastic outcome, or executor bug.

Fourth, the comparison between methods is confounded by persistence. Learned-domain runs receive persistent KB/domain updates, while static RAG and default symbolic controls do not. This matches the project goal of building a learning loop, but it means the reported gains should be framed as preliminary system-level evidence.

Fifth, Graph RAG is lexical plus graph expansion, not vector retrieval. This makes it inspectable and lightweight, but recall depends on page structure, aliases, and temporal filtering quality. The strict 2004 dataset avoids modern leakage at the cost of dropping pages with unknown release dates.

## 10. Future Work

The next step is to turn the framework into a cleaner benchmark. The most important ablations are:

- Static RAG with persistent memory but no symbolic domain refinement.
- Learned domain without KB-assisted exploration.
- Learned domain with no in-episode LLM replanning.
- External PDDL planner versus the current in-process symbolic planner.

The action layer should be generalized beyond shrimp. A reusable family of executors for gather/process tasks could cover mining ore, smelting bars, fishing, cooking other food, chopping trees, fletching, and simple banking. Each executor should have explicit success/failure categories so the domain learner can distinguish missing preconditions from bad sequencing.

The Graph RAG layer can also improve. Future versions should combine the current graph retriever with embeddings, use the LostHQ 2004 data as stronger emulator-grounded truth, and attach retrieved facts directly to preconditions/effects with stable provenance IDs.

Finally, the system should expand from single-step tasks to short multi-step chains such as obtain raw food then cook it, mine ore then smelt it, or gather materials then craft an item. Those tasks would better test whether learned symbolic models improve planning over direct LLM plan generation.

## 11. Conclusion

The final system demonstrates that LLMs can be useful planning components when constrained to a symbolic, executable representation and paired with environmental verification. The project does not yet prove broad superiority over all baselines, but it does deliver a working research harness and a successful vertical slice. The shrimp-cooking bot is a small but meaningful milestone: it finds a range, learns that exploration and reachability belong in the domain model, handles stochastic cooking evidence, and verifies success through inventory and XP changes. With broader executors and cleaner ablations, this framework can support systematic experiments on learning domain models from text and interaction in dynamic games.

## References

[1] Shunyu Yao et al. *ReAct: Synergizing Reasoning and Acting in Language Models*. 2023.  
[2] Guanzhi Wang et al. *Voyager: An Open-Ended Embodied Agent with Large Language Models*. 2023.  
[3] Subbarao Kambhampati et al. *LLMs Can't Plan, But Can Help Planning in LLM-Modulo Frameworks*. 2023.  
[4] Linxi Fan et al. *MineDojo: Building Open-Ended Embodied Agents with Internet-Scale Knowledge*. 2022/2023.  
[5] Max Bittker. `rs-sdk`. https://github.com/MaxBittker/rs-sdk  
[6] RuneScape 2004 Wiki / LostHQ. https://2004.losthq.rs/  
[7] Old School RuneScape Wiki. https://oldschool.runescape.wiki/

---

# Appendix

The appendix can exceed the 8-page main-content limit. Keep the main report concise and move detailed tables, command logs, schemas, and trace excerpts here.

## Appendix A. Reproduction Commands

```powershell
bun install
bun tools/osrs-wiki-filter-temporal.ts --out data/wiki/osrs-wiki-structured-2004.jsonl --stats-out data/wiki/osrs-wiki-structured-2004-stats.json
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured-2004.jsonl --out-dir data/wiki/graph-2004 --max-page-links 25 --page-rank-iterations 25 --no-missing-pages

cd server/engine
bun install
bun --env-file=.env.experiment run src/app.ts

cd server/webclient
bun install
bun run watch

cd server/gateway
bun install
bun run gateway
```

## Appendix B. Important Artifacts

| Artifact | Purpose |
|---|---|
| `experiments/task-presets/cook-shrimp-alkharid.json` | Shrimp task spec and verifiers |
| `experiments/task-presets/mine-iron-alkharid.json` | Mining task spec and verifiers |
| `runs/batch/*.json` and `*.csv` | Batch metrics |
| `runs/traces/*.json` | Full episode traces |
| `runs/domain-models/*.json` | Extracted/refined learned domains |
| `runs/domain-models/*.domain.pddl` | PDDL domain export |
| `runs/domain-models/*.problem.pddl` | PDDL problem export |
| `runs/kb/global.json` | Persistent observed loc/NPC memory |
| `runs/transitions/global.jsonl` | Step-level transition log |

## Appendix C. Suggested Figures and Tables

- Figure 1: End-to-end architecture.
- Figure 2: Example Graph RAG retrieval context for cooking shrimp.
- Figure 3: Successful shrimp trace timeline.
- Figure 4: Learned domain before/after refinement.
- Table 1: Wiki strict/fallback dataset and graph statistics.
- Table 2: Task specs and verifiers.
- Table 3: Batch result summary.
- Table 4: Current limitations mapped to future work.

## Appendix D. Trace Excerpt to Include

Use the successful learned-domain shrimp trace:

```text
Action: Explore for a cooking source
Result: Exploration used KB target Range at (3318, 3138): Arrived

Action: Use raw shrimps on cooking source
Result: Cooking attempt produced Shrimps (+30 Cooking XP)

Verifier: inventory gained Shrimps 1/1; Cooking XP gained 30
```

