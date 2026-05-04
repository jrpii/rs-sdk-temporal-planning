import type { BotWorldState } from '../sdk/types';
import type { StateDelta, StateSummary } from './schemas';

function addCount(target: Record<string, number>, name: string, count: number): void {
    target[name] = (target[name] ?? 0) + count;
}

function diffCounts(before: Record<string, number>, after: Record<string, number>): {
    added: Record<string, number>;
    removed: Record<string, number>;
} {
    const added: Record<string, number> = {};
    const removed: Record<string, number> = {};
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const name of names) {
        const delta = (after[name] ?? 0) - (before[name] ?? 0);
        if (delta > 0) added[name] = delta;
        if (delta < 0) removed[name] = Math.abs(delta);
    }

    return { added, removed };
}

function uiFlags(summary: StateSummary): Record<string, boolean> {
    return {
        dialogOpen: summary.ui.dialogOpen,
        interfaceOpen: summary.ui.interfaceOpen,
        shopOpen: summary.ui.shopOpen,
        bankOpen: summary.ui.bankOpen,
        modalOpen: summary.ui.modalOpen,
    };
}

export function summarizeState(state: BotWorldState): StateSummary {
    const inventory: Record<string, number> = {};
    for (const item of state.inventory) {
        addCount(inventory, item.name, item.count);
    }

    const skills: StateSummary['skills'] = {};
    for (const skill of state.skills) {
        skills[skill.name] = {
            level: skill.level,
            baseLevel: skill.baseLevel,
            xp: skill.experience,
        };
    }

    const player = state.player;

    return {
        tick: state.tick,
        inGame: state.inGame,
        position: player ? { x: player.worldX, z: player.worldZ, level: player.level } : undefined,
        hp: player ? { current: player.hp, max: player.maxHp } : undefined,
        run: player ? { energy: player.runEnergy, weight: player.runWeight } : undefined,
        combat: player ? {
            inCombat: player.combat.inCombat,
            targetIndex: player.combat.targetIndex,
            lastDamageTick: player.combat.lastDamageTick,
        } : undefined,
        skills,
        inventory,
        equipment: state.equipment.map(item => item.name),
        nearbyNpcs: state.nearbyNpcs.slice(0, 20).map(npc => ({
            name: npc.name,
            distance: npc.distance,
            options: npc.options,
            combatLevel: npc.combatLevel || undefined,
        })),
        nearbyLocs: state.nearbyLocs.slice(0, 30).map(loc => ({
            name: loc.name,
            distance: loc.distance,
            options: loc.options,
        })),
        groundItems: state.groundItems.slice(0, 30).map(item => ({
            name: item.name,
            count: item.count,
            distance: item.distance,
        })),
        ui: {
            dialogOpen: state.dialog.isOpen,
            interfaceOpen: state.interface.isOpen,
            shopOpen: state.shop.isOpen,
            bankOpen: state.bank.isOpen,
            modalOpen: state.modalOpen,
        },
        recentMessages: state.gameMessages.slice(-12).map(message => message.text),
    };
}

export function diffStateSummaries(before: StateSummary, after: StateSummary): StateDelta {
    const inventoryDiff = diffCounts(before.inventory, after.inventory);
    const beforeEquipment = new Set(before.equipment);
    const afterEquipment = new Set(after.equipment);

    const xpGained: Record<string, number> = {};
    const levelChanges: Record<string, { before: number; after: number }> = {};
    const skillNames = new Set([...Object.keys(before.skills), ...Object.keys(after.skills)]);
    for (const skillName of skillNames) {
        const oldSkill = before.skills[skillName];
        const newSkill = after.skills[skillName];
        if (!oldSkill || !newSkill) continue;

        const xpDelta = newSkill.xp - oldSkill.xp;
        if (xpDelta > 0) xpGained[skillName] = xpDelta;
        if (newSkill.baseLevel !== oldSkill.baseLevel) {
            levelChanges[skillName] = { before: oldSkill.baseLevel, after: newSkill.baseLevel };
        }
    }

    const beforeUi = uiFlags(before);
    const afterUi = uiFlags(after);
    const uiChanges = Object.keys(beforeUi)
        .filter(key => beforeUi[key] !== afterUi[key])
        .map(key => `${key}:${beforeUi[key]}->${afterUi[key]}`);

    const beforeMessages = new Set(before.recentMessages);
    const newMessages = after.recentMessages.filter(message => !beforeMessages.has(message));

    return {
        ticksElapsed: after.tick - before.tick,
        positionChanged: JSON.stringify(before.position) !== JSON.stringify(after.position),
        inventoryAdded: inventoryDiff.added,
        inventoryRemoved: inventoryDiff.removed,
        equipmentAdded: [...afterEquipment].filter(name => !beforeEquipment.has(name)),
        equipmentRemoved: [...beforeEquipment].filter(name => !afterEquipment.has(name)),
        xpGained,
        levelChanges,
        uiChanges,
        newMessages,
    };
}
