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

function applyAction(facts: Set<string>, action: LearnedActionSchema): Set<string> {
    const next = new Set(facts);
    for (const fact of actionEffects(action)) next.add(fact);
    return next;
}

function goalsMet(facts: Set<string>, goals: Set<string>): boolean {
    for (const goal of goals) {
        if (!facts.has(goal)) return false;
    }
    return true;
}

export function symbolicPlan(task: TaskSpec, state: StateSummary, model: LearnedDomainModel): PlannerOutput {
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
            return toPlannerOutput(node.plan, task.maxSteps, 'symbolic plan found');
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

function toPlannerOutput(actions: LearnedActionSchema[], maxSteps: number, notes: string): PlannerOutput {
    const plan = actions.flatMap(action => {
        // For stochastic low-level RuneScape actions, keep bounded retries in the executable plan.
        const attempts = action.id === 'use_item_on_cooking_source' ? Math.max(1, maxSteps) : 1;
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
