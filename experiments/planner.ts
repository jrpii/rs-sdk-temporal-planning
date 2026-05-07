import { defaultCookShrimpDomain } from './domain-model';
import { symbolicPlan } from './pddl';
import type { LearnedDomainModel, PlannerInput, PlannerMethod, PlannerOutput } from './schemas';

/**
 * Planner factory semantics:
 *
 * - `experiments/run-episode.ts` passes a concrete `LearnedDomainModel` into `createPlanner` unless
 *   `--scripted-planner` is set with method `few_shot` or `static_rag`.
 * - Whenever `domainModel` is passed, `SymbolicDomainPlanner` runs the in-process STRIPS-style forward search (`symbolicPlan` in `pddl.ts`).
 * - Therefore `few_shot` / `static_rag` **episode runs default to symbolic planning**, not `ScriptedCookShrimpPlanner`,
 *   despite the method name. Use `--scripted-planner` to force the scripted vertical-slice cook loop plan.
 */
export interface Planner {
    readonly method: PlannerMethod;
    plan(input: PlannerInput): Promise<PlannerOutput> | PlannerOutput;
}

const cookShrimpActionCode = `
const raw = sdk.findInventoryItem(/^Raw shrimps$/i);
if (!raw) throw new Error('Missing Raw shrimps in inventory');

const range = sdk.findNearbyLoc(/^Range$/i) ?? sdk.findNearbyLoc(/^Fire$/i);
if (!range) throw new Error('No nearby range or fire found');

const result = await bot.useItemOnLoc(raw, range);
if (!result.success) throw new Error(result.message);
`.trim();

export class ScriptedCookShrimpPlanner implements Planner {
    readonly method: PlannerMethod;

    constructor(method: PlannerMethod = 'few_shot') {
        this.method = method;
    }

    plan(input: PlannerInput): PlannerOutput {
        if (!input.task.id.includes('cook_shrimp')) {
            return {
                plan: [],
                verifierHints: input.task.success,
                notes: `No scripted vertical-slice plan is available for task ${input.task.id}.`,
            };
        }

        return {
            plan: Array.from({ length: input.task.maxSteps }, (_, stepIndex) => ({
                stepIndex,
                naturalLanguage: `Attempt ${stepIndex + 1}: use raw shrimps on the nearest cooking range or fire.`,
                actionSchemaId: 'use_item_on_cooking_source',
                code: cookShrimpActionCode,
            })),
            verifierHints: input.task.success,
            notes:
                this.method === 'learned_domain'
                    ? 'Vertical-slice placeholder: learned-domain runs should replace or refine this plan from persistent action schemas.'
                    : 'Vertical-slice scripted baseline for validating episode execution and trace logging.',
        };
    }
}

export class SymbolicDomainPlanner implements Planner {
    readonly method: PlannerMethod;

    constructor(
        method: PlannerMethod = 'pddl',
        private readonly domainModel: LearnedDomainModel = defaultCookShrimpDomain(),
    ) {
        this.method = method;
    }

    plan(input: PlannerInput): PlannerOutput {
        const model = input.learnedActions?.length
            ? { ...this.domainModel, actions: input.learnedActions }
            : this.domainModel;

        const output = symbolicPlan(input.task, input.state, model, input.planExpand);
        return {
            ...output,
            verifierHints: input.task.success,
            notes: `${output.notes ?? 'symbolic plan'} using domain model ${model.id}`,
        };
    }
}

export function createPlanner(method: PlannerMethod, domainModel?: LearnedDomainModel): Planner {
    if (method === 'pddl' || method === 'learned_domain' || domainModel) {
        return new SymbolicDomainPlanner(method, domainModel);
    }
    return new ScriptedCookShrimpPlanner(method);
}
