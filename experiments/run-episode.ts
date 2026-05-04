#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ActionResult, BotWorldState, NearbyLoc } from '../sdk/types';
import { connectExperimentBot } from './connect';
import { defaultCookShrimpDomain } from './domain-model';
import { exportPddl } from './pddl';
import { createPlanner } from './planner';
import type { EpisodeTrace, ExecutionStep, LearnedDomainModel, PlannerMethod, PlanStep, StateSummary, TaskSpec } from './schemas';
import { diffStateSummaries, summarizeState } from './state-summary';
import { evaluateVerifiers } from './verifier';

function usage(exitCode = 1): never {
    console.log(`
Run one experiment episode from a TaskSpec JSON file.

Usage:
  bun experiments/run-episode.ts <task.json> --bot McPlan [--method few_shot] [--model none] [--domain model.json] [--server localhost] [--api http://localhost:8888] [--force-run] [--max-steps 10] [--ready-timeout 30000] [--out runs/traces]

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
    let forceRun = false;
    let outDir = join('runs', 'traces');
    let maxStepsOverride: number | undefined;
    let readyTimeout = 15_000;

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
        } else if (arg === '--force-run') {
            forceRun = true;
        } else if (arg === '--max-steps') {
            maxStepsOverride = Number(args[++i]);
        } else if (arg === '--ready-timeout') {
            readyTimeout = Number(args[++i] ?? readyTimeout);
        } else if (arg === '--out') {
            outDir = args[++i] ?? outDir;
        }
    }

    if (!taskPath || !botName) usage();
    if (!['few_shot', 'static_rag', 'learned_domain', 'pddl'].includes(method)) {
        throw new Error(`Unknown method: ${method}`);
    }

    return { taskPath, botName, method, modelName, domainPath, server, api, forceRun, outDir, maxStepsOverride, readyTimeout };
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

async function currentSummary(conn: Awaited<ReturnType<typeof connectExperimentBot>>, timeout = 15_000): Promise<StateSummary> {
    const state = await conn.sdk.waitForCondition(
        s => s.inGame && Boolean(s.player) && (s.nearbyLocs.length > 0 || s.nearbyNpcs.length > 0),
        timeout,
    );
    return summarizeState(state);
}

async function executeStep(conn: Awaited<ReturnType<typeof connectExperimentBot>>, step: PlanStep): Promise<ActionResult> {
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

    const range = findCookingSource(beforeState);
    if (!range) return { success: false, message: 'No nearby range or fire found' };

    if (range.distance > 3) {
        const walkResult = await conn.bot.walkTo(range.x, range.z, 3);
        if (!walkResult.success) {
            return { success: false, message: `Cannot reach ${range.name}: ${walkResult.message}` };
        }
    }

    const sourceNow = findCookingSource(conn.sdk.getState() ?? beforeState);
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

async function main() {
    const { taskPath, botName, method, modelName, domainPath, server, api, forceRun, outDir, maxStepsOverride, readyTimeout } = parseArgs();
    const task = readTask(taskPath);
    if (maxStepsOverride !== undefined && Number.isFinite(maxStepsOverride) && maxStepsOverride > 0) {
        task.maxSteps = maxStepsOverride;
    }
    const domainModel = readDomain(domainPath);
    const effectiveDomainModel = domainModel ?? defaultCookShrimpDomain(task.id);
    const planner = createPlanner(method, domainModel);
    const conn = await connectExperimentBot(botName, server);
    const startedAt = Date.now();
    const execution: ExecutionStep[] = [];

    try {
        if (forceRun) {
            await setExperimentRunMode(api, botName, true);
        }
        mkdirSync(outDir, { recursive: true });
        const outPath = tracePath(outDir, task, method);
        const before = await currentSummary(conn, readyTimeout);
        const initialPddl = buildPddlArtifact({
            task,
            state: before,
            domainModel: effectiveDomainModel,
        });
        const plannerOutput = await planner.plan({
            task,
            state: before,
            learnedActions: domainModel?.actions,
        });

        let verifier = evaluateVerifiers(before, task.success, diffStateSummaries(before, before));

        for (const step of plannerOutput.plan.slice(0, task.maxSteps)) {
            const stepBefore = await currentSummary(conn, readyTimeout);
            const startedTick = stepBefore.tick;
            const result = await executeStep(conn, step);
            const stepAfter = await currentSummary(conn, readyTimeout);
            const delta = diffStateSummaries(stepBefore, stepAfter);

            execution.push({
                stepIndex: step.stepIndex,
                action: step.naturalLanguage,
                startedTick,
                endedTick: stepAfter.tick,
                result,
                before: stepBefore,
                after: stepAfter,
                delta,
            });

            verifier = evaluateVerifiers(stepAfter, task.success, diffStateSummaries(before, stepAfter));
            if (verifier.success || !result.success) break;
        }

        const finalState = await currentSummary(conn, readyTimeout);
        const finalPddl = buildPddlArtifact({
            task,
            state: finalState,
            domainModel: effectiveDomainModel,
        });
        const initialState = execution[0]?.before ?? before;
        const totalDelta = diffStateSummaries(initialState, finalState);
        verifier = evaluateVerifiers(finalState, task.success, totalDelta);

        const trace: EpisodeTrace = {
            episodeId: `${method}-${task.id}-${Date.now()}`,
            method,
            task,
            model: {
                provider: modelName === 'none' ? 'none' : 'ollama',
                name: modelName === 'none' ? planner.constructor.name : modelName,
            },
            plan: plannerOutput.plan,
            execution,
            metrics: {
                success: verifier.success,
                totalDurationMs: Date.now() - startedAt,
                invalidActionCount: execution.filter(step => !step.result.success).length,
                replanningCount: 0,
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
