#!/usr/bin/env bun
/**
 * Verifies that transition-log rows for an episode reproduce the same verifier outcome
 * as recomputing from logged summaries (cumulative delta from first summaryBefore to last summaryAfter).
 *
 * Usage:
 *   bun experiments/replay-transition-log.ts --episode <episodeId> --log runs/transitions/global.jsonl --task experiments/task-presets/cook-shrimp-alkharid.json
 *
 * Optional cross-check against a trace JSON written by run-episode:
 *   bun experiments/replay-transition-log.ts --episode ... --log ... --task ... --trace runs/traces/<file>.json
 */
import { readFileSync } from 'fs';
import { diffStateSummaries } from './state-summary';
import type { EpisodeTrace, TaskSpec, TransitionLogRecord } from './schemas';
import { evaluateVerifiers } from './verifier';

function usage(code = 1): never {
    console.error(`
Usage:
  bun experiments/replay-transition-log.ts --episode EPISODE_ID --log FILE.jsonl --task task.json [--trace trace.json]

Reads all JSONL rows matching episodeId, sorts by stepOrdinal, recomputes verifier result from
first summaryBefore → last summaryAfter and compares to logged verifierProgressSuccess on final row.
`.trim());
    process.exit(code);
}

function parseArgs(): { episodeId: string; logPath: string; taskPath: string; tracePath?: string } {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);
    let episodeId = '';
    let logPath = '';
    let taskPath = '';
    let tracePath: string | undefined;
    for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if (a === '--episode') episodeId = args[++i] ?? '';
        else if (a === '--log') logPath = args[++i] ?? '';
        else if (a === '--task') taskPath = args[++i] ?? '';
        else if (a === '--trace') tracePath = args[++i];
    }
    if (!episodeId || !logPath || !taskPath) usage();
    return { episodeId, logPath, taskPath, tracePath };
}

function loadRecords(logPath: string, episodeId: string): TransitionLogRecord[] {
    const text = readFileSync(logPath, 'utf8');
    const rows: TransitionLogRecord[] = [];
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
            const row = JSON.parse(t) as TransitionLogRecord;
            if (row.episodeId === episodeId) rows.push(row);
        } catch {
            console.warn('[replay] skip bad JSON line');
        }
    }
    rows.sort((a, b) => a.stepOrdinal - b.stepOrdinal);
    return rows;
}

async function main() {
    const { episodeId, logPath, taskPath, tracePath } = parseArgs();
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as TaskSpec;
    const records = loadRecords(logPath, episodeId);
    if (records.length === 0) {
        console.error(`No transition rows found for episodeId=${episodeId} in ${logPath}`);
        process.exit(2);
    }

    const first = records[0]!;
    const last = records[records.length - 1]!;
    const recomputedDelta = diffStateSummaries(first.summaryBefore, last.summaryAfter);
    const verifier = evaluateVerifiers(last.summaryAfter, task.success, recomputedDelta);

    const loggedFinalSuccess = last.verifierProgressSuccess;
    const match = verifier.success === loggedFinalSuccess;

    console.log(JSON.stringify({
        episodeId,
        rows: records.length,
        recomputedVerifierSuccess: verifier.success,
        loggedFinalVerifierSuccess: loggedFinalSuccess,
        verifierEvidenceMatch: match,
        evidence: verifier.evidence,
    }, null, 2));

    if (!match) {
        console.error('Mismatch between recomputed verifiers and final row verifierProgressSuccess.');
        process.exit(3);
    }

    if (tracePath) {
        const envelope = JSON.parse(readFileSync(tracePath, 'utf8')) as { trace: EpisodeTrace; verifier?: { success: boolean } };
        const trace = envelope.trace;
        if (trace.episodeId !== episodeId) {
            console.warn(`[replay] trace.episodeId (${trace.episodeId}) !== --episode (${episodeId}); continuing anyway`);
        }
        const traceVerifier = envelope.verifier?.success;
        if (traceVerifier !== undefined && traceVerifier !== verifier.success) {
            console.error(`Trace verifier.success (${traceVerifier}) !== replay (${verifier.success})`);
            process.exit(4);
        }
        console.log(JSON.stringify({ traceCrossCheck: 'ok', traceVerifierSuccess: traceVerifier }, null, 2));
    }
}

main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
});
