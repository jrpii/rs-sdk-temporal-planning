import type { ActionResult, BotWorldState } from '../sdk/types';

export type PlannerMethod = 'few_shot' | 'static_rag' | 'learned_domain' | 'pddl';

export type ParameterType =
    | 'item'
    | 'npc'
    | 'loc'
    | 'skill'
    | 'facility'
    | 'coordinate'
    | 'quantity'
    | 'interface'
    | 'dialog';

export type PredicateKind =
    | 'has_item'
    | 'equipped_item'
    | 'skill_at_least'
    | 'near_loc'
    | 'near_npc'
    | 'at_position'
    | 'bank_open'
    | 'shop_open'
    | 'dialog_state'
    | 'interface_open'
    | 'inventory_space'
    | 'not_in_combat'
    | 'reachable'
    | 'varp_state';

export type EffectKind =
    | 'item_added'
    | 'item_removed'
    | 'item_equipped'
    | 'xp_gained'
    | 'level_changed'
    | 'near_loc'
    | 'position_changed'
    | 'dialog_opened'
    | 'dialog_closed'
    | 'interface_opened'
    | 'interface_closed'
    | 'bank_changed'
    | 'shop_changed'
    | 'combat_started'
    | 'message_observed'
    | 'reachable'
    | 'varp_changed';

export interface Provenance {
    source: 'wiki_strict' | 'wiki_lax' | 'graph_edge' | 'llm' | 'environment' | 'human';
    reference: string;
    confidence?: number;
    observedAt?: string;
}

export interface DomainPredicate {
    kind: PredicateKind;
    args: Record<string, unknown>;
    provenance: Provenance[];
    confidence: number;
}

export interface DomainEffect {
    kind: EffectKind;
    args: Record<string, unknown>;
    provenance: Provenance[];
    confidence: number;
}

export interface LearnedActionSchema {
    id: string;
    name: string;
    description?: string;
    parameters: Array<{
        name: string;
        type: ParameterType;
        description?: string;
    }>;
    preconditions: DomainPredicate[];
    effects: DomainEffect[];
    negativeEvidence: Array<{
        observation: string;
        inferredMissingPrecondition?: DomainPredicate;
        stateBeforeHash?: string;
        stateAfterHash?: string;
        provenance: Provenance[];
    }>;
}

export interface LearnedDomainLesson {
    id?: string;
    observation: string;
    inference: string;
    actionSchemaId?: string;
    suggestedDomainChange?: string;
    confidence: number;
    provenance: Provenance[];
}

export interface LearnedDomainModel {
    id: string;
    taskId?: string;
    description?: string;
    /**
     * Optional coordinate-grounded facilities/locations learned from KB + traces.
     * This is intentionally minimal and task-agnostic: it stores *where* something is,
     * not *why* it matters. Planning/execution may use it as a hint.
     */
    knownFacilities?: Array<{
        /** Regex-like string used for matching (e.g. "Range|Fire"). */
        namePattern: string;
        x: number;
        z: number;
        level: number;
        /** Optional stable loc id when known. */
        locId?: number;
        confidence: number;
        provenance: Provenance[];
        observedAtTick?: number;
    }>;
    actions: LearnedActionSchema[];
    provenance: Provenance[];
    notes?: string[];
    lessons?: LearnedDomainLesson[];
}

export interface StateSummary {
    tick: number;
    inGame: boolean;
    position?: { x: number; z: number; level: number };
    hp?: { current: number; max: number };
    run?: { energy: number; weight: number };
    combat?: { inCombat: boolean; targetIndex: number; lastDamageTick: number };
    skills: Record<string, { level: number; baseLevel: number; xp: number }>;
    inventory: Record<string, number>;
    equipment: string[];
    /** Nearby NPCs grouped by name for search; variants split by combatLevel+options. */
    nearbyNpcs: Record<string, {
        name: string;
        variants: Record<string, {
            combatLevel?: number;
            options: string[];
            instances: Array<{
                index: number;
                x: number;
                z: number;
                distance: number;
                inCombat: boolean;
                hp?: number;
                maxHp?: number;
            }>;
        }>;
    }>;
    /** Nearby locs grouped by name for search; variants split by id+options. */
    nearbyLocs: Record<string, {
        name: string;
        variants: Record<string, {
            id: number;
            options: string[];
            instances: Array<{
                x: number;
                z: number;
                distance: number;
            }>;
        }>;
    }>;
    groundItems: Array<{ name: string; count: number; distance: number; x?: number; z?: number }>;
    ui: {
        dialogOpen: boolean;
        interfaceOpen: boolean;
        shopOpen: boolean;
        bankOpen: boolean;
        modalOpen: boolean;
    };
    recentMessages: string[];
}

export interface StateDelta {
    ticksElapsed: number;
    positionChanged: boolean;
    inventoryAdded: Record<string, number>;
    inventoryRemoved: Record<string, number>;
    equipmentAdded: string[];
    equipmentRemoved: string[];
    xpGained: Record<string, number>;
    levelChanges: Record<string, { before: number; after: number }>;
    uiChanges: string[];
    newMessages: string[];
}

export interface MinimalGoalState {
    description?: string;
    inventoryContains?: Record<string, number>;
    inventoryGained?: Record<string, number>;
    xpGained?: Record<string, number>;
    positionWithin?: { x: number; z: number; tolerance: number; level?: number };
}

export interface TaskSpec {
    id: string;
    description: string;
    maxSteps: number;
    startState?: {
        savePreset?: string;
        saveConfig?: unknown;
        checkpointPath?: string;
        checkpointProfile?: string;
        notes?: string;
    };
    goalState?: MinimalGoalState;
    success: VerifierSpec[];
    failure?: VerifierSpec[];
}

export type VerifierSpec =
    | { kind: 'inventory_contains'; item: string; count?: number }
    | { kind: 'inventory_gained'; item: string; count?: number }
    | { kind: 'inventory_lacks'; item: string }
    | { kind: 'xp_gained'; skill: string; minXp?: number }
    | { kind: 'level_at_least'; skill: string; level: number }
    | { kind: 'position_within'; x: number; z: number; tolerance: number; level?: number }
    | { kind: 'ui_open'; ui: 'dialog' | 'interface' | 'shop' | 'bank' | 'modal' }
    | { kind: 'message_matches'; pattern: string };

export interface VerifierResult {
    success: boolean;
    passed: VerifierSpec[];
    failed: VerifierSpec[];
    evidence: string[];
}

export interface RetrievalTrace {
    structuredPath: string;
    graphDir: string;
    query: string;
    directMatches: string[];
    traversedEdges: string[];
    fallbackUsed?: boolean;
}

export interface PlannerInput {
    task: TaskSpec;
    state: StateSummary;
    learnedActions?: LearnedActionSchema[];
    retrievalContext?: string;
    /** Passed to symbolic expansion (e.g. cap duplicated cook retries). */
    planExpand?: { cookRepeatCap?: number };
}

export interface PlannerOutput {
    plan: PlanStep[];
    candidateActions?: LearnedActionSchema[];
    verifierHints?: VerifierSpec[];
    notes?: string;
}

/** High-level episode execution segment (for transition logs and traces). */
export type ExecutionPhase =
    | 'planned'
    | 'discovery_initial'
    | 'recovery'
    | 'replanned_symbolic'
    | 'replanned_llm';

export interface PlanStep {
    stepIndex: number;
    naturalLanguage: string;
    actionSchemaId?: string;
    /** Optional structured parameters for executors (kept small; logged in transitions). */
    actionParams?: Record<string, unknown>;
    code?: string;
    expectedEffects?: DomainEffect[];
    /** When set, copied onto ExecutionStep.phase for logging / traces. */
    executionPhase?: ExecutionPhase;
}

export interface ExecutionStep {
    stepIndex: number;
    action: string;
    startedTick: number;
    endedTick: number;
    result: ActionResult;
    before: StateSummary;
    after: StateSummary;
    delta: StateDelta;
    /** Segment label for logging (from PlanStep.executionPhase or inferred). */
    phase?: ExecutionPhase;
    /** Mirrors PlanStep.actionSchemaId when applicable (transition logs). */
    actionSchemaId?: string;
    /** Mirrors PlanStep.actionParams when applicable (transition logs). */
    actionParams?: Record<string, unknown>;
}

/** Present when the symbolic planner returned no plan and discovery bootstrap ran. */
export interface DiscoveryPhaseMeta {
    reason: 'empty_initial_plan';
    plannerNotes?: string;
    budgetSteps: number;
}

/** One row in append-only transition logs (global / per-task / per-trial JSONL). */
export interface TransitionLogRecord {
    schemaVersion: 1;
    episodeId: string;
    tracePath: string;
    taskId: string;
    /** Minimal task copy for offline replay without the full trace JSON. */
    taskSpecSnapshot: Pick<TaskSpec, 'id' | 'description' | 'maxSteps'> & { success: TaskSpec['success'] };
    method: PlannerMethod;
    modelName: string;
    stepOrdinal: number;
    phase: ExecutionPhase;
    actionSchemaId?: string;
    actionParams: Record<string, unknown>;
    startedTick: number;
    endedTick: number;
    summaryBefore: StateSummary;
    summaryAfter: StateSummary;
    delta: StateDelta;
    result: ActionResult;
    verifierAfter: VerifierResult;
    /** Delta from initial episode snapshot to summaryAfter (matches trace verifier inputs). */
    cumulativeDeltaFromEpisodeStart: StateDelta;
    /** Whether all task.success verifiers passed after this step. */
    verifierProgressSuccess: boolean;
    summaryBeforeHash?: string;
    summaryAfterHash?: string;
    /**
     * Compact world-object observations for world-object memory / RAG (from raw SDK state after step).
     *
     * Grouped for searchability and minimal redundancy:
     * kind -> name -> variantKey -> instances
     */
    observedWorldObjects?: {
        loc?: Record<string, {
            level: number;
            variants: Record<string, {
                id: number;
                options: string[];
                instances: Array<{ x: number; z: number; distance: number }>;
            }>;
        }>;
    };
    recordedAt: string;
}

export interface AgenticReplanEvent {
    replanIndex: number;
    triggeredBy: {
        action: string;
        result: ActionResult;
    };
    ragQueries?: string[];
    ragContext?: string;
    notes?: string;
    plan: PlanStep[];
    domainModel?: LearnedDomainModel;
    learnedLessons?: LearnedDomainLesson[];
    symbolicReplan?: {
        notes?: string;
        plan: PlanStep[];
    };
    rawResponse?: string;
}

export interface EpisodeTrace {
    episodeId: string;
    /** Output trace JSON path written by run-episode (for transition log correlation). */
    tracePath?: string;
    method: PlannerMethod;
    task: TaskSpec;
    model?: {
        provider: 'ollama' | 'api' | 'none';
        name: string;
        temperature?: number;
    };
    retrieval?: RetrievalTrace;
    plan: PlanStep[];
    /** Symbolic planner produced no plan; synthetic discovery steps were injected. */
    discoveryPhase?: DiscoveryPhaseMeta;
    agenticReplans?: AgenticReplanEvent[];
    execution: ExecutionStep[];
    metrics: {
        success: boolean;
        timeToFirstCompletionMs?: number;
        totalDurationMs: number;
        invalidActionCount: number;
        replanningCount: number;
    };
    finalState?: StateSummary;
    rawFinalState?: BotWorldState | null;
    pddlArtifacts?: {
        domainModelId: string;
        initialDomain: string;
        initialProblem: string;
        finalDomain: string;
        finalProblem: string;
    };
    domainArtifacts?: {
        initialDomainModel: LearnedDomainModel;
        finalDomainModel: LearnedDomainModel;
    };
}
