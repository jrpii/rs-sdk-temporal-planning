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

/** LLM output may include ids not in stricter types; filter before planning. */
const KNOWN_PREDICATE_KINDS = new Set<string>([
    'has_item',
    'equipped_item',
    'skill_at_least',
    'near_loc',
    'near_npc',
    'at_position',
    'bank_open',
    'shop_open',
    'dialog_state',
    'interface_open',
    'inventory_space',
    'not_in_combat',
    'reachable',
    'varp_state',
]);

const KNOWN_EFFECT_KINDS = new Set<string>([
    'item_added',
    'item_removed',
    'item_equipped',
    'xp_gained',
    'level_changed',
    'near_loc',
    'position_changed',
    'dialog_opened',
    'dialog_closed',
    'interface_opened',
    'interface_closed',
    'bank_changed',
    'shop_changed',
    'combat_started',
    'message_observed',
    'reachable',
    'varp_changed',
]);

function filterActionStructure(action: LearnedActionSchema): LearnedActionSchema {
    return {
        ...action,
        preconditions: action.preconditions.filter(p => KNOWN_PREDICATE_KINDS.has(String(p.kind))),
        effects: action.effects.filter(e => KNOWN_EFFECT_KINDS.has(String(e.kind))),
    };
}

/** True if two normalized item names are trivial singular/plural variants (e.g. raw_shrimp vs raw_shrimps). */
function sameItemAlias(a: string, b: string): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a + 's' === b) return true;
    if (b + 's' === a) return true;
    return false;
}

function stripVerifierAnchors(item: string): string {
    return item.replace(/^\^|\$/g, '');
}

function fallbackInventoryItemNames(model: LearnedDomainModel): string[] {
    const out: string[] = [];
    for (const a of model.actions) {
        for (const p of a.preconditions) {
            if (p.kind === 'has_item' && p.args.item) out.push(String(p.args.item));
        }
        for (const e of a.effects) {
            if ((e.kind === 'item_added' || e.kind === 'item_removed') && e.args.item) {
                out.push(String(e.args.item));
            }
        }
    }
    return out;
}

function pickCanonicalItemName(
    cluster: DomainPredicate[],
    task: TaskSpec,
    fallbackModel: LearnedDomainModel,
): string {
    const variants = cluster
        .map(p => String(p.args.item ?? '').trim())
        .filter(Boolean);
    if (variants.length === 0) return 'unknown';

    const goalNames = [
        ...Object.keys(task.goalState?.inventoryContains ?? {}),
        ...Object.keys(task.goalState?.inventoryGained ?? {}),
    ].map(stripVerifierAnchors);

    for (const goal of goalNames) {
        const ng = normalizeFactName(goal);
        for (const v of variants) {
            if (sameItemAlias(ng, normalizeFactName(v))) return goal;
        }
    }

    for (const fb of fallbackInventoryItemNames(fallbackModel)) {
        const nf = normalizeFactName(fb);
        for (const v of variants) {
            if (sameItemAlias(nf, normalizeFactName(v))) return fb;
        }
    }

    return variants.reduce((best, v) =>
        normalizeFactName(v).length >= normalizeFactName(best).length ? v : best,
    variants[0]!);
}

function clusterHasItemPredicates(preds: DomainPredicate[]): DomainPredicate[][] {
    const hasItems = preds.filter(p => p.kind === 'has_item');
    if (hasItems.length <= 1) return hasItems.map(p => [p]);

    const clusters: DomainPredicate[][] = hasItems.map(p => [p]);
    let merged = true;
    while (merged) {
        merged = false;
        outer: for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const ni = normalizeFactName(String(clusters[i]![0]!.args.item ?? ''));
                const nj = normalizeFactName(String(clusters[j]![0]!.args.item ?? ''));
                if (sameItemAlias(ni, nj)) {
                    clusters[i] = [...clusters[i]!, ...clusters[j]!];
                    clusters.splice(j, 1);
                    merged = true;
                    break outer;
                }
            }
        }
    }
    return clusters;
}

/** Merge duplicate has_item preconditions that only differ by trivial naming (LLM "Raw shrimp" vs game "Raw shrimps").
 *  Otherwise each has_item becomes an AND group in symbolic planning and the action is never applicable. */
function collapseDuplicateHasItemPreconditions(
    action: LearnedActionSchema,
    task: TaskSpec,
    fallbackModel: LearnedDomainModel,
): LearnedActionSchema {
    const nonHas = action.preconditions.filter(p => p.kind !== 'has_item');
    const hasItems = action.preconditions.filter(p => p.kind === 'has_item');
    if (hasItems.length === 0) return action;

    const mergedHas: DomainPredicate[] = [];
    for (const cluster of clusterHasItemPredicates(action.preconditions)) {
        if (cluster.length === 0) continue;
        const item = pickCanonicalItemName(cluster, task, fallbackModel);
        const count = Math.max(
            ...cluster.map(p => (typeof p.args.count === 'number' ? p.args.count : 1) as number),
        );
        const confidence = Math.max(...cluster.map(p => p.confidence ?? 0));
        const provenance = cluster.flatMap(p => p.provenance ?? []);
        mergedHas.push({
            kind: 'has_item',
            args: { item, count },
            confidence,
            provenance: provenance.length ? provenance : human,
        });
    }

    return {
        ...action,
        preconditions: [...nonHas, ...mergedHas],
    };
}

export const EXECUTABLE_ACTION_IDS = [
    'use_item_on_cooking_source',
    'open_nearby_door',
    'explore_for_cooking_source',
    // Task-agnostic alias. Executor treats this the same as explore_for_cooking_source.
    'explore_for_loc',
    'walk_to',
    'wait_ticks',
    'interact_loc',
    'interact_npc',
    'use_item_on_loc',
    'pickup_ground_item',
] as const;

export const ACTION_DOCS = `
Available executable SDK actions for this vertical slice:

- bot.walkTo(x, z, tolerance?): pathfind to coordinates. Returns { success, message }.
- walk_to: task-agnostic action id for bot.walkTo (use actionParams.x/z/tolerance).
- bot.openDoor(target?): open a nearby door or gate, walking to it if needed.
- bot.useItemOnLoc(item, loc): use an inventory item on a nearby location. Good examples: raw fish on range/fire.
- use_item_on_loc: generic "use inventory item on location" (use actionParams.itemNamePattern + actionParams.locNamePattern [+ optional locId]).
- interact_loc: interact with a location via an option (use actionParams.locNamePattern + actionParams.optionPattern).
- interact_npc: interact with an NPC via an option (use actionParams.npcNamePattern + actionParams.optionPattern).
- pickup_ground_item: pick up a ground item (use actionParams.itemNamePattern).
- wait_ticks: wait for N ticks (use actionParams.ticks).
- explore_for_cooking_source: bounded experiment executor that scans a wider radius, opens obvious doors/gates, and walks short probes to find a target location (default Range|Fire).
- explore_for_loc: task-agnostic alias of explore_for_cooking_source (uses actionParams.targetLocNamePattern when provided).
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

export function defaultGenericDomain(taskId: string): LearnedDomainModel {
    return {
        id: 'generic-v0',
        taskId,
        description: 'Minimal task-agnostic symbolic model over generic executable actions.',
        provenance: human,
        notes: [
            'This is a fallback model used when no task-specific hand model exists.',
            'Most actions require additional executor support to become fully general.',
        ],
        lessons: [],
        actions: [
            {
                id: 'explore_for_loc',
                name: 'Explore for a target location',
                description: 'Scan and move around to find a target location (configured via action params in execution).',
                parameters: [{ name: 'target', type: 'loc', description: 'Target location name pattern' }],
                preconditions: [],
                effects: [
                    effect('near_loc', { name: 'target' }, 0.2),
                    effect('reachable', { target: 'target' }, 0.2),
                ],
                negativeEvidence: [],
            },
            {
                id: 'open_nearby_door',
                name: 'Open nearby door or gate',
                description: 'Open a visible door or gate when pathing is blocked.',
                parameters: [{ name: 'door', type: 'loc' }],
                preconditions: [predicate('near_loc', { name: 'Door|Gate|Large door' }, 0.4)],
                effects: [effect('reachable', { target: 'unknown' }, 0.2)],
                negativeEvidence: [],
            },
            {
                id: 'interact_loc',
                name: 'Interact with location',
                description: 'Interact with a nearby location using a chosen option (e.g. Mine, Chop down, Fish, Smelt).',
                parameters: [
                    { name: 'loc', type: 'loc' },
                    { name: 'option', type: 'quantity', description: 'Option text/pattern' },
                ],
                preconditions: [predicate('near_loc', { name: 'target' }, 0.2)],
                effects: [],
                negativeEvidence: [],
            },
            {
                id: 'pickup_ground_item',
                name: 'Pick up a ground item',
                description: 'Pick up a nearby ground item by name pattern.',
                parameters: [{ name: 'item', type: 'item' }],
                preconditions: [],
                effects: [],
                negativeEvidence: [],
            },
        ],
    };
}

export function defaultDomainForTask(task: TaskSpec): LearnedDomainModel {
    if (task.id.includes('cook_shrimp')) return defaultCookShrimpDomain(task.id);
    return defaultGenericDomain(task.id);
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

    for (const group of Object.values(summary.nearbyLocs)) {
        facts.add(`near_loc:${normalizeFactName(group.name)}`);
        for (const variant of Object.values(group.variants)) {
            for (const opt of variant.options ?? []) {
                facts.add(`near_loc_option:${normalizeFactName(group.name)}:${normalizeFactName(opt)}`);
            }
        }
    }

    for (const group of Object.values(summary.nearbyNpcs)) {
        facts.add(`near_npc:${normalizeFactName(group.name)}`);
    }

    for (const gi of summary.groundItems ?? []) {
        if (gi.count > 0) facts.add(`ground_item:${normalizeFactName(gi.name)}`);
    }

    if (summary.ui.bankOpen) facts.add('ui:bank_open');
    if (summary.ui.shopOpen) facts.add('ui:shop_open');
    if (summary.ui.dialogOpen) facts.add('ui:dialog_open');
    if (summary.ui.interfaceOpen) facts.add('ui:interface_open');
    if (summary.ui.modalOpen) facts.add('ui:modal_open');

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
        case 'near_loc_option': {
            const locNames = splitFactAlternatives(predicateValue.args.loc ?? predicateValue.args.name);
            const optNames = splitFactAlternatives(predicateValue.args.option ?? predicateValue.args.optionText);
            const facts: string[] = [];
            for (const loc of locNames) {
                for (const opt of optNames) {
                    facts.push(`near_loc_option:${loc}:${opt}`);
                }
            }
            return facts;
        }
        case 'near_npc': {
            const names = splitFactAlternatives(predicateValue.args.name ?? predicateValue.args.npc);
            return names.map(name => `near_npc:${name}`);
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
    const executableActions = model.actions.filter(action => isExecutableActionId(action.id)).map(filterActionStructure);
    const mergedById = new Map<string, LearnedActionSchema>();
    const recoveryActions = options.includeRecoveryActions ? recoveryActionSchemas() : [];
    for (const action of [...fallback.actions.map(filterActionStructure), ...executableActions, ...recoveryActions]) {
        const existing = mergedById.get(action.id);
        mergedById.set(action.id, existing ? mergeAction(existing, action) : {
            ...action,
            negativeEvidence: action.negativeEvidence ?? [],
        });
    }

    /** Shim executable recovery schemas into whatever the LLM emitted so symbolic planning can chain explore→cook. */
    for (const recovery of recoveryActionSchemas()) {
        const existing = mergedById.get(recovery.id);
        if (existing) {
            mergedById.set(recovery.id, mergeAction(existing, recovery));
        }
    }

    const actionsWithCleanup = [...mergedById.values()]
        .map(filterActionStructure)
        .map(action => collapseDuplicateHasItemPreconditions(action, task, fallback));

    return {
        ...fallback,
        ...model,
        taskId: model.taskId || task.id,
        provenance: model.provenance?.length ? model.provenance : fallback.provenance,
        notes: [...(fallback.notes ?? []), ...(model.notes ?? [])],
        lessons: [...(fallback.lessons ?? []), ...(model.lessons ?? [])],
        actions: actionsWithCleanup,
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
