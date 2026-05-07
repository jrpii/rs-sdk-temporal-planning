import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { BotWorldState } from '../sdk/types';

export type KnowledgeBaseSchemaVersion = 1;

export interface KnowledgeBaseLoc {
    id: number;
    lastSeenTick: number;
    seenCount: number;
    /** Union of observed option text. */
    options: string[];
    /** Distinct observed coordinates (deduped). */
    positions: Array<{ x: number; z: number; level: number }>;
}

export interface KnowledgeBaseNpc {
    combatLevel: number;
    lastSeenTick: number;
    seenCount: number;
    options: string[];
    positions: Array<{ x: number; z: number; level: number }>;
}

export interface KnowledgeBaseData {
    schemaVersion: KnowledgeBaseSchemaVersion;
    updatedAt: string;
    locsByName: Record<string, {
        name: string;
        byId: Record<string, KnowledgeBaseLoc>;
    }>;
    /** NPCs grouped by name; variants keyed by combatLevel+level+optionsKey (coordinates excluded). */
    npcsByName: Record<string, {
        name: string;
        variants: Record<string, KnowledgeBaseNpc>;
    }>;
}

function uniq<T>(values: T[]): T[] {
    return [...new Set(values)];
}

function posKey(pos: { x: number; z: number; level: number }): string {
    return `${pos.level}:${pos.x}:${pos.z}`;
}

function mergePositions(
    existing: Array<{ x: number; z: number; level: number }>,
    incoming: { x: number; z: number; level: number },
): Array<{ x: number; z: number; level: number }> {
    const map = new Map(existing.map(p => [posKey(p), p]));
    map.set(posKey(incoming), incoming);
    return [...map.values()];
}

function optionsKey(options: string[]): string {
    return options.map(o => o.trim()).filter(Boolean).slice(0, 8).join('|');
}

export class KnowledgeBase {
    private data: KnowledgeBaseData;

    constructor(existing?: KnowledgeBaseData) {
        this.data = existing ?? {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            locsByName: {},
            npcsByName: {},
        };
    }

    static load(path: string): KnowledgeBase {
        try {
            const raw = JSON.parse(readFileSync(path, 'utf8')) as KnowledgeBaseData;
            if (!raw || raw.schemaVersion !== 1) return new KnowledgeBase();
            return new KnowledgeBase(raw);
        } catch {
            return new KnowledgeBase();
        }
    }

    observe(state: BotWorldState | null | undefined): void {
        if (!state?.inGame) return;
        const level = state.player?.level ?? 0;
        const tick = state.tick ?? 0;

        for (const loc of state.nearbyLocs ?? []) {
            const nameKey = String(loc.name ?? '').trim();
            const byName = this.data.locsByName[nameKey] ?? (this.data.locsByName[nameKey] = { name: loc.name, byId: {} });
            const idKey = String(loc.id);
            const prev = byName.byId[idKey];
            const options = (loc.options ?? []).slice(0, 12);
            const pos = { x: loc.x, z: loc.z, level };
            if (!prev) {
                byName.byId[idKey] = {
                    id: loc.id,
                    lastSeenTick: tick,
                    seenCount: 1,
                    options,
                    positions: [pos],
                };
            } else {
                prev.lastSeenTick = tick;
                prev.seenCount += 1;
                prev.options = uniq([...(prev.options ?? []), ...options]);
                prev.positions = mergePositions(prev.positions ?? [], pos);
            }
        }

        for (const npc of state.nearbyNpcs ?? []) {
            const options = (npc.options ?? []).slice(0, 12);
            const nameKey = String(npc.name ?? '').trim();
            if (!nameKey) continue;
            const variantKey = `${npc.combatLevel ?? 0}|${level}|${optionsKey(options)}`;
            const group = this.data.npcsByName[nameKey] ?? (this.data.npcsByName[nameKey] = { name: npc.name, variants: {} });
            const prev = group.variants[variantKey];
            const pos = { x: npc.x, z: npc.z, level };
            if (!prev) {
                group.variants[variantKey] = {
                    combatLevel: npc.combatLevel ?? 0,
                    lastSeenTick: tick,
                    seenCount: 1,
                    options,
                    positions: [pos],
                };
            } else {
                prev.lastSeenTick = tick;
                prev.seenCount += 1;
                prev.options = uniq([...(prev.options ?? []), ...options]);
                prev.positions = mergePositions(prev.positions ?? [], pos);
            }
        }

        this.data.updatedAt = new Date().toISOString();
    }

    mergeFrom(other: KnowledgeBase): void {
        const incoming = other.toJSON();
        for (const [name, group] of Object.entries(incoming.locsByName ?? {})) {
            const targetGroup = this.data.locsByName[name] ?? (this.data.locsByName[name] = { name: group.name, byId: {} });
            for (const [id, loc] of Object.entries(group.byId ?? {})) {
                const prev = targetGroup.byId[id];
                if (!prev) {
                    targetGroup.byId[id] = loc;
                    continue;
                }
                prev.lastSeenTick = Math.max(prev.lastSeenTick, loc.lastSeenTick);
                prev.seenCount += loc.seenCount ?? 0;
                prev.options = uniq([...(prev.options ?? []), ...(loc.options ?? [])]);
                for (const pos of loc.positions ?? []) {
                    prev.positions = mergePositions(prev.positions ?? [], pos);
                }
            }
        }
        for (const [name, group] of Object.entries(incoming.npcsByName ?? {})) {
            const targetGroup = this.data.npcsByName[name] ?? (this.data.npcsByName[name] = { name: group.name, variants: {} });
            for (const [variantKey, npc] of Object.entries(group.variants ?? {})) {
                const prev = targetGroup.variants[variantKey];
                if (!prev) {
                    targetGroup.variants[variantKey] = npc;
                    continue;
                }
                prev.lastSeenTick = Math.max(prev.lastSeenTick, npc.lastSeenTick);
                prev.seenCount += npc.seenCount ?? 0;
                prev.options = uniq([...(prev.options ?? []), ...(npc.options ?? [])]);
                for (const pos of npc.positions ?? []) {
                    prev.positions = mergePositions(prev.positions ?? [], pos);
                }
            }
        }
        this.data.updatedAt = new Date().toISOString();
    }

    findLocPositionsByNamePattern(pattern: RegExp): Array<{ name: string; id: number; x: number; z: number; level: number; lastSeenTick: number }> {
        const out: Array<{ name: string; id: number; x: number; z: number; level: number; lastSeenTick: number }> = [];
        for (const [name, group] of Object.entries(this.data.locsByName ?? {})) {
            if (!pattern.test(name)) continue;
            for (const loc of Object.values(group.byId ?? {})) {
                for (const pos of loc.positions ?? []) {
                    out.push({ name, id: loc.id, x: pos.x, z: pos.z, level: pos.level, lastSeenTick: loc.lastSeenTick });
                }
            }
        }
        return out;
    }

    toJSON(): KnowledgeBaseData {
        return this.data;
    }

    save(path: string): void {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(this.data, null, 2));
    }
}

