import type { PlanStep } from './schemas';

/** Executable discovery macros wired in run-episode.ts `executeStep`. */
const DISCOVERY_CYCLE_COOK = ['explore_for_cooking_source', 'open_nearby_door', 'use_item_on_cooking_source'] as const;

/// TODO: This needs some work for more generic discovery. Probably configerable with a target action set or similar config.
/** Without shrimp-specific cook action, avoid repeating a guaranteed no-op cook step every cycle. */
const DISCOVERY_CYCLE_GENERIC = ['explore_for_cooking_source', 'open_nearby_door'] as const;

export interface DiscoveryPlanOptions {
    /**
     * Optional explicit cycle override (actionSchemaIds).
     * Example: ['explore_for_loc', 'open_nearby_door', 'walk_to_loc'] once executor supports it.
     */
    actionCycle?: string[];
    /**
     * Optional exploration targets. Each explore step rotates through these patterns.
     * Example: ['Range|Fire', 'Bank booth|Banker', 'Door|Gate']
     */
    exploreTargets?: string[];
}

/**
 * Deterministic, repeatable bootstrap when the symbolic planner returns no plan.
 * Cycles through safe macros so transitions are logged and the world may change (movement, doors opened).
 */
export function buildDiscoveryPlanSteps(taskId: string, maxEpisodeSteps: number, discoveryBudget: number, options: DiscoveryPlanOptions = {}): PlanStep[] {
    const cycle = (options.actionCycle?.length
        ? options.actionCycle
        : (taskId.includes('cook_shrimp') ? [...DISCOVERY_CYCLE_COOK] : [...DISCOVERY_CYCLE_GENERIC]));
    const n = Math.max(0, Math.min(maxEpisodeSteps, discoveryBudget));
    const exploreTargets = options.exploreTargets?.length
        ? options.exploreTargets
        : (taskId.includes('cook_shrimp') ? ['Range|Fire'] : []);
    return Array.from({ length: n }, (_, i) => {
        const actionSchemaId = cycle[i % cycle.length]!;
        const exploreTarget =
            exploreTargets.length > 0 ? exploreTargets[i % exploreTargets.length] : '';
        const actionParams =
            actionSchemaId === 'explore_for_cooking_source' && exploreTarget
                ? { targetLocNamePattern: exploreTarget }
                : undefined;
        return {
            stepIndex: i,
            naturalLanguage: `Discovery bootstrap ${i + 1}: ${actionSchemaId}`,
            actionSchemaId,
            actionParams,
            executionPhase: 'discovery_initial' as const,
        };
    });
}
