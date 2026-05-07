#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import type { ActionResult, BotWorldState, NearbyLoc } from '../sdk/types';
import { connectExperimentBot } from './connect';
import { buildDiscoveryPlanSteps } from './discovery-plan';
import { KnowledgeBase } from './knowledge-base';
import { ACTION_DOCS, appendDomainLessons, defaultDomainForTask, effect, predicate, sanitizeLearnedDomainModel } from './domain-model';
import { chatCompletion, extractJsonObject } from './llm';
import { exportPddl } from './pddl';
import { createPlanner } from './planner';
import {
    appendTransitionRecord,
    buildTransitionRecord,
    observedWorldObjectsFromState,
    resolveTransitionLogPaths,
} from './transition-log';
import type {
    AgenticReplanEvent,
    DiscoveryPhaseMeta,
    DomainEffect,
    DomainPredicate,
    EpisodeTrace,
    ExecutionPhase,
    ExecutionStep,
    LearnedDomainModel,
    LearnedActionSchema,
    LearnedDomainLesson,
    PlannerMethod,
    PlanStep,
    StateSummary,
    TaskSpec,
} from './schemas';
import { diffStateSummaries, summarizeState } from './state-summary';
import { evaluateVerifiers } from './verifier';

function usage(exitCode = 1): never {
    console.log(`
Run one experiment episode from a TaskSpec JSON file.

Usage:
  bun experiments/run-episode.ts <task.json> --bot McPlan [--method few_shot] [--model none] [--domain model.json] [--server localhost] [--api http://localhost:8888] [--api-base http://127.0.0.1:11434/v1] [--force-run] [--agentic-replan] [--agentic-explore] [--replan-rag] [--max-replans 2] [--max-steps 10] [--ready-timeout 30000] [--out runs/traces]
         [--scripted-planner] [--no-discovery-on-empty-plan] [--discovery-max-steps N]
         [--no-transition-log-global] [--transition-log-global PATH] [--transition-log-task] [--transition-log-task-dir DIR] [--transition-log-trial PATH]

Example:
  bun experiments/run-episode.ts experiments/task-presets/cook-shrimp-alkharid.json --bot McPlan --method few_shot --server localhost

Before running a checkpointed task, install and relog the save:
  bun experiments/load-save.ts McPlan runs/checkpoints/McPlan-cook-shrimp-alkharid.sav --api http://localhost:8888
  bun sdk/cli.ts McPlan --server localhost --timeout 15000 --launch
`.trim());
    process.exit(exitCode);
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);

    const taskPath = args.find(arg => !arg.startsWith('-'));
    let botName = '';
    let method: PlannerMethod = 'few_shot';
    let modelName = 'none';
    let domainPath = '';
    let server = 'localhost';
    let api = 'http://localhost:8888';
    let apiBase = 'http://127.0.0.1:11434/v1';
    let forceRun = false;
    let agenticReplan = false;
    let agenticExplore = false;
    let replanRag = false;
    let maxReplans = 2;
    let outDir = join('runs', 'traces');
    let maxStepsOverride: number | undefined;
    let readyTimeout = 15_000;
    let discoveryOnEmptyPlan = true;
    let discoveryMaxSteps = 0;
    let scriptedPlanner = false;
    let transitionLogGlobalDisabled = false;
    let transitionLogGlobalPath = join('runs', 'transitions', 'global.jsonl');
    let transitionLogTaskIsolated = false;
    let transitionLogTaskDir = join('runs', 'transitions');
    let transitionLogTrialPath = '';
    let kbGlobalDisabled = false;
    let kbGlobalPath = join('runs', 'kb', 'global.json');
    let kbTaskIsolated = false;
    let kbTaskDir = join('runs', 'kb');
    let kbTrialPath = '';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--bot') {
            botName = args[++i] ?? '';
        } else if (arg === '--method') {
            method = (args[++i] ?? method) as PlannerMethod;
        } else if (arg === '--model') {
            modelName = args[++i] ?? modelName;
        } else if (arg === '--domain') {
            domainPath = args[++i] ?? '';
        } else if (arg === '--server') {
            server = args[++i] ?? server;
        } else if (arg === '--api') {
            api = args[++i] ?? api;
        } else if (arg === '--api-base') {
            apiBase = args[++i] ?? apiBase;
        } else if (arg === '--force-run') {
            forceRun = true;
        } else if (arg === '--agentic-replan') {
            agenticReplan = true;
        } else if (arg === '--agentic-explore') {
            agenticExplore = true;
        } else if (arg === '--replan-rag') {
            replanRag = true;
        } else if (arg === '--max-replans') {
            maxReplans = Number(args[++i] ?? maxReplans);
        } else if (arg === '--max-steps') {
            maxStepsOverride = Number(args[++i]);
        } else if (arg === '--ready-timeout') {
            readyTimeout = Number(args[++i] ?? readyTimeout);
        } else if (arg === '--out') {
            outDir = args[++i] ?? outDir;
        } else if (arg === '--no-discovery-on-empty-plan') {
            discoveryOnEmptyPlan = false;
        } else if (arg === '--discovery-max-steps') {
            discoveryMaxSteps = Number(args[++i] ?? '0');
        } else if (arg === '--scripted-planner') {
            scriptedPlanner = true;
        } else if (arg === '--no-transition-log-global') {
            transitionLogGlobalDisabled = true;
        } else if (arg === '--transition-log-global') {
            transitionLogGlobalPath = args[++i] ?? transitionLogGlobalPath;
        } else if (arg === '--transition-log-task') {
            transitionLogTaskIsolated = true;
        } else if (arg === '--transition-log-task-dir') {
            transitionLogTaskDir = args[++i] ?? transitionLogTaskDir;
        } else if (arg === '--transition-log-trial') {
            transitionLogTrialPath = args[++i] ?? '';
        } else if (arg === '--no-kb-global') {
            kbGlobalDisabled = true;
        } else if (arg === '--kb-global') {
            kbGlobalPath = args[++i] ?? kbGlobalPath;
        } else if (arg === '--kb-task') {
            kbTaskIsolated = true;
        } else if (arg === '--kb-task-dir') {
            kbTaskDir = args[++i] ?? kbTaskDir;
        } else if (arg === '--kb-trial') {
            kbTrialPath = args[++i] ?? '';
        }
    }

    if (!taskPath || !botName) usage();
    if (!['few_shot', 'static_rag', 'learned_domain', 'pddl'].includes(method)) {
        throw new Error(`Unknown method: ${method}`);
    }

    return {
        taskPath,
        botName,
        method,
        modelName,
        domainPath,
        server,
        api,
        apiBase,
        forceRun,
        agenticReplan,
        agenticExplore,
        replanRag,
        maxReplans,
        outDir,
        maxStepsOverride,
        readyTimeout,
        discoveryOnEmptyPlan,
        discoveryMaxSteps,
        scriptedPlanner,
        transitionLogGlobalDisabled,
        transitionLogGlobalPath,
        transitionLogTaskIsolated,
        transitionLogTaskDir,
        transitionLogTrialPath,
        kbGlobalDisabled,
        kbGlobalPath,
        kbTaskIsolated,
        kbTaskDir,
        kbTrialPath,
    };
}

function readTask(path: string): TaskSpec {
    return JSON.parse(readFileSync(path, 'utf8')) as TaskSpec;
}

function readDomain(path: string): LearnedDomainModel | undefined {
    if (!path) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as LearnedDomainModel;
}

function inventoryCount(state: BotWorldState, pattern: RegExp): number {
    return state.inventory
        .filter(item => pattern.test(item.name))
        .reduce((total, item) => total + item.count, 0);
}

function skillXp(state: BotWorldState, skillName: string): number {
    return state.skills.find(skill => skill.name.toLowerCase() === skillName.toLowerCase())?.experience ?? 0;
}

function findCookingSource(state: BotWorldState): NearbyLoc | null {
    const sources = state.nearbyLocs
        .filter(loc => /^(Range|Fire)$/i.test(loc.name))
        .sort((a, b) => a.distance - b.distance);
    return sources[0] ?? null;
}

function findCookingSourceInLocs(locs: NearbyLoc[]): NearbyLoc | null {
    return locs
        .filter(loc => /^(Range|Fire)$/i.test(loc.name))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function findOpenDoor(state: BotWorldState): NearbyLoc | null {
    return state.nearbyLocs
        .filter(loc => /door|gate/i.test(loc.name))
        .filter(loc => loc.optionsWithIndex.some(option => /^open$/i.test(option.text)))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
}

function shouldAttemptReachabilityRecovery(result: ActionResult): boolean {
    return !result.success && /cannot reach|can't reach|cant reach|out of reach|could not walk/i.test(result.message);
}

function shouldAttemptAgenticReplan(result: ActionResult, verifierSuccess: boolean): boolean {
    if (verifierSuccess) return false;
    if (result.success) {
        // Stochastic burn still consumes a shrimp and is not a "stuck" state for LLM replan; retry next cook step.
        if (/burn|burnt|burned/i.test(result.message)) {
            return false;
        }
        return /no detected product|no progress|timed out/i.test(result.message);
    }
    return true;
}

async function currentSummary(conn: Awaited<ReturnType<typeof connectExperimentBot>>, timeout = 15_000): Promise<StateSummary> {
    const state = await conn.sdk.waitForCondition(
        s => s.inGame && Boolean(s.player) && (s.nearbyLocs.length > 0 || s.nearbyNpcs.length > 0),
        timeout,
    );
    return summarizeState(state);
}

// This is VERY hard coded for the shrimp task. Bounded probe is deterministic. Would need to be more generic for other tasks...
function extractTargetLocPattern(step: PlanStep): RegExp | null {
    const raw = step.actionParams?.targetLocNamePattern;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            return new RegExp(raw, 'i');
        } catch {
            return null;
        }
    }
    return null;
}

async function executeStep(
    conn: Awaited<ReturnType<typeof connectExperimentBot>>,
    step: PlanStep,
    kb?: KnowledgeBase,
    domainModel?: LearnedDomainModel,
): Promise<ActionResult> {
    if (step.actionSchemaId === 'wait_ticks') {
        const ticks = Number(step.actionParams?.ticks ?? 1);
        if (!Number.isFinite(ticks) || ticks <= 0) {
            return { success: false, message: `wait_ticks invalid ticks=${String(step.actionParams?.ticks)}` };
        }
        await conn.sdk.waitForTicks(Math.min(50, Math.floor(ticks)));
        return { success: true, message: `Waited ${Math.min(50, Math.floor(ticks))} tick(s)` };
    }

    if (step.actionSchemaId === 'walk_to') {
        const x = Number(step.actionParams?.x);
        const z = Number(step.actionParams?.z);
        const toleranceRaw = step.actionParams?.tolerance;
        const tolerance = typeof toleranceRaw === 'number' ? toleranceRaw : Number(toleranceRaw ?? 3);
        if (!Number.isFinite(x) || !Number.isFinite(z)) {
            return { success: false, message: 'walk_to missing numeric actionParams.x/z' };
        }
        return await conn.bot.walkTo(Math.floor(x), Math.floor(z), Number.isFinite(tolerance) ? tolerance : 3);
    }

    if (step.actionSchemaId === 'explore_for_cooking_source' || step.actionSchemaId === 'explore_for_loc') {
        const state = conn.sdk.getState();
        if (!state?.player) return { success: false, message: 'No game state available' };

        const extracted = extractTargetLocPattern(step);
        if (step.actionSchemaId === 'explore_for_loc' && !extracted) {
            return { success: false, message: 'explore_for_loc missing actionParams.targetLocNamePattern' };
        }
        const targetPattern = extracted ?? /^(Range|Fire)$/i;

        // 0) Prefer LLM-written knownFacilities if present.
        // Safety: ignore placeholder/bogus coordinates from LLM (commonly x=0,z=0 with low confidence).
        if (domainModel?.knownFacilities?.length) {
            const candidates = domainModel.knownFacilities
                .filter(f => {
                    if (f.level !== state.player!.level) return false;
                    if (!Number.isFinite(f.x) || !Number.isFinite(f.z)) return false;
                    if ((f.x === 0 && f.z === 0) || (f.confidence ?? 0) <= 0) return false;
                    // Extra conservative guard: ignore extremely low-confidence entries.
                    if ((f.confidence ?? 0) < 0.05) return false;
                    try {
                        return targetPattern.test(f.namePattern);
                    } catch {
                        return false;
                    }
                })
                .sort((a, b) => {
                    const da = Math.max(Math.abs(a.x - state.player!.worldX), Math.abs(a.z - state.player!.worldZ));
                    const db = Math.max(Math.abs(b.x - state.player!.worldX), Math.abs(b.z - state.player!.worldZ));
                    return da - db;
                });
            if (candidates.length > 0) {
                const best = candidates[0]!;
                const walkResult = await conn.bot.walkTo(best.x, best.z, 3);
                return {
                    ...walkResult,
                    message: `Exploration used knownFacilities target ${best.namePattern} at (${best.x}, ${best.z}): ${walkResult.message}`,
                };
            }
        }

        // 1) If KB has a known target location, bias movement to the nearest known coordinate first.
        if (kb) {
            const candidates = kb.findLocPositionsByNamePattern(targetPattern)
                .filter(p => p.level === state.player!.level);
            if (candidates.length > 0) {
                candidates.sort((a, b) => {
                    const da = Math.max(Math.abs(a.x - state.player!.worldX), Math.abs(a.z - state.player!.worldZ));
                    const db = Math.max(Math.abs(b.x - state.player!.worldX), Math.abs(b.z - state.player!.worldZ));
                    return da - db;
                });
                const best = candidates[0]!;
                const walkResult = await conn.bot.walkTo(best.x, best.z, 3);
                return {
                    ...walkResult,
                    message: `Exploration used KB target ${best.name} at (${best.x}, ${best.z}): ${walkResult.message}`,
                };
            }
        }

        const existingSource = findCookingSource(state);
        if (existingSource) {
            const walkResult = await conn.bot.walkTo(existingSource.x, existingSource.z, 3);
            return {
                ...walkResult,
                message: `Exploration found visible ${existingSource.name}: ${walkResult.message}`,
            };
        }

        const scannedLocs = await conn.sdk.scanNearbyLocs(30);
        const scannedSource = scannedLocs
            .filter(loc => targetPattern.test(loc.name))
            .sort((a, b) => a.distance - b.distance)[0] ?? null;
        if (scannedSource) {
            const walkResult = await conn.bot.walkTo(scannedSource.x, scannedSource.z, 3);
            return {
                ...walkResult,
                message: `Exploration scanned ${scannedSource.name} at (${scannedSource.x}, ${scannedSource.z}): ${walkResult.message}`,
            };
        }

        const openDoor = findOpenDoor(state) ?? scannedLocs
            .filter(loc => /door|gate/i.test(loc.name))
            .filter(loc => loc.optionsWithIndex.some(option => /^open$/i.test(option.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (openDoor) {
            const doorResult = await conn.bot.openDoor(openDoor);
            if (!doorResult.success) {
                return { ...doorResult, message: `Exploration tried ${openDoor.name}: ${doorResult.message}` };
            }
            await conn.sdk.waitForTicks(1);
            const afterDoorState = conn.sdk.getState() ?? state;
            const afterDoorSource = afterDoorState.nearbyLocs
                .filter(loc => targetPattern.test(loc.name))
                .sort((a, b) => a.distance - b.distance)[0]
                ?? (await conn.sdk.scanNearbyLocs(30))
                    .filter(loc => targetPattern.test(loc.name))
                    .sort((a, b) => a.distance - b.distance)[0];
            if (afterDoorSource) {
                const walkResult = await conn.bot.walkTo(afterDoorSource.x, afterDoorSource.z, 3);
                return {
                    ...walkResult,
                    message: `Exploration opened ${openDoor.name} and found ${afterDoorSource.name}: ${walkResult.message}`,
                };
            }
            return { success: true, message: `Exploration opened ${openDoor.name}; no cooking source visible yet` };
        }

        const probes = [
            { x: state.player.worldX + 6, z: state.player.worldZ },
            { x: state.player.worldX, z: state.player.worldZ + 6 },
            { x: state.player.worldX - 6, z: state.player.worldZ },
            { x: state.player.worldX, z: state.player.worldZ - 6 },
        ];
        for (const probe of probes) {
            const walkResult = await conn.bot.walkTo(probe.x, probe.z, 3);
            if (!walkResult.success) continue;
            const source = (conn.sdk.getState() ?? state).nearbyLocs
                .filter(loc => targetPattern.test(loc.name))
                .sort((a, b) => a.distance - b.distance)[0]
                ?? (await conn.sdk.scanNearbyLocs(30))
                    .filter(loc => targetPattern.test(loc.name))
                    .sort((a, b) => a.distance - b.distance)[0];
            if (source) {
                return { success: true, message: `Exploration probe found ${source.name} at (${source.x}, ${source.z})` };
            }
        }

        return { success: false, message: `Exploration did not find target locs matching ${targetPattern} within bounded probes` };
    }

    if (step.actionSchemaId === 'open_nearby_door') {
        const state = conn.sdk.getState();
        if (!state) return { success: false, message: 'No game state available' };

        const door = findOpenDoor(state) ?? await conn.sdk.scanFindNearbyLoc(/door|gate/i, 12);
        if (!door) return { success: false, message: 'No nearby door or gate found for reachability recovery' };

        const result = await conn.bot.openDoor(door);
        return {
            ...result,
            message: `Reachability recovery via ${door.name}: ${result.message}`,
        };
    }

    if (step.actionSchemaId === 'interact_loc') {
        const state = conn.sdk.getState();
        if (!state?.player) return { success: false, message: 'No game state available' };
        const locName = String(step.actionParams?.locNamePattern ?? step.actionParams?.locName ?? '').trim();
        const optionText = String(step.actionParams?.option ?? step.actionParams?.optionPattern ?? '').trim();
        if (!locName) return { success: false, message: 'interact_loc missing actionParams.locNamePattern' };
        if (!optionText) return { success: false, message: 'interact_loc missing actionParams.option/optionPattern' };
        const locRegex = new RegExp(locName, 'i');
        const optRegex = new RegExp(optionText, 'i');
        const target = state.nearbyLocs.find(l => locRegex.test(l.name) && l.optionsWithIndex.some(o => optRegex.test(o.text)))
            ?? (await conn.sdk.scanNearbyLocs(30)).find(l => locRegex.test(l.name) && l.optionsWithIndex.some(o => optRegex.test(o.text)));
        if (!target) return { success: false, message: `No loc found matching ${locRegex} with option ${optRegex}` };
        const opt = target.optionsWithIndex.find(o => optRegex.test(o.text));
        if (!opt) return { success: false, message: `Loc ${target.name} missing option ${optRegex}` };
        const result = await conn.bot.interactLoc(target, opt.text);
        return result;
    }

    if (step.actionSchemaId === 'interact_npc') {
        const state = conn.sdk.getState();
        if (!state?.player) return { success: false, message: 'No game state available' };
        const npcName = String(step.actionParams?.npcNamePattern ?? step.actionParams?.npcName ?? '').trim();
        const optionText = String(step.actionParams?.option ?? step.actionParams?.optionPattern ?? '').trim();
        if (!npcName) return { success: false, message: 'interact_npc missing actionParams.npcNamePattern' };
        if (!optionText) return { success: false, message: 'interact_npc missing actionParams.option/optionPattern' };
        const npcRegex = new RegExp(npcName, 'i');
        const optRegex = new RegExp(optionText, 'i');
        const target = state.nearbyNpcs.find(n => npcRegex.test(n.name) && n.optionsWithIndex.some(o => optRegex.test(o.text)));
        if (!target) return { success: false, message: `No npc found matching ${npcRegex} with option ${optRegex}` };
        const opt = target.optionsWithIndex.find(o => optRegex.test(o.text));
        if (!opt) return { success: false, message: `Npc ${target.name} missing option ${optRegex}` };
        return await conn.bot.interactNpc(target, opt.text);
    }

    if (step.actionSchemaId === 'use_item_on_loc') {
        const state = conn.sdk.getState();
        if (!state?.player) return { success: false, message: 'No game state available' };
        const itemName = String(step.actionParams?.itemNamePattern ?? step.actionParams?.itemName ?? '').trim();
        const locName = String(step.actionParams?.locNamePattern ?? step.actionParams?.locName ?? '').trim();
        const locId = step.actionParams?.locId;
        if (!itemName) return { success: false, message: 'use_item_on_loc missing actionParams.itemNamePattern' };
        if (!locName) return { success: false, message: 'use_item_on_loc missing actionParams.locNamePattern' };
        const item = conn.sdk.findInventoryItem(new RegExp(itemName, 'i'));
        if (!item) return { success: false, message: `Missing inventory item matching /${itemName}/i` };
        const locRegex = new RegExp(locName, 'i');
        const candidates = [...state.nearbyLocs, ...(await conn.sdk.scanNearbyLocs(30))]
            .filter(l => locRegex.test(l.name))
            .filter(l => (typeof locId === 'number' ? l.id === locId : true))
            .sort((a, b) => a.distance - b.distance);
        const target = candidates[0];
        if (!target) return { success: false, message: `No loc found matching /${locName}/i` };
        return await conn.bot.useItemOnLoc(item, target);
    }

    if (step.actionSchemaId === 'pickup_ground_item') {
        const state = conn.sdk.getState();
        if (!state?.player) return { success: false, message: 'No game state available' };
        const itemName = String(step.actionParams?.itemNamePattern ?? step.actionParams?.itemName ?? '').trim();
        if (!itemName) return { success: false, message: 'pickup_ground_item missing actionParams.itemNamePattern' };
        const regex = new RegExp(itemName, 'i');
        const initialItem = state.groundItems.find(g => regex.test(g.name))
            ?? (await conn.sdk.scanGroundItems(12)).find(g => regex.test(g.name));
        if (initialItem) return await conn.bot.pickupItem(initialItem);

        // Generic delayed-drop handling:
        // Sometimes mining/chopping/cooking produces the drop with a small delay.
        // If pickup is attempted too early, wait briefly for the ground item to appear and retry once.
        try {
            await conn.sdk.waitForCondition(
                s => (s.groundItems ?? []).some(g => regex.test(g.name)),
                6_000,
            );
            const retryState = conn.sdk.getState() ?? state;
            const retryItem = retryState.groundItems.find(g => regex.test(g.name))
                ?? (await conn.sdk.scanGroundItems(12)).find(g => regex.test(g.name));
            if (retryItem) return await conn.bot.pickupItem(retryItem);
        } catch {
            // Timed out waiting for the ground item to appear.
        }

        return { success: false, message: `No ground item found matching ${regex}` };
    }

    if (step.actionSchemaId !== 'use_item_on_cooking_source') {
        return { success: false, message: `No executor for action schema: ${step.actionSchemaId ?? 'unknown'}` };
    }

    const beforeState = conn.sdk.getState();
    if (!beforeState) return { success: false, message: 'No game state available' };

    const rawCountBefore = inventoryCount(beforeState, /^Raw shrimps$/i);
    const cookedCountBefore = inventoryCount(beforeState, /^Shrimps$/i);
    const burntCountBefore = inventoryCount(beforeState, /^Burnt (fish|shrimp|shrimps)$/i);
    const cookingXpBefore = skillXp(beforeState, 'Cooking');

    const raw = conn.sdk.findInventoryItem(/^Raw shrimps$/i);
    if (!raw) return { success: false, message: 'Missing Raw shrimps in inventory' };

    let range = findCookingSource(beforeState);
    if (!range) {
        const scanned = await conn.sdk.scanNearbyLocs(30);
        range = findCookingSourceInLocs(scanned);
    }
    if (!range) return { success: false, message: 'No nearby range or fire found' };

    if (range.distance > 3) {
        const walkResult = await conn.bot.walkTo(range.x, range.z, 3);
        if (!walkResult.success) {
            return { success: false, message: `Cannot reach ${range.name}: ${walkResult.message}` };
        }
    }

    const live = conn.sdk.getState() ?? beforeState;
    let sourceNow = findCookingSource(live) ?? findCookingSourceInLocs(await conn.sdk.scanNearbyLocs(30));
    if (!sourceNow) return { success: false, message: `${range.name} no longer visible` };

    const sendResult = await conn.sdk.sendUseItemOnLoc(raw.slot, sourceNow.x, sourceNow.z, sourceNow.id);
    if (!sendResult.success) return sendResult;

    try {
        const afterState = await conn.sdk.waitForCondition(state => {
            return (
                inventoryCount(state, /^Raw shrimps$/i) < rawCountBefore ||
                inventoryCount(state, /^Shrimps$/i) > cookedCountBefore ||
                inventoryCount(state, /^Burnt (fish|shrimp|shrimps)$/i) > burntCountBefore ||
                skillXp(state, 'Cooking') > cookingXpBefore
            );
        }, 15_000);

        const cookedDelta = inventoryCount(afterState, /^Shrimps$/i) - cookedCountBefore;
        const burntDelta = inventoryCount(afterState, /^Burnt (fish|shrimp|shrimps)$/i) - burntCountBefore;
        const xpDelta = skillXp(afterState, 'Cooking') - cookingXpBefore;

        if (cookedDelta > 0 || xpDelta > 0) {
            return { success: true, message: `Cooking attempt produced Shrimps (+${xpDelta} Cooking XP)` };
        }
        if (burntDelta > 0) {
            return { success: true, message: 'Cooking attempt completed but the shrimp burned' };
        }
        return { success: true, message: 'Cooking attempt completed with no detected product change' };
    } catch {
        return { success: false, message: `Timed out waiting for cooking outcome from ${sourceNow.name}` };
    }
}

function tracePath(outDir: string, task: TaskSpec, method: PlannerMethod): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(outDir, `${stamp}-${method}-${task.id}.json`);
}

async function setExperimentRunMode(api: string, botName: string, enabled: boolean): Promise<void> {
    const response = await fetch(`${api.replace(/\/$/, '')}/api/experiment/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: botName, enabled }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to set run mode (${response.status}): ${text.slice(0, 300)}`);
    }
}

function buildPddlArtifact(args: {
    task: TaskSpec;
    state: StateSummary;
    domainModel: LearnedDomainModel;
}): { domain: string; problem: string } {
    return exportPddl(args.task, args.state, args.domainModel);
}

function sameKindAndArgs(a: DomainPredicate | DomainEffect, b: DomainPredicate | DomainEffect): boolean {
    return a.kind === b.kind && JSON.stringify(a.args) === JSON.stringify(b.args);
}

function addPrecondition(action: LearnedActionSchema, precondition: DomainPredicate): LearnedActionSchema {
    if (action.preconditions.some(existing => sameKindAndArgs(existing, precondition))) return action;
    return { ...action, preconditions: [...action.preconditions, precondition] };
}

function addEffect(action: LearnedActionSchema, actionEffect: DomainEffect): LearnedActionSchema {
    if (action.effects.some(existing => sameKindAndArgs(existing, actionEffect))) return action;
    return { ...action, effects: [...action.effects, actionEffect] };
}

function lessonFromObservation(args: {
    actionSchemaId?: string;
    observation: string;
    inference: string;
    suggestedDomainChange: string;
    confidence?: number;
}): LearnedDomainLesson {
    return {
        actionSchemaId: args.actionSchemaId,
        observation: args.observation,
        inference: args.inference,
        suggestedDomainChange: args.suggestedDomainChange,
        confidence: args.confidence ?? 0.8,
        provenance: [{
            source: 'environment',
            reference: 'run-episode observed execution trace',
            confidence: args.confidence ?? 0.8,
            observedAt: new Date().toISOString(),
        }],
    };
}

function applyEnvironmentEvidence(args: {
    task: TaskSpec;
    domainModel: LearnedDomainModel;
    step: PlanStep;
    executed: ExecutionStep;
    allowExplore: boolean;
}): { domainModel: LearnedDomainModel; lessons: LearnedDomainLesson[] } {
    const lessons: LearnedDomainLesson[] = [];
    const fallbackDomain = defaultDomainForTask(args.task);
    let domainModel = sanitizeLearnedDomainModel(args.domainModel, args.task, fallbackDomain, { includeRecoveryActions: true });
    const actions = domainModel.actions.map(action => ({ ...action, negativeEvidence: [...(action.negativeEvidence ?? [])] }));
    const actionIndex = actions.findIndex(action => action.id === args.step.actionSchemaId);
    const targetAction = actionIndex >= 0 ? actions[actionIndex]! : undefined;
    const resultMessage = args.executed.result.message;

    const isCookingTask = args.task.id.includes('cook_shrimp');
    const isCookingAction =
        args.step.actionSchemaId === 'use_item_on_cooking_source'
        || args.step.actionSchemaId === 'explore_for_cooking_source';

    if (isCookingTask && targetAction && shouldAttemptReachabilityRecovery(args.executed.result)) {
        const reachablePrecondition = predicate('reachable', { target: 'Range|Fire' }, 0.8);
        let updatedAction = addPrecondition(targetAction, reachablePrecondition);
        updatedAction = {
            ...updatedAction,
            negativeEvidence: [
                ...updatedAction.negativeEvidence,
                {
                    observation: resultMessage,
                    inferredMissingPrecondition: reachablePrecondition,
                    stateBeforeHash: JSON.stringify(args.executed.before.position ?? {}),
                    stateAfterHash: JSON.stringify(args.executed.after.position ?? {}),
                    provenance: [{
                        source: 'environment',
                        reference: 'reachability failure during run-episode',
                        confidence: 0.85,
                        observedAt: new Date().toISOString(),
                    }],
                },
            ],
        };
        actions[actionIndex] = updatedAction;
        lessons.push(lessonFromObservation({
            actionSchemaId: targetAction.id,
            observation: resultMessage,
            inference: 'Cooking source visibility is not enough; direct cooking also requires the source to be reachable.',
            suggestedDomainChange: 'Add reachable(Range|Fire) as a precondition for use_item_on_cooking_source and plan open_nearby_door/explore_for_cooking_source before retrying.',
            confidence: 0.85,
        }));
    }

    if (isCookingTask && (/no nearby range or fire found/i.test(resultMessage) || /no cooking source/i.test(resultMessage))) {
        lessons.push(lessonFromObservation({
            actionSchemaId: args.step.actionSchemaId,
            observation: resultMessage,
            inference: 'When no Range or Fire is nearby, the symbolic model needs an exploration/navigation action before cooking.',
            suggestedDomainChange: 'Use explore_for_cooking_source to establish near_loc(Range|Fire) and reachable(Range|Fire).',
            confidence: 0.75,
        }));
    }

    if (isCookingTask) {
        for (let i = 0; i < actions.length; i++) {
            if (actions[i]!.id === 'open_nearby_door') {
                actions[i] = addEffect(actions[i]!, effect('reachable', { target: 'Range|Fire' }, 0.7));
            }
            if (actions[i]!.id === 'explore_for_cooking_source') {
                actions[i] = addEffect(addEffect(actions[i]!, effect('near_loc', { name: 'Range|Fire' }, 0.6)), effect('reachable', { target: 'Range|Fire' }, 0.6));
            }
        }
    }

    if (isCookingTask && /burned|burnt/i.test(resultMessage)) {
        lessons.push(lessonFromObservation({
            actionSchemaId: args.step.actionSchemaId,
            observation: resultMessage,
            inference: 'Burning food is a stochastic outcome of a valid cooking action, not evidence that the action preconditions were wrong.',
            suggestedDomainChange: 'Keep the successful cooking effects but preserve retry behavior for stochastic burn outcomes.',
            confidence: 0.8,
        }));
    }

    if (isCookingTask && args.executed.result.success && args.step.actionSchemaId === 'open_nearby_door') {
        lessons.push(lessonFromObservation({
            actionSchemaId: 'open_nearby_door',
            observation: resultMessage,
            inference: 'Opening a nearby door or gate can resolve reachability failures for blocked cooking sources.',
            suggestedDomainChange: 'Keep open_nearby_door as an executable recovery action with effect reachable(Range|Fire).',
            confidence: 0.8,
        }));
    }

    if (isCookingTask && args.executed.result.success && args.step.actionSchemaId === 'explore_for_cooking_source') {
        lessons.push(lessonFromObservation({
            actionSchemaId: 'explore_for_cooking_source',
            observation: resultMessage,
            inference: 'Bounded exploration can establish a reachable nearby cooking source before retrying cooking.',
            suggestedDomainChange: 'Keep explore_for_cooking_source as an executable recovery action with effects near_loc(Range|Fire) and reachable(Range|Fire).',
            confidence: 0.75,
        }));
    }

    domainModel = appendDomainLessons({ ...domainModel, actions }, lessons);
    return { domainModel: sanitizeLearnedDomainModel(domainModel, args.task, fallbackDomain, { includeRecoveryActions: true }), lessons };
}

async function symbolicPlanFromDomain(args: {
    method: PlannerMethod;
    task: TaskSpec;
    state: StateSummary;
    domainModel: LearnedDomainModel;
    remainingSteps: number;
}): Promise<PlanStep[]> {
    const replanningTask = { ...args.task, maxSteps: Math.max(1, args.remainingSteps) };
    const replanner = createPlanner(args.method, args.domainModel);
    const output = await replanner.plan({
        task: replanningTask,
        state: args.state,
        learnedActions: args.domainModel.actions,
        planExpand: { cookRepeatCap: 1 },
    });
    console.log(`[Episode] Symbolic replanner after domain update: ${output.notes ?? 'none'}`);
    return output.plan.slice(0, args.remainingSteps).map((step, index) => ({
        ...step,
        stepIndex: index,
        naturalLanguage: `Symbolic recovery ${index + 1}: ${step.naturalLanguage}`,
        executionPhase: 'replanned_symbolic' as const,
    }));
}

async function retrieveReplanRagContext(task: TaskSpec, trigger: ActionResult): Promise<{ query: string; context: string }> {
    const query = `RuneScape 2004 planning recovery for task "${task.description}" after failed action: ${trigger.message}. Include cooking ranges, doors/gates, and navigation hints.`;
    console.log(`[AgenticReplan] Querying Graph RAG with search: ${query}`);
    const proc = Bun.spawn([
        'python',
        'osrs_agent.py',
        '--question',
        query,
        '--no-llm',
        '--show-context',
    ], {
        cwd: join(process.cwd(), 'agents', 'cse476-final-project'),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0) {
        throw new Error(`Graph RAG replan retrieval failed: ${stderr || stdout}`);
    }
    return { query, context: stdout };
}

function replanPrompt(args: {
    task: TaskSpec;
    currentState: StateSummary;
    domainModel: LearnedDomainModel;
    currentPlan: PlanStep[];
    execution: ExecutionStep[];
    trigger: { action: string; result: ActionResult };
    ragContext?: string;
    allowExplore: boolean;
}): string {
    const executableActions = [
        '- open_nearby_door: open the nearest visible door/gate with an Open option.',
        '- explore_for_loc: bounded exploration that scans a wider radius, opens obvious doors/gates, and walks short probes (use actionParams.targetLocNamePattern when supported).',
        '- interact_loc: interact with a location using an option (use actionParams.locNamePattern + actionParams.optionPattern).',
        '- pickup_ground_item: pick up a ground item (use actionParams.itemNamePattern).',
        '- use_item_on_cooking_source: shrimp vertical-slice cook action (still supported).',
    ].join('\n');
    const actionShapeExample =
        `    { "stepIndex": 0, "naturalLanguage": "explore for target", "actionSchemaId": "explore_for_loc", "actionParams": { "targetLocNamePattern": "Range|Fire" } },
    { "stepIndex": 1, "naturalLanguage": "mine a rock", "actionSchemaId": "interact_loc", "actionParams": { "locNamePattern": "Rock", "optionPattern": "Mine" } }`;
    const timeoutRule =
        '- If the prior attempt made no progress (no inventory/XP change), do not just repeat the same action. Prefer explore/open-door/pickup/interact variations.';
    const preferred = args.task.taskHints?.preferredActions?.length
        ? args.task.taskHints.preferredActions
        : undefined;
    const allowedActionText =
        preferred
            ? `Use only these executable actionSchemaId values: ${preferred.join(', ')}.`
            : 'Use only these executable actionSchemaId values: open_nearby_door, explore_for_loc, interact_loc, pickup_ground_item, use_item_on_cooking_source.';

    return `
You are the within-episode controller for a RuneScape planning experiment.

Goal:
${JSON.stringify(args.task.goalState ?? args.task.success, null, 2)}

Task:
${JSON.stringify(args.task, null, 2)}

Available executable actionSchemaId values:
${executableActions}

Available SDK/action docs:
${ACTION_DOCS}

Current symbolic domain model:
${JSON.stringify(args.domainModel, null, 2)}

Current planned steps:
${JSON.stringify(args.currentPlan, null, 2)}

Execution trace so far:
${JSON.stringify(args.execution.map(step => ({
        action: step.action,
        result: step.result,
        before: {
            position: step.before.position,
            inventory: step.before.inventory,
            nearbyLocs: step.before.nearbyLocs,
            messages: step.before.recentMessages,
        },
        after: {
            position: step.after.position,
            inventory: step.after.inventory,
            nearbyLocs: step.after.nearbyLocs,
            messages: step.after.recentMessages,
        },
        delta: step.delta,
    })), null, 2)}

Failure or stalled-progress trigger:
${JSON.stringify(args.trigger, null, 2)}

Current state:
${JSON.stringify(args.currentState, null, 2)}

${args.ragContext ? `Retrieved Graph RAG context:\n${args.ragContext}\n` : ''}

Return ONLY JSON in this exact shape:
{
  "notes": "brief reason for the replan",
  "domainModel": { "id": "...", "taskId": "...", "description": "...", "provenance": [], "notes": [], "actions": [] },
  "learnedLessons": [
    { "observation": "what happened", "inference": "domain rule learned from it", "actionSchemaId": "use_item_on_cooking_source", "suggestedDomainChange": "specific precondition/effect/action update", "confidence": 0.8, "provenance": [{ "source": "environment", "reference": "episode trace", "confidence": 0.8 }] }
  ],
  "plan": [
${actionShapeExample}
  ]
}

Rules:
- Prefer a short recovery plan of 1-4 steps.
${timeoutRule}
- ${allowedActionText}
- Preserve the learned domain model, but add/refine actions for reachability, exploration, doors, and failed/no-progress observations.
- If you solve the failure with a recovery step, write a learnedLessons entry and encode the same lesson in domainModel preconditions/effects so future initial symbolic plans can use it.
`.trim();
}

async function requestAgenticReplan(args: {
    task: TaskSpec;
    currentState: StateSummary;
    domainModel: LearnedDomainModel;
    currentPlan: PlanStep[];
    execution: ExecutionStep[];
    trigger: { action: string; result: ActionResult };
    modelName: string;
    apiBase: string;
    useRag: boolean;
    allowExplore: boolean;
    replanIndex: number;
}): Promise<AgenticReplanEvent> {
    const rag = args.useRag ? await retrieveReplanRagContext(args.task, args.trigger.result) : undefined;
    console.log(`[AgenticReplan] LLM writing in-episode replan #${args.replanIndex} with model=${args.modelName}`);
    const rawResponse = await chatCompletion({
        apiBase: args.apiBase,
        model: args.modelName,
        messages: [
            { role: 'system', content: 'You are an agentic replanning controller. Return strict JSON only.' },
            {
                role: 'user',
                content: replanPrompt({
                    task: args.task,
                    currentState: args.currentState,
                    domainModel: args.domainModel,
                    currentPlan: args.currentPlan,
                    execution: args.execution,
                    trigger: args.trigger,
                    ragContext: rag?.context,
                    allowExplore: args.allowExplore,
                }),
            },
        ],
        temperature: 0.2,
    });
    const parsed = extractJsonObject(rawResponse) as Partial<AgenticReplanEvent>;
    const defaultAllowedActions = [
        'open_nearby_door',
        'explore_for_loc',
        'explore_for_cooking_source',
        'interact_loc',
        'pickup_ground_item',
        'use_item_on_cooking_source',
    ];
    const allowedActions = args.task.taskHints?.preferredActions?.length
        ? args.task.taskHints.preferredActions
        : defaultAllowedActions;
    const plan = (parsed.plan ?? [])
        .filter(step => allowedActions.includes(step.actionSchemaId ?? ''))
        .map((step, index) => ({
            stepIndex: index,
            naturalLanguage: step.naturalLanguage || `Agentic recovery step ${index + 1}`,
            actionSchemaId: step.actionSchemaId,
            actionParams: step.actionParams,
            expectedEffects: step.expectedEffects,
        }));

    return {
        replanIndex: args.replanIndex,
        triggeredBy: args.trigger,
        ragQueries: rag ? [rag.query] : undefined,
        ragContext: rag?.context,
        notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
        plan,
        domainModel: parsed.domainModel ? sanitizeLearnedDomainModel(parsed.domainModel, args.task, args.domainModel, { includeRecoveryActions: true }) : undefined,
        learnedLessons: Array.isArray(parsed.learnedLessons) ? parsed.learnedLessons : undefined,
        rawResponse,
    };
}

async function main() {
    const {
        taskPath,
        botName,
        method,
        modelName,
        domainPath,
        server,
        api,
        apiBase,
        forceRun,
        agenticReplan,
        agenticExplore,
        replanRag,
        maxReplans,
        outDir,
        maxStepsOverride,
        readyTimeout,
        discoveryOnEmptyPlan,
        discoveryMaxSteps,
        scriptedPlanner,
        transitionLogGlobalDisabled,
        transitionLogGlobalPath,
        transitionLogTaskIsolated,
        transitionLogTaskDir,
        transitionLogTrialPath,
        kbGlobalDisabled,
        kbGlobalPath,
        kbTaskIsolated,
        kbTaskDir,
        kbTrialPath,
    } = parseArgs();
    const task = readTask(taskPath);
    if (maxStepsOverride !== undefined && Number.isFinite(maxStepsOverride) && maxStepsOverride > 0) {
        task.maxSteps = maxStepsOverride;
    }
    const domainModel = readDomain(domainPath);
    const fallbackDomain = defaultDomainForTask(task);
    let effectiveDomainModel = sanitizeLearnedDomainModel(
        domainModel ?? fallbackDomain,
        task,
        fallbackDomain,
        { includeRecoveryActions: true },
    );
    const planner =
        scriptedPlanner && (method === 'few_shot' || method === 'static_rag')
            ? createPlanner(method, undefined)
            : createPlanner(method, effectiveDomainModel);
    const conn = await connectExperimentBot(botName, server);
    const startedAt = Date.now();
    const execution: ExecutionStep[] = [];
    const agenticReplans: AgenticReplanEvent[] = [];

    try {
        if (forceRun) {
            await setExperimentRunMode(api, botName, true);
        }
        mkdirSync(outDir, { recursive: true });
        const outPath = tracePath(outDir, task, method);
        const episodeId = basename(outPath, '.json');
        const transitionPaths = resolveTransitionLogPaths({
            taskId: task.id,
            globalEnabled: !transitionLogGlobalDisabled && Boolean(transitionLogGlobalPath),
            globalPath: transitionLogGlobalPath,
            taskIsolated: transitionLogTaskIsolated,
            taskIsolatedDir: transitionLogTaskDir,
            trialPath: transitionLogTrialPath || undefined,
        });

        const before = await currentSummary(conn, readyTimeout);
        const kbPaths = [
            ...(kbGlobalDisabled ? [] : [kbGlobalPath]),
            ...(kbTaskIsolated ? [join(kbTaskDir, 'by-task', `${task.id}.json`)] : []),
            ...(kbTrialPath ? [kbTrialPath] : []),
        ].filter(Boolean);
        // Load persisted KB (global/task/trial) so exploration can use learned locations immediately.
        const kb = (() => {
            const existingPath = kbPaths.find(p => existsSync(p));
            return existingPath ? KnowledgeBase.load(existingPath) : new KnowledgeBase();
        })();
        kb.observe(conn.sdk.getState());

        const flushTransitionRecord = (executed: ExecutionStep): void => {
            if (transitionPaths.length === 0) return;
            const baseline = execution[0]!.before;
            const cumulativeDelta = diffStateSummaries(baseline, executed.after);
            const verifierAfter = evaluateVerifiers(executed.after, task.success, cumulativeDelta);
            appendTransitionRecord(
                transitionPaths,
                buildTransitionRecord({
                    episodeId,
                    tracePath: outPath,
                    taskId: task.id,
                    taskSpec: task,
                    method,
                    modelName,
                    stepOrdinal: execution.length - 1,
                    phase: executed.phase ?? 'planned',
                    actionSchemaId: executed.actionSchemaId,
                    actionParams: executed.actionParams,
                    summaryBefore: executed.before,
                    summaryAfter: executed.after,
                    delta: executed.delta,
                    result: executed.result,
                    verifierAfter,
                    cumulativeDeltaFromEpisodeStart: cumulativeDelta,
                    verifierProgressSuccess: verifierAfter.success,
                    observedWorldObjects: observedWorldObjectsFromState(conn.sdk.getState()),
                }),
            );
        };
        const initialPddl = buildPddlArtifact({
            task,
            state: before,
            domainModel: effectiveDomainModel,
        });
        const initialDomainModel = structuredClone(effectiveDomainModel);
        const plannerOutput = await planner.plan({
            task,
            state: before,
            learnedActions: effectiveDomainModel.actions,
        });

        console.log(`[Episode] Planner notes: ${plannerOutput.notes ?? 'none'}`);
        console.log('[Episode] Plan to execute:');
        let plan = [...plannerOutput.plan.slice(0, task.maxSteps)];
        let discoveryPhase: DiscoveryPhaseMeta | undefined;
        const symbolicPlanEmpty = plan.length === 0;
        if (symbolicPlanEmpty && discoveryOnEmptyPlan) {
            const budget =
                discoveryMaxSteps > 0 ? Math.min(task.maxSteps, discoveryMaxSteps) : task.maxSteps;
            discoveryPhase = {
                reason: 'empty_initial_plan',
                plannerNotes: plannerOutput.notes,
                budgetSteps: Math.max(0, Math.min(budget, task.maxSteps)),
            };
            plan = buildDiscoveryPlanSteps(
                task.id,
                task.maxSteps,
                discoveryPhase.budgetSteps,
                {
                    exploreTargets: task.taskHints?.explorationTargets,
                    goalItems: task.taskHints?.goalItems,
                    actionCycle: task.taskHints?.preferredActions,
                },
            );
            console.warn(
                `[Episode] Symbolic planner returned no plan; discovery bootstrap will run ${plan.length} step(s) (budget=${discoveryPhase.budgetSteps}).`,
            );
        } else if (plan.length === 0) {
            console.log('[Episode]   (empty plan)');
        }
        for (const step of plan) {
            console.log(`[Episode]   ${step.stepIndex}: ${step.actionSchemaId ?? 'unknown'} - ${step.naturalLanguage}`);
        }

        let verifier = evaluateVerifiers(before, task.success, diffStateSummaries(before, before));
        let replanningCount = 0;
        let explorationCount = 0;

        for (let cursor = 0; cursor < plan.length && execution.length < task.maxSteps; cursor++) {
            const step = plan[cursor]!;
            const stepPhase: ExecutionPhase = step.executionPhase ?? 'planned';
            const stepBefore = await currentSummary(conn, readyTimeout);
            const startedTick = stepBefore.tick;
            console.log(`[Episode] Executing step ${step.stepIndex}: ${step.actionSchemaId ?? 'unknown'} - ${step.naturalLanguage}`);
            const result = await executeStep(conn, step, kb, effectiveDomainModel);
            const stepAfter = await currentSummary(conn, readyTimeout);
            const delta = diffStateSummaries(stepBefore, stepAfter);
            console.log(`[Episode] Result step ${step.stepIndex}: ${result.success ? 'ok' : 'failed'} - ${result.message}`);

            execution.push({
                stepIndex: step.stepIndex,
                action: step.naturalLanguage,
                startedTick,
                endedTick: stepAfter.tick,
                result,
                before: stepBefore,
                after: stepAfter,
                delta,
                phase: stepPhase,
                actionSchemaId: step.actionSchemaId,
                actionParams: step.actionParams,
            });
            flushTransitionRecord(execution[execution.length - 1]!);
            kb.observe(conn.sdk.getState());
            const executedStep = execution[execution.length - 1]!;
            const evidenceUpdate = applyEnvironmentEvidence({
                task,
                domainModel: effectiveDomainModel,
                step,
                executed: executedStep,
                allowExplore: agenticExplore,
            });
            effectiveDomainModel = evidenceUpdate.domainModel;
            if (evidenceUpdate.lessons.length > 0) {
                console.log(`[Episode] Learned ${evidenceUpdate.lessons.length} environment lesson(s) from step ${step.stepIndex}.`);
                for (const lesson of evidenceUpdate.lessons) {
                    console.log(`[Episode]   lesson: ${lesson.inference}`);
                }
            }

            verifier = evaluateVerifiers(stepAfter, task.success, diffStateSummaries(before, stepAfter));
            if (verifier.success) break;
            if (shouldAttemptAgenticReplan(result, verifier.success) && agenticReplan && modelName !== 'none' && replanningCount < maxReplans) {
                replanningCount++;
                const currentState = await currentSummary(conn, readyTimeout);
                console.log(`[Episode] Triggering agentic replanning #${replanningCount}: ${result.message}`);
                const replan = await requestAgenticReplan({
                    task,
                    currentState,
                    domainModel: effectiveDomainModel,
                    currentPlan: plan.slice(cursor + 1),
                    execution,
                    trigger: { action: step.naturalLanguage, result },
                    modelName,
                    apiBase,
                    useRag: replanRag,
                    allowExplore: agenticExplore,
                    replanIndex: replanningCount,
                });
                agenticReplans.push(replan);
                if (replan.domainModel) {
                    effectiveDomainModel = sanitizeLearnedDomainModel(appendDomainLessons(replan.domainModel, replan.learnedLessons ?? []), task, effectiveDomainModel, { includeRecoveryActions: true });
                } else if (replan.learnedLessons?.length) {
                    effectiveDomainModel = sanitizeLearnedDomainModel(appendDomainLessons(effectiveDomainModel, replan.learnedLessons), task, effectiveDomainModel, { includeRecoveryActions: true });
                }
                const symbolicRecoveryPlan = await symbolicPlanFromDomain({
                    method,
                    task,
                    state: currentState,
                    domainModel: effectiveDomainModel,
                    remainingSteps: task.maxSteps - execution.length,
                });
                replan.symbolicReplan = {
                    notes: symbolicRecoveryPlan.length > 0
                        ? 'Generated by symbolic planner from updated in-episode domain.'
                        : 'No symbolic recovery plan found from updated domain; falling back to LLM-authored recovery steps.',
                    plan: symbolicRecoveryPlan,
                };
                const recoveryPlan =
                    symbolicRecoveryPlan.length > 0
                        ? symbolicRecoveryPlan
                        : replan.plan.map(s => ({ ...s, executionPhase: 'replanned_llm' as const }));
                if (recoveryPlan.length > 0) {
                    console.log(`[Episode] Agentic replan #${replanningCount}: ${replan.notes ?? 'no notes'}`);
                    for (const plannedStep of recoveryPlan) {
                        console.log(`[Episode]   replan ${plannedStep.stepIndex}: ${plannedStep.actionSchemaId ?? 'unknown'} - ${plannedStep.naturalLanguage}`);
                    }
                    plan.splice(cursor + 1, 0, ...recoveryPlan);
                    continue;
                }
                console.log(`[Episode] Agentic replan #${replanningCount} returned no executable steps.`);
            }

            if (shouldAttemptAgenticReplan(result, verifier.success) && agenticExplore && explorationCount < maxReplans) {
                explorationCount++;
                replanningCount++;
                const explorationStep: PlanStep = {
                    stepIndex: step.stepIndex,
                    naturalLanguage: 'Exploration recovery: search for a reachable cooking source before retrying cooking.',
                    actionSchemaId: 'explore_for_cooking_source',
                    executionPhase: 'recovery',
                };
                console.log(`[Episode] Triggering exploration recovery #${explorationCount}: ${result.message}`);
                console.log(`[Episode] Executing exploration step: ${explorationStep.actionSchemaId} - ${explorationStep.naturalLanguage}`);
                const explorationBefore = await currentSummary(conn, readyTimeout);
                const explorationStartedTick = explorationBefore.tick;
                const explorationResult = await executeStep(conn, explorationStep, kb, effectiveDomainModel);
                const explorationAfter = await currentSummary(conn, readyTimeout);
                const explorationDelta = diffStateSummaries(explorationBefore, explorationAfter);
                console.log(`[Episode] Result exploration step: ${explorationResult.success ? 'ok' : 'failed'} - ${explorationResult.message}`);

                execution.push({
                    stepIndex: explorationStep.stepIndex,
                    action: explorationStep.naturalLanguage,
                    startedTick: explorationStartedTick,
                    endedTick: explorationAfter.tick,
                    result: explorationResult,
                    before: explorationBefore,
                    after: explorationAfter,
                    delta: explorationDelta,
                    phase: 'recovery',
                    actionSchemaId: explorationStep.actionSchemaId,
                    actionParams: explorationStep.actionParams,
                });
                flushTransitionRecord(execution[execution.length - 1]!);
                const explorationEvidence = applyEnvironmentEvidence({
                    task,
                    domainModel: effectiveDomainModel,
                    step: explorationStep,
                    executed: execution[execution.length - 1]!,
                    allowExplore: agenticExplore,
                });
                effectiveDomainModel = explorationEvidence.domainModel;
                for (const lesson of explorationEvidence.lessons) {
                    console.log(`[Episode]   lesson: ${lesson.inference}`);
                }

                if (explorationResult.success) {
                    const symbolicAfterExplore = await symbolicPlanFromDomain({
                        method,
                        task,
                        state: explorationAfter,
                        domainModel: effectiveDomainModel,
                        remainingSteps: task.maxSteps - execution.length,
                    });
                    plan.splice(cursor + 1, 0, ...(symbolicAfterExplore.length > 0 ? symbolicAfterExplore : [{
                        stepIndex: step.stepIndex,
                        naturalLanguage: 'Retry cooking after exploration recovery.',
                        actionSchemaId: 'use_item_on_cooking_source',
                        executionPhase: 'recovery' as const,
                    }]));
                    continue;
                }
                if (!explorationResult.success && !shouldAttemptReachabilityRecovery(result)) break;
            }

            if (!result.success) {
                if (!shouldAttemptReachabilityRecovery(result)) break;

                const recoveryStep: PlanStep = {
                    stepIndex: step.stepIndex,
                    naturalLanguage: `Replan after reachability failure: open a nearby door or gate, then continue with the remaining plan.`,
                    actionSchemaId: 'open_nearby_door',
                    executionPhase: 'recovery',
                };
                replanningCount++;
                console.log(`[Episode] Triggering replanning #${replanningCount}: ${result.message}`);
                console.log(`[Episode] Executing recovery step: ${recoveryStep.actionSchemaId} - ${recoveryStep.naturalLanguage}`);

                const recoveryBefore = await currentSummary(conn, readyTimeout);
                const recoveryStartedTick = recoveryBefore.tick;
                const recoveryResult = await executeStep(conn, recoveryStep, kb, effectiveDomainModel);
                const recoveryAfter = await currentSummary(conn, readyTimeout);
                const recoveryDelta = diffStateSummaries(recoveryBefore, recoveryAfter);
                console.log(`[Episode] Result recovery step: ${recoveryResult.success ? 'ok' : 'failed'} - ${recoveryResult.message}`);

                execution.push({
                    stepIndex: recoveryStep.stepIndex,
                    action: recoveryStep.naturalLanguage,
                    startedTick: recoveryStartedTick,
                    endedTick: recoveryAfter.tick,
                    result: recoveryResult,
                    before: recoveryBefore,
                    after: recoveryAfter,
                    delta: recoveryDelta,
                    phase: 'recovery',
                    actionSchemaId: recoveryStep.actionSchemaId,
                });
                flushTransitionRecord(execution[execution.length - 1]!);
                const recoveryEvidence = applyEnvironmentEvidence({
                    task,
                    domainModel: effectiveDomainModel,
                    step: recoveryStep,
                    executed: execution[execution.length - 1]!,
                    allowExplore: agenticExplore,
                });
                effectiveDomainModel = recoveryEvidence.domainModel;
                for (const lesson of recoveryEvidence.lessons) {
                    console.log(`[Episode]   lesson: ${lesson.inference}`);
                }

                if (!recoveryResult.success) break;
                const symbolicAfterRecovery = await symbolicPlanFromDomain({
                    method,
                    task,
                    state: recoveryAfter,
                    domainModel: effectiveDomainModel,
                    remainingSteps: task.maxSteps - execution.length,
                });
                if (symbolicAfterRecovery.length > 0) {
                    plan.splice(cursor + 1, 0, ...symbolicAfterRecovery);
                }
            }
        }

        const finalState = await currentSummary(conn, readyTimeout);
        // Persist KB snapshots once per episode (deduped), merging into existing.
        for (const path of kbPaths) {
            const existing = KnowledgeBase.load(path);
            existing.mergeFrom(kb);
            existing.save(path);
        }
        const finalPddl = buildPddlArtifact({
            task,
            state: finalState,
            domainModel: effectiveDomainModel,
        });
        const initialState = execution[0]?.before ?? before;
        const totalDelta = diffStateSummaries(initialState, finalState);
        verifier = evaluateVerifiers(finalState, task.success, totalDelta);

        const trace: EpisodeTrace = {
            episodeId,
            tracePath: outPath,
            method,
            task,
            model: {
                provider: modelName === 'none' ? 'none' : 'ollama',
                name: modelName === 'none' ? planner.constructor.name : modelName,
            },
            plan,
            discoveryPhase,
            agenticReplans,
            execution,
            metrics: {
                success: verifier.success,
                totalDurationMs: Date.now() - startedAt,
                invalidActionCount: execution.filter(step => !step.result.success).length,
                replanningCount,
            },
            finalState,
            rawFinalState: conn.sdk.getState(),
            pddlArtifacts: {
                domainModelId: effectiveDomainModel.id,
                initialDomain: initialPddl.domain,
                initialProblem: initialPddl.problem,
                finalDomain: finalPddl.domain,
                finalProblem: finalPddl.problem,
            },
            domainArtifacts: {
                initialDomainModel,
                finalDomainModel: effectiveDomainModel,
            },
        };

        writeFileSync(outPath, JSON.stringify({ trace, verifier }, null, 2));

        console.log(`Episode trace written: ${outPath}`);
        console.log(`Success: ${verifier.success}`);
        for (const line of verifier.evidence) console.log(`- ${line}`);
    } finally {
        conn.disconnect();
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
