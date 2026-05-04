import type { ActionResult, BotWorldState } from '../sdk/types';

export type PlannerMethod = 'few_shot' | 'static_rag' | 'learned_domain';

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
    | 'position_changed'
    | 'dialog_opened'
    | 'dialog_closed'
    | 'interface_opened'
    | 'interface_closed'
    | 'bank_changed'
    | 'shop_changed'
    | 'combat_started'
    | 'message_observed'
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
    nearbyNpcs: Array<{ name: string; distance: number; options: string[]; combatLevel?: number }>;
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

export interface TaskSpec {
    id: string;
    description: string;
    maxSteps: number;
    startState?: {
        savePreset?: string;
        saveConfig?: unknown;
        notes?: string;
    };
    success: VerifierSpec[];
    failure?: VerifierSpec[];
}

export type VerifierSpec =
    | { kind: 'inventory_contains'; item: string; count?: number }
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

export interface PlanStep {
    stepIndex: number;
    naturalLanguage: string;
    actionSchemaId?: string;
    code?: string;
    expectedEffects?: DomainEffect[];
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
}

export interface EpisodeTrace {
    episodeId: string;
    method: PlannerMethod;
    task: TaskSpec;
    model?: {
        provider: 'ollama' | 'api' | 'none';
        name: string;
        temperature?: number;
    };
    retrieval?: RetrievalTrace;
    plan: PlanStep[];
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
}
