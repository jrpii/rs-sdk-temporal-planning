import type {
    DomainEffect,
    DomainPredicate,
    LearnedActionSchema,
    LearnedDomainModel,
    LearnedDomainLesson,
    StateSummary,
    TaskSpec,
    VerifierSpec,
} from './schemas';

export const EXECUTABLE_ACTION_IDS = [
    'use_item_on_cooking_source',
    'open_nearby_door',
    'explore_for_cooking_source',
] as const;

export const ACTION_DOCS = `
Available executable SDK actions for this vertical slice:

- bot.walkTo(x, z, tolerance?): pathfind to coordinates. Returns { success, message }.
- bot.openDoor(target?): open a nearby door or gate, walking to it if needed.
- bot.useItemOnLoc(item, loc): use an inventory item on a nearby location. Good examples: raw fish on range/fire.
- explore_for_cooking_source: bounded experiment executor that scans a wider radius, opens obvious doors/gates, and walks short probes to find a Range or Fire.
- sdk.findInventoryItem(pattern): find an item in inventory by name.
- sdk.findNearbyLoc(pattern): find a visible location/object by name.
- sdk.scanNearbyLocs(radius?): scan a larger area for nearby locations/objects.
- sdk.sendUseItemOnLoc(slot, x, z, locId): low-level item-on-location packet.

Important execution detail:
- Cooking is stochastic at low level. Using Raw shrimps on a Range can produce Shrimps or Burnt fish.
- A failed stochastic outcome is not an invalid action if Raw shrimps were consumed and Burnt fish appeared.
- If pathing says a target cannot be reached and a nearby door/gate has an Open option, opening the door/gate is a valid recovery action.
`.trim();

const human = [{ source: 'human' as const, reference: 'experiments/domain-model.ts', confidence: 1 }];

export function defaultCookShrimpDomain(taskId = 'cook_shrimp_alkharid'): LearnedDomainModel {
    return {
        id: 'cook-shrimp-v0',
        taskId,
        description: 'Minimal symbolic model for cooking raw shrimps on a nearby range or fire.',
        provenance: human,
        notes: [
            'Classical effect is the successful cooking branch; execution must tolerate stochastic burned output and retry.',
        ],
        lessons: [],
        actions: [
            {
                id: 'use_item_on_cooking_source',
                name: 'Use raw shrimps on cooking source',
                description: 'Use Raw shrimps on a nearby Range or Fire to attempt cooking.',
                parameters: [
                    { name: 'raw_item', type: 'item', description: 'Raw shrimps' },
                    { name: 'source', type: 'facility', description: 'Range or Fire' },
                ],
                preconditions: [
                    predicate('has_item', { item: 'Raw shrimps', count: 1 }),
                    predicate('near_loc', { name: 'Range|Fire' }),
                ],
                effects: [
                    effect('item_removed', { item: 'Raw shrimps', count: 1 }),
                    effect('item_added', { item: 'Shrimps', count: 1 }),
                    effect('xp_gained', { skill: 'Cooking', minXp: 1 }),
                ],
                negativeEvidence: [],
            },
        ],
    };
}

export function predicate(kind: DomainPredicate['kind'], args: Record<string, unknown>, confidence = 1): DomainPredicate {
    return { kind, args, confidence, provenance: human };
}

export function effect(kind: DomainEffect['kind'], args: Record<string, unknown>, confidence = 1): DomainEffect {
    return { kind, args, confidence, provenance: human };
}

export function normalizeFactName(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function splitFactAlternatives(value: unknown): string[] {
    return String(value ?? '')
        .split('|')
        .map(normalizeFactName)
        .filter(Boolean);
}

export function stateFacts(summary: StateSummary): Set<string> {
    const facts = new Set<string>();

    for (const [item, count] of Object.entries(summary.inventory)) {
        if (count > 0) facts.add(`has_item:${normalizeFactName(item)}`);
    }

    for (const loc of summary.nearbyLocs) {
        facts.add(`near_loc:${normalizeFactName(loc.name)}`);
    }

    for (const [skill, values] of Object.entries(summary.skills)) {
        facts.add(`skill_at_least:${normalizeFactName(skill)}:${values.baseLevel}`);
        if (values.xp > 0) facts.add(`has_xp:${normalizeFactName(skill)}`);
    }

    return facts;
}

export function goalFacts(task: TaskSpec): Set<string> {
    const facts = new Set<string>();

    for (const [item, count] of Object.entries({
        ...(task.goalState?.inventoryContains ?? {}),
    })) {
        if (count > 0) facts.add(`has_item:${normalizeFactName(item)}`);
    }

    for (const [item, count] of Object.entries(task.goalState?.inventoryGained ?? {})) {
        if (count > 0) facts.add(`item_gained:${normalizeFactName(item)}`);
    }

    for (const [skill, xp] of Object.entries(task.goalState?.xpGained ?? {})) {
        if (xp > 0) facts.add(`xp_gained:${normalizeFactName(skill)}`);
    }

    for (const spec of task.success) {
        verifierGoalFacts(spec).forEach(fact => facts.add(fact));
    }

    return facts;
}

function verifierGoalFacts(spec: VerifierSpec): string[] {
    switch (spec.kind) {
        case 'inventory_contains':
            return [`has_item:${normalizeFactName(spec.item.replace(/[\^$]/g, ''))}`];
        case 'inventory_gained':
            return [`item_gained:${normalizeFactName(spec.item.replace(/[\^$]/g, ''))}`];
        case 'xp_gained':
            return [`xp_gained:${normalizeFactName(spec.skill)}`];
        default:
            return [];
    }
}

export function predicateToFacts(predicateValue: DomainPredicate): string[] {
    switch (predicateValue.kind) {
        case 'has_item':
            return [`has_item:${normalizeFactName(predicateValue.args.item)}`];
        case 'near_loc': {
            const names = splitFactAlternatives(predicateValue.args.name ?? predicateValue.args.loc);
            return names.map(name => `near_loc:${name}`);
        }
        case 'skill_at_least':
            return [`skill_at_least:${normalizeFactName(predicateValue.args.skill)}:${predicateValue.args.level ?? 1}`];
        case 'reachable':
            return splitFactAlternatives(predicateValue.args.target ?? predicateValue.args.name ?? predicateValue.args.loc)
                .map(name => `reachable:${name}`);
        default:
            return [];
    }
}

export function effectToFacts(effectValue: DomainEffect): string[] {
    switch (effectValue.kind) {
        case 'item_added':
            return [
                `has_item:${normalizeFactName(effectValue.args.item)}`,
                `item_gained:${normalizeFactName(effectValue.args.item)}`,
            ];
        case 'xp_gained':
            return [`xp_gained:${normalizeFactName(effectValue.args.skill)}`];
        case 'near_loc':
            return splitFactAlternatives(effectValue.args.name ?? effectValue.args.loc)
                .map(name => `near_loc:${name}`);
        case 'reachable':
            return splitFactAlternatives(effectValue.args.target ?? effectValue.args.name ?? effectValue.args.loc)
                .map(name => `reachable:${name}`);
        case 'message_observed':
            return [`message_observed:${normalizeFactName(effectValue.args.pattern ?? effectValue.args.message)}`];
        case 'position_changed':
        case 'varp_changed':
            return [`${effectValue.kind}:${normalizeFactName(effectValue.args.target ?? effectValue.args.name ?? effectValue.args.varp)}`];
        case 'interface_opened':
        case 'interface_closed':
        case 'dialog_opened':
        case 'dialog_closed':
            return [effectValue.kind];
        case 'level_changed':
            return [`level_changed:${normalizeFactName(effectValue.args.skill)}`];
        case 'bank_changed':
        case 'shop_changed':
        case 'combat_started':
            return [effectValue.kind];
        default:
            return [];
    }
}

export function safeModelName(model: string): string {
    return model.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

export function isExecutableActionId(actionId: string | undefined): boolean {
    return EXECUTABLE_ACTION_IDS.includes(actionId as typeof EXECUTABLE_ACTION_IDS[number]);
}

function sameKindAndArgs(a: DomainPredicate | DomainEffect, b: DomainPredicate | DomainEffect): boolean {
    return a.kind === b.kind && JSON.stringify(a.args) === JSON.stringify(b.args);
}

function mergeAction(base: LearnedActionSchema, update: Partial<LearnedActionSchema>): LearnedActionSchema {
    return {
        ...base,
        ...update,
        parameters: update.parameters?.length ? update.parameters : base.parameters,
        preconditions: [
            ...base.preconditions,
            ...(update.preconditions ?? []).filter(candidate => !base.preconditions.some(existing => sameKindAndArgs(existing, candidate))),
        ],
        effects: [
            ...base.effects,
            ...(update.effects ?? []).filter(candidate => !base.effects.some(existing => sameKindAndArgs(existing, candidate))),
        ],
        negativeEvidence: [
            ...(base.negativeEvidence ?? []),
            ...(update.negativeEvidence ?? []),
        ],
    };
}

export function recoveryActionSchemas(): LearnedActionSchema[] {
    return [
        {
            id: 'open_nearby_door',
            name: 'Open nearby door or gate',
            description: 'Open a visible door or gate when pathing reports a reachable-looking target cannot actually be reached.',
            parameters: [{ name: 'door', type: 'loc', description: 'Visible door or gate with Open option' }],
            preconditions: [predicate('near_loc', { name: 'Door|Gate|Large door' }, 0.7)],
            effects: [
                effect('reachable', { target: 'Range|Fire' }, 0.6),
                effect('message_observed', { pattern: 'door opened or reachability changed' }, 0.4),
            ],
            negativeEvidence: [],
        },
        {
            id: 'explore_for_cooking_source',
            name: 'Explore for a cooking source',
            description: 'Bounded recovery action that scans, opens obvious doors/gates, and walks short probes to find a reachable Range or Fire.',
            parameters: [{ name: 'source', type: 'facility', description: 'Range or Fire' }],
            preconditions: [predicate('has_item', { item: 'Raw shrimps', count: 1 }, 0.6)],
            effects: [
                effect('near_loc', { name: 'Range|Fire' }, 0.5),
                effect('reachable', { target: 'Range|Fire' }, 0.5),
            ],
            negativeEvidence: [],
        },
    ];
}

export function sanitizeLearnedDomainModel(
    model: LearnedDomainModel,
    task: TaskSpec,
    fallback: LearnedDomainModel = defaultCookShrimpDomain(task.id),
    options: { includeRecoveryActions?: boolean } = {},
): LearnedDomainModel {
    const executableActions = model.actions.filter(action => isExecutableActionId(action.id));
    const mergedById = new Map<string, LearnedActionSchema>();
    const recoveryActions = options.includeRecoveryActions ? recoveryActionSchemas() : [];
    for (const action of [...fallback.actions, ...executableActions, ...recoveryActions]) {
        const existing = mergedById.get(action.id);
        mergedById.set(action.id, existing ? mergeAction(existing, action) : {
            ...action,
            negativeEvidence: action.negativeEvidence ?? [],
        });
    }

    return {
        ...fallback,
        ...model,
        taskId: model.taskId || task.id,
        provenance: model.provenance?.length ? model.provenance : fallback.provenance,
        notes: [...(fallback.notes ?? []), ...(model.notes ?? [])],
        lessons: [...(fallback.lessons ?? []), ...(model.lessons ?? [])],
        actions: [...mergedById.values()],
    };
}

export function appendDomainLessons(model: LearnedDomainModel, lessons: LearnedDomainLesson[]): LearnedDomainModel {
    if (lessons.length === 0) return model;
    const existing = model.lessons ?? [];
    const seen = new Set(existing.map(lesson => `${lesson.actionSchemaId ?? ''}|${lesson.observation}|${lesson.inference}`));
    const nextLessons = [
        ...existing,
        ...lessons.filter(lesson => {
            const key = `${lesson.actionSchemaId ?? ''}|${lesson.observation}|${lesson.inference}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }),
    ];
    return {
        ...model,
        lessons: nextLessons,
        notes: [
            ...(model.notes ?? []),
            ...lessons.map(lesson => `Observed lesson: ${lesson.inference}`),
        ],
    };
}
