import type { LearnedActionSchema, LearnedDomainModel, PlannerOutput, StateSummary, TaskSpec } from './schemas';
import { effectToFacts, goalFacts, normalizeFactName, predicateToFacts, stateFacts } from './domain-model';

function pddlAtom(fact: string): string {
    return fact.replace(/:/g, '_');
}

function actionPreconditions(action: LearnedActionSchema): string[][] {
    return action.preconditions
        .map(predicateToFacts)
        .filter(group => group.length > 0);
}

function actionEffects(action: LearnedActionSchema): string[] {
    return action.effects.flatMap(effectToFacts);
}

function actionApplicable(facts: Set<string>, action: LearnedActionSchema): boolean {
    return actionPreconditions(action).every(group => group.some(fact => facts.has(fact)));
}

/**
 * Forward-application of symbolic action effects for the in-process planner.
 * Note: `item_removed` and several other effect kinds currently emit no facts in `effectToFacts`,
 * so consumables like `has_item:*` are **not** deleted unless that mapping is extended (see tests).
 */
export function applySymbolicFacts(facts: Set<string>, action: LearnedActionSchema): Set<string> {
    const next = new Set(facts);
    for (const fact of actionEffects(action)) next.add(fact);
    // Minimal delete semantics for inventory consumption (Priority 3).
    // Remove `has_item:<item>` when an action has an `item_removed` effect.
    for (const effect of action.effects) {
        if (effect.kind !== 'item_removed') continue;
        const item = normalizeFactName(effect.args.item);
        if (!item) continue;
        next.delete(`has_item:${item}`);
    }
    return next;
}

function applyAction(facts: Set<string>, action: LearnedActionSchema): Set<string> {
    return applySymbolicFacts(facts, action);
}

function goalsMet(facts: Set<string>, goals: Set<string>): boolean {
    for (const goal of goals) {
        if (!facts.has(goal)) return false;
    }
    return true;
}

export function symbolicPlan(
    task: TaskSpec,
    state: StateSummary,
    model: LearnedDomainModel,
    expand?: { cookRepeatCap?: number },
): PlannerOutput {
    const initial = stateFacts(state);
    const goals = goalFacts(task);
    const queue: Array<{ facts: Set<string>; plan: LearnedActionSchema[] }> = [{ facts: initial, plan: [] }];
    const seen = new Set<string>();
    const maxDepth = Math.max(1, task.maxSteps);

    while (queue.length > 0) {
        const node = queue.shift()!;
        const key = [...node.facts].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        if (goalsMet(node.facts, goals)) {
            return toPlannerOutput(node.plan, task.maxSteps, 'symbolic plan found', expand);
        }

        if (node.plan.length >= maxDepth) continue;

        for (const action of model.actions) {
            if (!actionApplicable(node.facts, action)) continue;
            queue.push({ facts: applyAction(node.facts, action), plan: [...node.plan, action] });
        }
    }

    return {
        plan: [],
        verifierHints: task.success,
        notes: `No symbolic plan found with ${model.actions.length} learned actions and depth ${maxDepth}.`,
    };
}

export function toPlannerOutput(
    actions: LearnedActionSchema[],
    maxSteps: number,
    notes: string,
    expand?: { cookRepeatCap?: number },
): PlannerOutput {
    const cookCap = expand?.cookRepeatCap;
    const plan = actions.flatMap(action => {
        // For stochastic low-level RuneScape actions, keep bounded retries in the executable plan.
        const rawAttempts =
            action.id === 'use_item_on_cooking_source'
                ? typeof cookCap === 'number' && cookCap > 0
                    ? Math.min(cookCap, maxSteps)
                    : Math.max(1, maxSteps)
                : 1;
        const attempts = Math.max(1, Math.min(rawAttempts, maxSteps));
        return Array.from({ length: attempts }, (_, index) => ({
            stepIndex: index,
            naturalLanguage: `${index + 1}. ${action.name}`,
            actionSchemaId: action.id,
            expectedEffects: action.effects,
        }));
    }).slice(0, maxSteps);

    return { plan, notes };
}

export function exportPddl(task: TaskSpec, state: StateSummary, model: LearnedDomainModel): { domain: string; problem: string } {
    const predicates = new Set<string>([
        ...stateFacts(state),
        ...goalFacts(task),
        ...model.actions.flatMap(action => [
            ...action.preconditions.flatMap(predicateToFacts),
            ...action.effects.flatMap(effectToFacts),
        ]),
    ]);

    const domain = [
        `(define (domain ${normalizeFactName(model.id || 'rs_domain')})`,
        `  (:requirements :strips)`,
        `  (:predicates`,
        ...[...predicates].sort().map(fact => `    (${pddlAtom(fact)})`),
        `  )`,
        ...model.actions.map(action => {
            const preconditions = actionPreconditions(action)
                .map(group => group.length === 1 ? `(${pddlAtom(group[0]!)})` : `(or ${group.map(fact => `(${pddlAtom(fact)})`).join(' ')})`);
            const effects = actionEffects(action).map(fact => `(${pddlAtom(fact)})`);
            return [
                `  (:action ${normalizeFactName(action.id)}`,
                `    :precondition (and ${preconditions.join(' ')})`,
                `    :effect (and ${effects.join(' ')})`,
                `  )`,
            ].join('\n');
        }),
        `)`,
    ].join('\n');

    const problem = [
        `(define (problem ${normalizeFactName(task.id)})`,
        `  (:domain ${normalizeFactName(model.id || 'rs_domain')})`,
        `  (:init ${[...stateFacts(state)].sort().map(fact => `(${pddlAtom(fact)})`).join(' ')})`,
        `  (:goal (and ${[...goalFacts(task)].sort().map(fact => `(${pddlAtom(fact)})`).join(' ')}))`,
        `)`,
    ].join('\n');

    return { domain, problem };
}
