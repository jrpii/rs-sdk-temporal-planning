#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ActionResult, BotWorldState, NearbyLoc } from '../sdk/types';
import { connectExperimentBot } from './connect';
import { ACTION_DOCS, defaultCookShrimpDomain } from './domain-model';
import { chatCompletion, extractJsonObject } from './llm';
import { exportPddl } from './pddl';
import { createPlanner } from './planner';
import type { AgenticReplanEvent, EpisodeTrace, ExecutionStep, LearnedDomainModel, PlannerMethod, PlanStep, StateSummary, TaskSpec } from './schemas';
import { diffStateSummaries, summarizeState } from './state-summary';
import { evaluateVerifiers } from './verifier';

function usage(exitCode = 1): never {
    console.log(`
Run one experiment episode from a TaskSpec JSON file.

Usage:
  bun experiments/run-episode.ts <task.json> --bot McPlan [--method few_shot] [--model none] [--domain model.json] [--server localhost] [--api http://localhost:8888] [--api-base http://127.0.0.1:11434/v1] [--force-run] [--agentic-replan] [--replan-rag] [--max-replans 2] [--max-steps 10] [--ready-timeout 30000] [--out runs/traces]

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
    let replanRag = false;
    let maxReplans = 2;
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
        } else if (arg === '--api-base') {
            apiBase = args[++i] ?? apiBase;
        } else if (arg === '--force-run') {
            forceRun = true;
        } else if (arg === '--agentic-replan') {
            agenticReplan = true;
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
        }
    }

    if (!taskPath || !botName) usage();
    if (!['few_shot', 'static_rag', 'learned_domain', 'pddl'].includes(method)) {
        throw new Error(`Unknown method: ${method}`);
    }

    return { taskPath, botName, method, modelName, domainPath, server, api, apiBase, forceRun, agenticReplan, replanRag, maxReplans, outDir, maxStepsOverride, readyTimeout };
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
    if (!result.success) return true;
    return /no detected product|burned|no progress|timed out/i.test(result.message);
}

async function currentSummary(conn: Awaited<ReturnType<typeof connectExperimentBot>>, timeout = 15_000): Promise<StateSummary> {
    const state = await conn.sdk.waitForCondition(
        s => s.inGame && Boolean(s.player) && (s.nearbyLocs.length > 0 || s.nearbyNpcs.length > 0),
        timeout,
    );
    return summarizeState(state);
}

async function executeStep(conn: Awaited<ReturnType<typeof connectExperimentBot>>, step: PlanStep): Promise<ActionResult> {
    if (step.actionSchemaId === 'explore_for_cooking_source') {
        const state = conn.sdk.getState();
        if (!state?.player) return { success: false, message: 'No game state available' };

        const existingSource = findCookingSource(state);
        if (existingSource) {
            const walkResult = await conn.bot.walkTo(existingSource.x, existingSource.z, 3);
            return {
                ...walkResult,
                message: `Exploration found visible ${existingSource.name}: ${walkResult.message}`,
            };
        }

        const scannedLocs = await conn.sdk.scanNearbyLocs(30);
        const scannedSource = findCookingSourceInLocs(scannedLocs);
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
            const afterDoorSource = findCookingSource(conn.sdk.getState() ?? state)
                ?? findCookingSourceInLocs(await conn.sdk.scanNearbyLocs(30));
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
            const source = findCookingSource(conn.sdk.getState() ?? state)
                ?? findCookingSourceInLocs(await conn.sdk.scanNearbyLocs(30));
            if (source) {
                return { success: true, message: `Exploration probe found ${source.name} at (${source.x}, ${source.z})` };
            }
        }

        return { success: false, message: 'Exploration did not find a Range or Fire within bounded probes' };
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
}): string {
    return `
You are the within-episode controller for a RuneScape planning experiment.

Goal:
${JSON.stringify(args.task.goalState ?? args.task.success, null, 2)}

Task:
${JSON.stringify(args.task, null, 2)}

Available executable actionSchemaId values:
- use_item_on_cooking_source: use Raw shrimps on a visible/reachable Range or Fire.
- open_nearby_door: open the nearest visible door/gate with an Open option.
- explore_for_cooking_source: bounded exploration that scans a wider radius, opens obvious doors/gates, and walks short probes to find a Range or Fire.

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
  "plan": [
    { "stepIndex": 0, "naturalLanguage": "explore/open/cook step", "actionSchemaId": "explore_for_cooking_source" },
    { "stepIndex": 1, "naturalLanguage": "cook after recovery", "actionSchemaId": "use_item_on_cooking_source" }
  ]
}

Rules:
- Prefer a short recovery plan of 1-4 steps.
- If the prior cook attempt timed out with no inventory or XP change, do not just repeat cooking first. Try exploration or door opening before retrying cooking.
- Use only the three executable actionSchemaId values listed above.
- Preserve the learned domain model, but add/refine actions for reachability, exploration, doors, and failed/no-progress observations.
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
                }),
            },
        ],
        temperature: 0.2,
    });
    const parsed = extractJsonObject(rawResponse) as Partial<AgenticReplanEvent>;
    const plan = (parsed.plan ?? [])
        .filter(step => ['use_item_on_cooking_source', 'open_nearby_door', 'explore_for_cooking_source'].includes(step.actionSchemaId ?? ''))
        .map((step, index) => ({
            stepIndex: index,
            naturalLanguage: step.naturalLanguage || `Agentic recovery step ${index + 1}`,
            actionSchemaId: step.actionSchemaId,
            expectedEffects: step.expectedEffects,
        }));

    return {
        replanIndex: args.replanIndex,
        triggeredBy: args.trigger,
        ragQueries: rag ? [rag.query] : undefined,
        ragContext: rag?.context,
        notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
        plan,
        domainModel: parsed.domainModel,
        rawResponse,
    };
}

async function main() {
    const { taskPath, botName, method, modelName, domainPath, server, api, apiBase, forceRun, agenticReplan, replanRag, maxReplans, outDir, maxStepsOverride, readyTimeout } = parseArgs();
    const task = readTask(taskPath);
    if (maxStepsOverride !== undefined && Number.isFinite(maxStepsOverride) && maxStepsOverride > 0) {
        task.maxSteps = maxStepsOverride;
    }
    const domainModel = readDomain(domainPath);
    let effectiveDomainModel = domainModel ?? defaultCookShrimpDomain(task.id);
    const planner = createPlanner(method, effectiveDomainModel);
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
        const before = await currentSummary(conn, readyTimeout);
        const initialPddl = buildPddlArtifact({
            task,
            state: before,
            domainModel: effectiveDomainModel,
        });
        const plannerOutput = await planner.plan({
            task,
            state: before,
            learnedActions: effectiveDomainModel.actions,
        });

        console.log(`[Episode] Planner notes: ${plannerOutput.notes ?? 'none'}`);
        console.log('[Episode] Plan to execute:');
        const plan = [...plannerOutput.plan.slice(0, task.maxSteps)];
        if (plan.length === 0) {
            console.log('[Episode]   (empty plan)');
        }
        for (const step of plan) {
            console.log(`[Episode]   ${step.stepIndex}: ${step.actionSchemaId ?? 'unknown'} - ${step.naturalLanguage}`);
        }

        let verifier = evaluateVerifiers(before, task.success, diffStateSummaries(before, before));
        let replanningCount = 0;

        for (let cursor = 0; cursor < plan.length && execution.length < task.maxSteps; cursor++) {
            const step = plan[cursor]!;
            const stepBefore = await currentSummary(conn, readyTimeout);
            const startedTick = stepBefore.tick;
            console.log(`[Episode] Executing step ${step.stepIndex}: ${step.actionSchemaId ?? 'unknown'} - ${step.naturalLanguage}`);
            const result = await executeStep(conn, step);
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
            });

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
                    replanIndex: replanningCount,
                });
                agenticReplans.push(replan);
                if (replan.domainModel) {
                    effectiveDomainModel = replan.domainModel;
                }
                if (replan.plan.length > 0) {
                    console.log(`[Episode] Agentic replan #${replanningCount}: ${replan.notes ?? 'no notes'}`);
                    for (const plannedStep of replan.plan) {
                        console.log(`[Episode]   replan ${plannedStep.stepIndex}: ${plannedStep.actionSchemaId ?? 'unknown'} - ${plannedStep.naturalLanguage}`);
                    }
                    plan.splice(cursor + 1, 0, ...replan.plan);
                    continue;
                }
                console.log(`[Episode] Agentic replan #${replanningCount} returned no executable steps.`);
            }

            if (!result.success) {
                if (!shouldAttemptReachabilityRecovery(result)) break;

                const recoveryStep: PlanStep = {
                    stepIndex: step.stepIndex,
                    naturalLanguage: `Replan after reachability failure: open a nearby door or gate, then continue with the remaining plan.`,
                    actionSchemaId: 'open_nearby_door',
                };
                replanningCount++;
                console.log(`[Episode] Triggering replanning #${replanningCount}: ${result.message}`);
                console.log(`[Episode] Executing recovery step: ${recoveryStep.actionSchemaId} - ${recoveryStep.naturalLanguage}`);

                const recoveryBefore = await currentSummary(conn, readyTimeout);
                const recoveryStartedTick = recoveryBefore.tick;
                const recoveryResult = await executeStep(conn, recoveryStep);
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
                });

                if (!recoveryResult.success) break;
            }
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
            plan,
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
