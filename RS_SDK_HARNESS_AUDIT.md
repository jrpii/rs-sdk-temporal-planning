# RS-SDK Harness Audit for Domain-Model Learning

This audit summarizes the parts of `rs-sdk-temporal-planning` that matter for the proposal: extracting a symbolic domain model from wiki text, executing plans in a dynamic RuneScape-like environment, and refining that model from verifier feedback.

## Temporal Wiki Dataset Snapshot (2004 preservation cutoff)

The temporal filters live in `tools/osrs-wiki-filter-temporal.ts`. The default cutoff is **`2004-09-07`**, aligned with the preservation-style “revision 254” snapshot (September 7, 2004). Use `--cutoff YYYY-MM-DD` for other eras (for example `2004-12-31` for all of calendar 2004, or `2007-12-31` to reproduce the older 2007 slice).

Strict command:

```powershell
bun "tools/osrs-wiki-filter-temporal.ts" --out "data/wiki/osrs-wiki-structured-2004.jsonl" --stats-out "data/wiki/osrs-wiki-structured-2004-stats.json"
```

Fallback command:

```powershell
bun "tools/osrs-wiki-filter-temporal.ts" --include-unknown-added --out "data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl" --stats-out "data/wiki/osrs-wiki-structured-2004-plus-unknown-stats.json"
```

Policy:

- Keep records with a known `dateAdded` or release/content year on or before the cutoff (`2004-09-07` by default).
- Exclude records removed on or before the cutoff.
- Exclude unknown release dates by default to avoid silently leaking modern content.
- Optional override: `--include-unknown-added`. This creates a recall-oriented fallback set for cases where strict retrieval has little or no useful context.

Strict result (regenerated 2026-05-03):

| Metric | Count |
|---|---:|
| Structured pages read | 35,003 |
| Pages retained | 3,915 |
| Excluded after cutoff | 23,900 |
| Excluded unknown date | 7,138 |
| Excluded removed by cutoff | 50 |

Fallback result:

| Metric | Count |
|---|---:|
| Structured pages read | 35,003 |
| Pages retained | 11,053 |
| Excluded after cutoff | 23,900 |
| Excluded removed by cutoff | 50 |
| Extra pages vs strict | 7,138 |

Retained page types (strict):

| Type | Count |
|---|---:|
| item | 1,615 |
| scenery | 657 |
| npc | 547 |
| music | 243 |
| monster | 263 |
| location | 292 |
| shop | 112 |
| quest | 59 |
| spell | 51 |
| article | 32 |
| skill | 19 |
| prayer | 20 |
| minigame | 4 |
| guide | 1 |

Strict graph command:

```powershell
bun "tools/osrs-wiki-graph.ts" --input "data/wiki/osrs-wiki-structured-2004.jsonl" --out-dir "data/wiki/graph-2004" --max-page-links 25 --page-rank-iterations 25 --no-missing-pages
```

Fallback graph command:

```powershell
bun "tools/osrs-wiki-graph.ts" --input "data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl" --out-dir "data/wiki/graph-2004-plus-unknown" --max-page-links 25 --page-rank-iterations 25 --no-missing-pages
```

Strict graph result:

| Metric | Count |
|---|---:|
| Page records | 3,915 |
| Nodes | 4,876 |
| Edges | 72,898 |
| Parse errors | 0 |

Fallback graph result:

| Metric | Count |
|---|---:|
| Page records | 11,053 |
| Nodes | 12,818 |
| Edges | 165,793 |
| Parse errors | 0 |

The `--no-missing-pages` flag is important. It prevents modern linked pages from reappearing as `page_ref` placeholders in the temporal graph.

Recommended retrieval policy:

1. Query the strict 2004-cutoff dataset first.
2. If strict retrieval returns too few direct matches, low-scoring matches, or lacks structured facts, query the fallback `2004-plus-unknown` dataset.
3. Mark fallback-sourced facts with weaker provenance because the page may be valid old content with missing metadata, or modern content without a reliable release date.

Output artifacts:

- `data/wiki/osrs-wiki-structured-2004.jsonl`
- `data/wiki/osrs-wiki-structured-2004-stats.json`
- `data/wiki/graph-2004/nodes.jsonl`
- `data/wiki/graph-2004/edges.jsonl`
- `data/wiki/graph-2004/gephi-nodes.csv`
- `data/wiki/graph-2004/gephi-edges.csv`
- `data/wiki/graph-2004/stats.json`
- `data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl`
- `data/wiki/osrs-wiki-structured-2004-plus-unknown-stats.json`
- `data/wiki/graph-2004-plus-unknown/nodes.jsonl`
- `data/wiki/graph-2004-plus-unknown/edges.jsonl`
- `data/wiki/graph-2004-plus-unknown/gephi-nodes.csv`
- `data/wiki/graph-2004-plus-unknown/gephi-edges.csv`
- `data/wiki/graph-2004-plus-unknown/stats.json`

## Harness Architecture

The harness has three useful layers.

| Layer | Main files | Role |
|---|---|---|
| Low-level SDK | `sdk/index.ts`, `sdk/types.ts` | WebSocket client, world state, primitive action protocol. |
| Porcelain actions | `sdk/actions.ts`, `sdk/actions-helpers.ts`, `sdk/pathfinding.ts` | Domain-aware methods that wait for effects. |
| Execution wrappers | `sdk/runner.ts`, `sdk/cli.ts`, `mcp/server.ts` | Script execution, state snapshots, MCP code execution. |

Important semantic distinction:

- `sdk.send*` methods resolve when the server acknowledges the action.
- `bot.*` methods resolve when the expected game effect is observed.

For learning executable action schemas, prefer `bot.*` or explicit postcondition checks. A successful low-level ACK is not enough evidence that the intended effect happened.

## World State Schema

Source: `sdk/types.ts`.

Condensed schema:

```typescript
interface BotWorldState {
  tick: number;
  inGame: boolean;
  player: PlayerState | null;
  skills: SkillState[];
  inventory: InventoryItem[];
  equipment: InventoryItem[];
  nearbyNpcs: NearbyNpc[];
  nearbyPlayers: NearbyPlayer[];
  nearbyLocs: NearbyLoc[];
  groundItems: GroundItem[];
  gameMessages: GameMessage[];
  recentDialogs: DialogEntry[];
  dialog: DialogState;
  interface: InterfaceState;
  shop: ShopState;
  bank: BankState;
  modalOpen: boolean;
  modalInterface: number;
  combatStyle?: CombatStyleState;
  combatEvents: CombatEvent[];
  prayers: PrayerState;
}
```

Verification signals:

| Signal | Use |
|---|---|
| `player.worldX`, `player.worldZ`, `player.level` | Location, navigation success, reachability. |
| `skills[].experience`, `skills[].level` | XP and level-up effects. |
| `inventory`, `equipment`, `bank.items` | Item preconditions and item effects. |
| `nearbyNpcs`, `nearbyLocs`, `groundItems` | Local affordances and action targets. |
| `dialog`, `interface`, `shop`, `bank`, `modalOpen` | Blocking UI and interaction state. |
| `gameMessages` | Failure reasons and hidden precondition evidence. |
| `combatEvents`, `player.combat` | Combat effects and safety feedback. |
| `tick` | Temporal ordering for before/after deltas. |

Important caveats:

- `nearbyNpcs`, `nearbyLocs`, and `groundItems` are local, not global.
- `player.x`/`player.z` are region-relative; `player.worldX`/`player.worldZ` are better for planner predicates.
- `showChat` is off by default, so public chat messages are filtered unless `SHOW_CHAT=true`.
- CLI snapshots can be stale; `sdk.getStateAge()` detects this.

## Low-Level Action Protocol

Source: `sdk/types.ts`, `sdk/index.ts`.

Condensed action union:

```typescript
type BotAction =
  | { type: 'wait'; ticks?: number; reason: string }
  | { type: 'walkTo'; x: number; z: number; running?: boolean; reason: string }
  | { type: 'interactNpc'; npcIndex: number; optionIndex: number; reason: string }
  | { type: 'interactLoc'; x: number; z: number; locId: number; optionIndex: number; reason: string }
  | { type: 'pickupItem'; x: number; z: number; itemId: number; reason: string }
  | { type: 'useInventoryItem'; slot: number; optionIndex: number; reason: string }
  | { type: 'useItemOnItem'; sourceSlot: number; targetSlot: number; reason: string }
  | { type: 'useItemOnLoc'; itemSlot: number; x: number; z: number; locId: number; reason: string }
  | { type: 'useItemOnNpc'; itemSlot: number; npcIndex: number; reason: string }
  | { type: 'clickDialogOption'; optionIndex: number; reason: string }
  | { type: 'clickComponent'; componentId: number; reason: string }
  | { type: 'clickComponentWithOption'; componentId: number; optionIndex: number; slot?: number; reason: string }
  | { type: 'shopBuy' | 'shopSell'; slot: number; amount: number; reason: string }
  | { type: 'bankDeposit' | 'bankWithdraw'; slot: number; amount: number; reason: string }
  | { type: 'spellOnNpc'; npcIndex: number; spellComponent: number; reason: string }
  | { type: 'spellOnItem'; slot: number; spellComponent: number; reason: string }
  | { type: 'togglePrayer'; prayerIndex: number; reason: string }
  | { type: 'scanNearbyLocs' | 'scanGroundItems'; radius?: number; reason: string };
```

Action result:

```typescript
interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
}
```

The `data` field is used by scan actions. Richer failure categories are available on high-level result types such as `OpenBankResult`, `PickupResult`, `SmithResult`, `CraftJewelryResult`, and `PickpocketResult`.

## High-Level Action Surface

Source: `sdk/actions.ts`.

Main porcelain methods:

| Category | Methods |
|---|---|
| UI/dialog | `skipTutorial`, `dismissBlockingUI`, `navigateDialog` |
| Navigation | `walkTo`, `openDoor` |
| Generic interaction | `interactNpc`, `interactLoc`, `useItemOnLoc`, `useItemOnNpc`, `pickupItem` |
| Gathering/processing | `chopTree`, `burnLogs`, `fletchLogs`, `craftLeather`, `smithAtAnvil`, `craftJewelry`, `enchantItem`, `stringAmulet` |
| Banking/shop | `openBank`, `closeBank`, `depositItem`, `withdrawItem`, `openShop`, `buyFromShop`, `sellToShop`, `closeShop` |
| Inventory/equipment | `equipItem`, `unequipItem`, `eatFood` |
| Combat/prayer/magic | `attackNpc`, `castSpellOnNpc`, `activatePrayer`, `deactivatePrayer`, `deactivateAllPrayers` |
| Wait helpers | `waitForSkillLevel`, `waitForInventoryItem`, `waitForDialogClose`, `waitForIdle` |

Completion signals used by these methods include inventory deltas, XP deltas, UI opening/closing, position changes, combat state, and game messages.

## Navigation and Pathing

Sources: `sdk/actions.ts`, `sdk/actions-helpers.ts`, `sdk/pathfinding.ts`.

Key behavior:

- `walkTo(x, z, tolerance)` uses pathfinding, not a single blind click.
- It opens doors/gates along the path when possible.
- It blocks doors that appear locked or repeatedly fail, then replans.
- It has fallback logic for nearby blocking doors when movement stalls.
- `scanNearbyLocs(radius)` and `scanGroundItems(radius)` extend perception for some tasks.

Risks:

- Pathfinding collision is process-global; `blockDoor` changes future path planning in the same process.
- Some path failures are environmental, not domain-model errors.
- Long-distance navigation may need intermediate waypoints if destination collision data is not loaded.

## Existing Execution and Monitoring Tools

### `sdk/cli.ts`

One-shot world-state dump:

```powershell
bun sdk/cli.ts <botname>
bun --env-file=bots/<name>/bot.env sdk/cli.ts
```

It uses `formatWorldState` from `sdk/formatter.ts` and is best for pre/post snapshots.

### `sdk/runner.ts`

Script wrapper used by bot scripts.

Important result schema:

```typescript
interface RunResult {
  success: boolean;
  result?: unknown;
  error?: Error;
  duration: number;
  logs: LogEntry[];
  finalState: BotWorldState | null;
}
```

This is the best starting point for an experiment episode runner.

### MCP Server

Source: `mcp/server.ts`.

Tools:

- `execute_code(bot_name, code, timeout?)`
- `list_bots()`
- `disconnect_bot(name)`

`execute_code` auto-connects to `bots/{name}/bot.env`, runs async TypeScript with `bot` and `sdk` in scope, captures console logs, and returns formatted world state. This is the easiest bridge for an LLM agent loop, but it currently returns mostly text; structured output should be added for evaluation.

### Bot Creation

Source: `bots/create-bot.ts`.

Commands:

```powershell
bun bots/create-bot.ts MyBot --local
bun bots/create-bot.ts MyBot --server=rs-sdk-demo.fly.dev
bun bots/create-bot.ts
```

Only `bots/_template/bot.env` exists right now. No live bot was configured during this audit.

## Useful Run Commands

State snapshot:

```powershell
bun sdk/cli.ts <botname>
```

Run a bot script:

```powershell
bun bots/<botname>/script.ts
```

Run with explicit env:

```powershell
bun --env-file=bots/<botname>/bot.env bots/<botname>/script.ts
```

Create a local bot:

```powershell
bun bots/create-bot.ts MyBot --local
```

Create a remote/default bot:

```powershell
bun bots/create-bot.ts MyBot
```

Graph RAG against the 2004-cutoff dataset:

```powershell
cd agents/cse476-final-project
python osrs_agent.py --structured ../../data/wiki/osrs-wiki-structured-2004.jsonl --graph-dir ../../data/wiki/graph-2004 --question "Build a small domain model for crafting a ruby ring."
```

Retrieval-only inspection:

```powershell
python osrs_agent.py --structured ../../data/wiki/osrs-wiki-structured-2004.jsonl --graph-dir ../../data/wiki/graph-2004 --question "What facts support cooking shrimp?" --no-llm --show-context
```

Fallback retrieval inspection:

```powershell
python osrs_agent.py --structured ../../data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --graph-dir ../../data/wiki/graph-2004-plus-unknown --question "What facts support this sparse task?" --no-llm --show-context
```

## Experimental Setup and Checkpointing

The project does not require every experiment to start from a naturally progressed clean account. For local experiments, the existing test harness can generate deterministic save files with controlled state before launching the bot.

Primary files:

- `sdk/test/utils/save-generator.ts`
- `sdk/test/utils/test-runner.ts`
- `sdk/test/utils/browser.ts`
- `server/engine/src/engine/entity/PlayerLoading.ts`
- `server/engine/src/util/Environment.ts`

### What Can Be Controlled

`SaveConfig` supports:

```typescript
interface SaveConfig {
  position?: { x: number; z: number; level?: number };
  skills?: Record<string, number>;
  inventory?: Array<{ id: number; count: number }>;
  equipment?: Array<{ id: number; count: number; slot: number }>;
  bank?: Array<{ id: number; count: number }>;
  coins?: number;
  varps?: Record<number, number>;
  appearance?: {
    body?: number[];
    colors?: number[];
    gender?: number;
  };
}
```

This is enough to checkpoint most short and medium-horizon evaluation tasks:

- Spawn at a fixed coordinate and plane.
- Set skill levels.
- Seed inventory tools, materials, food, coins, runes, and weapons.
- Seed equipment.
- Seed bank contents.
- Set quest/tutorial/progression variables through varps.
- Use preset starts such as Lumbridge, Varrock mine, Al Kharid mine/furnace, fishing spots, banks, and agility areas.

The generator writes `.sav` files into the local engine player folder:

```text
server/engine/data/players/<profile>/<username>.sav
```

or, if running from a different layout:

```text
engine/data/players/<profile>/<username>.sav
```

The profile defaults to `main`. The engine also has `NODE_PROFILE` in `server/engine/src/util/Environment.ts`, so separate experiment profiles can isolate save folders if the local server is launched with a different profile.

### How Tests Use Checkpointed State

`runTest` in `sdk/test/utils/test-runner.ts` can accept either a preset or custom `saveConfig`; it generates the save, launches the browser/SDK session, runs the test, and cleans up.

Minimal pattern:

```typescript
import { runTest } from './utils/test-runner';
import { Items, Locations } from './utils/save-generator';

runTest({
  name: 'Cook Shrimp Checkpoint',
  saveConfig: {
    position: Locations.ALKHARID_FISHING,
    skills: { Cooking: 1 },
    inventory: [
      { id: Items.RAW_SHRIMPS, count: 1 },
    ],
  },
  launchOptions: { skipTutorial: false },
}, async ({ sdk, bot }) => {
  const range = sdk.findNearbyLoc(/range|fire/i);
  if (!range) return false;
  const raw = sdk.findInventoryItem(/raw shrimps/i);
  if (!raw) return false;
  const result = await bot.useItemOnLoc(raw, range);
  return result.success && Boolean(sdk.findInventoryItem(/^shrimps$/i));
});
```

When using generated saves, pass `skipTutorial: false`; the generator sets varp `281 = 1000`, which marks tutorial complete.

### Clean State vs Checkpointed State

Use clean or persistent bot state when testing long-horizon autonomy, persistence, and cross-episode learning. Use generated checkpoint state when comparing models on specific mechanics or precondition/effect learning.

Recommended split:

| Experiment type | Start state |
|---|---|
| Atomic action schema learning | Generated save/checkpoint |
| Short task benchmark | Generated save/checkpoint |
| Medium task with setup burden | Generated save/checkpoint, then execute real setup steps in a subtask if needed |
| Persistent learning across episodes | Same named bot over repeated episodes, with saved traces |
| Final ecological validity demos | Fresh or persistent character, no artificial inventory/skill injection |

This means the proposal can report both controlled benchmark results and persistent-agent results. Controlled checkpoints make the few-shot/RAG/learned-domain comparison fair because each method starts from the same position, inventory, skills, bank, and varps.

### Caveats

- Save generation is a local-server/testing facility. It should not be treated as a normal in-game action and should not be used inside an episode plan.
- Save generation overwrites the named bot's local save file. Use unique bot names per run or copy/save artifacts if preserving a previous endpoint matters.
- The generated save format is partial by design: it covers position, stats, inventories, varps, appearance, run energy, playtime, and chat modes, but not every possible transient runtime state.
- The local engine saves players periodically and on logout; if a live bot remains connected, overwrite behavior can be confusing. Generate the save before login/launch, or disconnect the bot before replacing its save.
- Remote/demo servers should be considered persistent black-box accounts. Do not assume local save injection applies there.
- Quest state can be approximated through varps, but each quest's varp meanings must be verified from content scripts before using them as benchmark setup.

### Checkpointing Commands

Run an existing SDK test that uses save generation:

```powershell
bun sdk/test/anvil-smithing.ts
```

Create a small custom checkpoint script by importing `generateSave`:

```typescript
import { generateSave, Items, Locations } from './sdk/test/utils/save-generator';

await generateSave('exp001', {
  position: Locations.VARROCK_SE_MINE,
  skills: { Mining: 15 },
  inventory: [{ id: Items.BRONZE_PICKAXE, count: 1 }],
});
```

Then launch or inspect that bot against the local server:

```powershell
bun sdk/cli.ts exp001 --server localhost
```

## Proposed Learned Domain Model Schema

Use this JSON-like schema as an intermediate representation before emitting PDDL.

```typescript
interface LearnedActionSchema {
  id: string;
  name: string;
  parameters: Array<{
    name: string;
    type: 'item' | 'npc' | 'loc' | 'skill' | 'facility' | 'coordinate' | 'quantity';
  }>;
  preconditions: Array<{
    kind:
      | 'has_item'
      | 'skill_at_least'
      | 'near_loc'
      | 'near_npc'
      | 'bank_open'
      | 'shop_open'
      | 'dialog_state'
      | 'inventory_space'
      | 'not_in_combat'
      | 'reachable';
    args: Record<string, unknown>;
    provenance: Provenance[];
    confidence: number;
  }>;
  effects: Array<{
    kind:
      | 'item_added'
      | 'item_removed'
      | 'xp_gained'
      | 'level_changed'
      | 'position_changed'
      | 'dialog_opened'
      | 'interface_opened'
      | 'bank_changed'
      | 'combat_started'
      | 'message_observed';
    args: Record<string, unknown>;
    provenance: Provenance[];
    confidence: number;
  }>;
  negativeEvidence: Array<{
    observation: string;
    inferredMissingPrecondition?: string;
    stateBeforeHash: string;
    stateAfterHash: string;
  }>;
}

interface Provenance {
  source: 'wiki' | 'graph_edge' | 'llm' | 'environment';
  reference: string;
  observedAt?: string;
}
```

## Episode Trace Schema

This should be logged for every evaluation run.

```typescript
interface EpisodeTrace {
  episodeId: string;
  method: 'few_shot' | 'static_rag' | 'learned_domain';
  task: {
    id: string;
    description: string;
    successPredicate: string;
    maxSteps: number;
  };
  model: {
    provider: 'ollama' | 'api';
    name: string;
    temperature: number;
  };
  retrieval?: {
    structuredPath: string;
    graphDir: string;
    query: string;
    directMatches: string[];
    traversedEdges: string[];
  };
  plan: Array<{
    stepIndex: number;
    naturalLanguage: string;
    actionSchemaId?: string;
    code?: string;
  }>;
  execution: Array<{
    stepIndex: number;
    action: string;
    startedTick: number;
    endedTick: number;
    result: ActionResult;
    before: StateSummary;
    after: StateSummary;
    delta: StateDelta;
  }>;
  metrics: {
    success: boolean;
    timeToFirstCompletionMs?: number;
    totalDurationMs: number;
    invalidActionCount: number;
    replanningCount: number;
  };
}
```

## State Summary and Delta Schema

The full `BotWorldState` is large. For learning feedback, store both the full state artifact and a compact delta.

```typescript
interface StateSummary {
  tick: number;
  position?: { x: number; z: number; level: number };
  hp?: { current: number; max: number };
  skills: Record<string, { level: number; baseLevel: number; xp: number }>;
  inventory: Record<string, number>;
  equipment: string[];
  nearbyNpcs: Array<{ name: string; distance: number; options: string[] }>;
  nearbyLocs: Array<{ name: string; distance: number; options: string[] }>;
  groundItems: Array<{ name: string; count: number; distance: number }>;
  ui: {
    dialogOpen: boolean;
    interfaceOpen: boolean;
    shopOpen: boolean;
    bankOpen: boolean;
    modalOpen: boolean;
  };
  recentMessages: string[];
}

interface StateDelta {
  positionChanged?: boolean;
  inventoryAdded: Record<string, number>;
  inventoryRemoved: Record<string, number>;
  equipmentAdded: string[];
  equipmentRemoved: string[];
  xpGained: Record<string, number>;
  levelChanges: Record<string, { before: number; after: number }>;
  uiChanges: string[];
  newMessages: string[];
}
```

## Proposal-Aligned Experiment Plan

### Baseline 1: Few-Shot Planner

Inputs:

- Task description.
- Action API summary.
- Current world state.
- No wiki retrieval.
- No persistent learned model.

Expected weakness:

- Plausible but invalid actions.
- Missing object/tool/facility preconditions.
- Poor recovery from game-specific failures.

### Baseline 2: Static RAG Planner

Inputs:

- Task description.
- Current world state.
- Retrieved 2004-cutoff wiki context.
- No persistent updates across episodes.

Expected strength:

- Better precondition and recipe knowledge than few-shot.

Expected weakness:

- Repeats the same wrong assumptions if retrieval or interpretation is wrong.
- Does not improve from failed execution across episodes.

### Proposed Method: Learned Domain Model

Inputs:

- Task description.
- Current world state.
- Retrieved 2004-cutoff wiki context.
- Persistent `LearnedActionSchema[]`.
- Episode traces from prior attempts.

Loop:

1. Retrieve wiki/graph facts.
2. Generate or update symbolic action schema.
3. Generate a bounded executable plan.
4. Execute with `sdk/runner.ts` or MCP `execute_code`.
5. Compute state delta and verifier result.
6. Update preconditions/effects/confidence from success/failure.

## Recommended Next Engineering Steps

1. Add a structured experiment runner around `sdk/runner.ts`.
   - Save full before/after `BotWorldState`.
   - Save compact `StateSummary` and `StateDelta`.
   - Save model, prompt, retrieval, generated code, and action results.

2. Add structured MCP output.
   - Keep the existing readable response.
   - Add machine-readable result/logs/state fields for automated evaluation.

3. Build a small task suite.
   - Walk to coordinate.
   - Talk to NPC.
   - Pick up item.
   - Chop tree.
   - Cook food.
   - Bank/deposit/withdraw.
   - Craft jewelry or leather item.
   - Mine/smelt/smith chain.

4. Implement verifier predicates.
   - Inventory contains item.
   - XP increased by skill.
   - Player reached coordinate tolerance.
   - Dialog/interface/bank/shop opened.
   - No invalid action messages after start tick.

5. Bridge Graph RAG to execution.
   - Use the 2004-cutoff dataset by default.
   - Generate domain schemas first, then executable code.
   - Do not let the LLM directly issue long opaque scripts for evaluation.

6. Decide unknown-date policy.
   - Strict mode is safer for leakage.
   - A second `2004-plus-unknown` dataset may be useful for recall if key general mechanics are missing.

## Known Issues and Risks

- Some wiki entries with unknown dates may be valid content for the target era but are excluded by strict filtering.
- Some modern OSRS pages may describe old content but have modern page metadata; manual validation or 2004 wiki reconciliation is still needed.
- `execute_code` uses dynamic code execution. For batch experiments, add time limits, code archival, and preferably a dry-run/typecheck stage.
- Failure credit assignment can be ambiguous when an action times out without a specific game message.
- World state is local and partially observable. A missing nearby entity is not proof the entity does not exist.
- Pathfinding failures can come from doors, loaded collision zones, or reachability rather than missing domain preconditions.
