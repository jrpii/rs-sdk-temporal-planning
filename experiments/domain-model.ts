import type {
    DomainEffect,
    DomainPredicate,
    LearnedActionSchema,
    LearnedDomainModel,
    StateSummary,
    TaskSpec,
    VerifierSpec,
} from './schemas';

export const ACTION_DOCS = `
Available executable SDK actions for this vertical slice:

- bot.walkTo(x, z, tolerance?): pathfind to coordinates. Returns { success, message }.
- bot.openDoor(target?): open a nearby door or gate, walking to it if needed.
- bot.useItemOnLoc(item, loc): use an inventory item on a nearby location. Good examples: raw fish on range/fire.
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
        ...(task.goalState?.inventoryGained ?? {}),
    })) {
        if (count > 0) facts.add(`has_item:${normalizeFactName(item)}`);
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
            return [`has_item:${normalizeFactName(spec.item.replace(/[\^$]/g, ''))}`];
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
            const names = String(predicateValue.args.name ?? predicateValue.args.loc ?? '')
                .split('|')
                .map(normalizeFactName)
                .filter(Boolean);
            return names.map(name => `near_loc:${name}`);
        }
        case 'skill_at_least':
            return [`skill_at_least:${normalizeFactName(predicateValue.args.skill)}:${predicateValue.args.level ?? 1}`];
        case 'reachable':
            return [`reachable:${normalizeFactName(predicateValue.args.target ?? predicateValue.args.name ?? predicateValue.args.loc)}`];
        default:
            return [];
    }
}

export function effectToFacts(effectValue: DomainEffect): string[] {
    switch (effectValue.kind) {
        case 'item_added':
            return [`has_item:${normalizeFactName(effectValue.args.item)}`];
        case 'xp_gained':
            return [`xp_gained:${normalizeFactName(effectValue.args.skill)}`];
        case 'reachable':
            return [`reachable:${normalizeFactName(effectValue.args.target ?? effectValue.args.name ?? effectValue.args.loc)}`];
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
