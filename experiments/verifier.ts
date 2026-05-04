import type { StateDelta, StateSummary, VerifierResult, VerifierSpec } from './schemas';

function countOf(summary: StateSummary, item: string): number {
    const pattern = new RegExp(item, 'i');
    for (const [name, count] of Object.entries(summary.inventory)) {
        if (pattern.test(name)) return count;
    }
    return 0;
}

function matchesMessage(summary: StateSummary, pattern: string): boolean {
    const regex = new RegExp(pattern, 'i');
    return summary.recentMessages.some(message => regex.test(message));
}

export function evaluateVerifier(summary: StateSummary, spec: VerifierSpec, delta?: StateDelta): { pass: boolean; evidence: string } {
    switch (spec.kind) {
        case 'inventory_contains': {
            const count = countOf(summary, spec.item);
            const needed = spec.count ?? 1;
            return { pass: count >= needed, evidence: `inventory ${spec.item}: ${count}/${needed}` };
        }
        case 'inventory_lacks': {
            const count = countOf(summary, spec.item);
            return { pass: count === 0, evidence: `inventory ${spec.item}: ${count}` };
        }
        case 'xp_gained': {
            const xp = delta?.xpGained[spec.skill] ?? 0;
            return { pass: xp >= (spec.minXp ?? 1), evidence: `${spec.skill} xp gained: ${xp}` };
        }
        case 'level_at_least': {
            const level = summary.skills[spec.skill]?.baseLevel ?? 0;
            return { pass: level >= spec.level, evidence: `${spec.skill} level: ${level}/${spec.level}` };
        }
        case 'position_within': {
            const pos = summary.position;
            const distance = pos ? Math.max(Math.abs(pos.x - spec.x), Math.abs(pos.z - spec.z)) : Infinity;
            const levelOk = spec.level === undefined || pos?.level === spec.level;
            return { pass: distance <= spec.tolerance && levelOk, evidence: `position distance: ${distance}, level ok: ${levelOk}` };
        }
        case 'ui_open': {
            const map = {
                dialog: summary.ui.dialogOpen,
                interface: summary.ui.interfaceOpen,
                shop: summary.ui.shopOpen,
                bank: summary.ui.bankOpen,
                modal: summary.ui.modalOpen,
            };
            return { pass: map[spec.ui], evidence: `${spec.ui} open: ${map[spec.ui]}` };
        }
        case 'message_matches':
            return { pass: matchesMessage(summary, spec.pattern), evidence: `message matches /${spec.pattern}/i` };
    }
}

export function evaluateVerifiers(summary: StateSummary, specs: VerifierSpec[], delta?: StateDelta): VerifierResult {
    const passed: VerifierSpec[] = [];
    const failed: VerifierSpec[] = [];
    const evidence: string[] = [];

    for (const spec of specs) {
        const result = evaluateVerifier(summary, spec, delta);
        evidence.push(result.evidence);
        if (result.pass) {
            passed.push(spec);
        } else {
            failed.push(spec);
        }
    }

    return {
        success: failed.length === 0,
        passed,
        failed,
        evidence,
    };
}
