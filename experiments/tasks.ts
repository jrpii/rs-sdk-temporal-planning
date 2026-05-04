import type { TaskSpec } from './schemas';

export const smokeTasks: TaskSpec[] = [
    {
        id: 'walk_lumbridge_courtyard',
        description: 'Walk to a nearby Lumbridge courtyard coordinate.',
        maxSteps: 3,
        startState: {
            savePreset: 'LUMBRIDGE_SPAWN',
            notes: 'Generated save from sdk/test/utils/save-generator.ts; tutorial complete.',
        },
        success: [
            { kind: 'position_within', x: 3222, z: 3218, tolerance: 5 },
        ],
    },
    {
        id: 'cook_shrimp',
        description: 'Cook raw shrimps using a nearby range or fire.',
        maxSteps: 6,
        startState: {
            notes: 'Use a generated save near a cooking facility with Raw shrimps and Cooking level 1.',
        },
        success: [
            { kind: 'inventory_contains', item: '^Shrimps$', count: 1 },
            { kind: 'xp_gained', skill: 'Cooking', minXp: 1 },
        ],
    },
    {
        id: 'mine_copper_or_tin',
        description: 'Mine one copper or tin ore from a nearby rock.',
        maxSteps: 6,
        startState: {
            savePreset: 'MINER_AT_VARROCK',
            notes: 'Bronze pickaxe in inventory, spawned at SE Varrock mine.',
        },
        success: [
            { kind: 'inventory_contains', item: 'Copper ore|Tin ore', count: 1 },
            { kind: 'xp_gained', skill: 'Mining', minXp: 1 },
        ],
    },
];
