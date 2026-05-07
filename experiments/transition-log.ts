import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { ActionResult, BotWorldState } from '../sdk/types';
import type {
    ExecutionPhase,
    PlannerMethod,
    StateDelta,
    StateSummary,
    TaskSpec,
    TransitionLogRecord,
    VerifierResult,
} from './schemas';

export type { TransitionLogRecord };

export const TRANSITION_LOG_SCHEMA_VERSION = 1 as const;

/** Stable hash for dedup / indexing (not cryptographic). */
export function hashStateSummary(summary: StateSummary): string {
    return String(Bun.hash(JSON.stringify(summary)));
}

export function observedWorldObjectsFromState(raw: BotWorldState | null | undefined): TransitionLogRecord['observedWorldObjects'] {
    if (!raw?.nearbyLocs?.length) return undefined;
    const level = raw.player?.level ?? 0;
    const loc: NonNullable<NonNullable<TransitionLogRecord['observedWorldObjects']>['loc']> = {};

    for (const l of raw.nearbyLocs.slice(0, 80)) {
        const name = String(l.name ?? '').trim();
        const options = (l.options ?? []).slice(0, 8);
        const variantKey = `${l.id}|${options.join('|')}`;
        loc[name] ??= { level, variants: {} };
        loc[name]!.variants[variantKey] ??= { id: l.id, options, instances: [] };
        loc[name]!.variants[variantKey]!.instances.push({
            x: l.x,
            z: l.z,
            distance: l.distance,
        });
    }

    return { loc };
}

export interface BuildTransitionRecordArgs {
    schemaVersion?: typeof TRANSITION_LOG_SCHEMA_VERSION;
    episodeId: string;
    tracePath: string;
    taskId: string;
    taskSpec: TaskSpec;
    method: PlannerMethod;
    modelName: string;
    stepOrdinal: number;
    phase: ExecutionPhase;
    actionSchemaId?: string;
    actionParams?: Record<string, unknown>;
    summaryBefore: StateSummary;
    summaryAfter: StateSummary;
    delta: StateDelta;
    result: ActionResult;
    verifierAfter: VerifierResult;
    cumulativeDeltaFromEpisodeStart: StateDelta;
    verifierProgressSuccess: boolean;
    observedWorldObjects?: TransitionLogRecord['observedWorldObjects'];
}

export function buildTransitionRecord(args: BuildTransitionRecordArgs): TransitionLogRecord {
    return {
        schemaVersion: args.schemaVersion ?? TRANSITION_LOG_SCHEMA_VERSION,
        episodeId: args.episodeId,
        tracePath: args.tracePath,
        taskId: args.taskId,
        taskSpecSnapshot: {
            id: args.taskSpec.id,
            description: args.taskSpec.description,
            maxSteps: args.taskSpec.maxSteps,
            success: args.taskSpec.success,
        },
        method: args.method,
        modelName: args.modelName,
        stepOrdinal: args.stepOrdinal,
        phase: args.phase,
        actionSchemaId: args.actionSchemaId,
        actionParams: args.actionParams ?? {},
        startedTick: args.summaryBefore.tick,
        endedTick: args.summaryAfter.tick,
        summaryBefore: args.summaryBefore,
        summaryAfter: args.summaryAfter,
        delta: args.delta,
        result: args.result,
        verifierAfter: args.verifierAfter,
        cumulativeDeltaFromEpisodeStart: args.cumulativeDeltaFromEpisodeStart,
        verifierProgressSuccess: args.verifierProgressSuccess,
        summaryBeforeHash: hashStateSummary(args.summaryBefore),
        summaryAfterHash: hashStateSummary(args.summaryAfter),
        observedWorldObjects: args.observedWorldObjects,
        recordedAt: new Date().toISOString(),
    };
}

/** Append one JSON line per destination path (global / task-isolated / trial-isolated). */
export function appendTransitionRecord(paths: string[], record: TransitionLogRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    for (const filePath of paths) {
        if (!filePath) continue;
        mkdirSync(dirname(filePath), { recursive: true });
        appendFileSync(filePath, line, 'utf8');
    }
}

export function resolveTransitionLogPaths(args: {
    taskId: string;
    globalEnabled: boolean;
    globalPath: string;
    taskIsolated: boolean;
    taskIsolatedDir: string;
    trialPath?: string;
}): string[] {
    const out = new Set<string>();
    if (args.globalEnabled && args.globalPath) out.add(args.globalPath);
    if (args.taskIsolated && args.taskIsolatedDir) {
        out.add(join(args.taskIsolatedDir, 'by-task', `${args.taskId}.jsonl`));
    }
    if (args.trialPath) out.add(args.trialPath);
    return [...out];
}
