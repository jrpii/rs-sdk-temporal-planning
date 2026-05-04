#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { safeModelName } from './domain-model';
import type { EpisodeTrace, PlannerMethod, TaskSpec, VerifierResult } from './schemas';

function usage(exitCode = 1): never {
    console.log(`
Run repeated experiment episodes across methods and LLMs.

Usage:
  bun experiments/run-batch.ts <task.json> --bot McPlan --runs 5 --methods few_shot,pddl,learned_domain --models none,gemma3:12b [--checkpoint runs/checkpoints/foo.sav] [--max-steps 10] [--no-force-run]

This wraps, per trial:
  1. load-save.ts <bot> <task.startState.checkpointPath> --api <api>
  2. gateway /reload/<bot> if a browser bot tab is already open
  3. sdk/cli.ts <bot> --server <server> --timeout <timeout> --launch
  4. run-episode.ts <task> --bot <bot> --method <method> [--model <model>] [--domain <domain>] [--force-run]

For model != none, the batch runner calls extract-domain.ts once per method/model
that needs an LLM-derived domain. Pass --rag to seed static_rag and
learned_domain domain extraction with the 2004 Graph RAG context.
For learned_domain, it refines the model after each episode and feeds the refined
model into the next episode.
`.trim());
    process.exit(exitCode);
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);

    const taskPath = args.find(arg => !arg.startsWith('-'));
    let botName = '';
    let runs = 1;
    let methods = 'few_shot';
    let models = 'none';
    let server = 'localhost';
    let api = 'http://localhost:8888';
    let gatewayHttp = 'http://localhost:7780';
    let apiBase = 'http://127.0.0.1:11434/v1';
    let checkpoint = '';
    let timeout = 15_000;
    let readyTimeout = 30_000;
    let settleMs = 5_000;
    let maxSteps = 0;
    let outDir = join('runs', 'batch');
    let traceDir = join('runs', 'traces');
    let domainDir = join('runs', 'domain-models');
    let refine = true;
    let rag = false;
    let forceRun = true;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--bot') botName = args[++i] ?? '';
        else if (arg === '--runs') runs = Number(args[++i] ?? runs);
        else if (arg === '--methods') methods = args[++i] ?? methods;
        else if (arg === '--models') models = args[++i] ?? models;
        else if (arg === '--server') server = args[++i] ?? server;
        else if (arg === '--api') api = args[++i] ?? api;
        else if (arg === '--gateway-http') gatewayHttp = args[++i] ?? gatewayHttp;
        else if (arg === '--api-base') apiBase = args[++i] ?? apiBase;
        else if (arg === '--checkpoint') checkpoint = args[++i] ?? checkpoint;
        else if (arg === '--timeout') timeout = Number(args[++i] ?? timeout);
        else if (arg === '--ready-timeout') readyTimeout = Number(args[++i] ?? readyTimeout);
        else if (arg === '--settle-ms') settleMs = Number(args[++i] ?? settleMs);
        else if (arg === '--max-steps') maxSteps = Number(args[++i] ?? maxSteps);
        else if (arg === '--out') outDir = args[++i] ?? outDir;
        else if (arg === '--trace-dir') traceDir = args[++i] ?? traceDir;
        else if (arg === '--domain-dir') domainDir = args[++i] ?? domainDir;
        else if (arg === '--no-refine') refine = false;
        else if (arg === '--rag') rag = true;
        else if (arg === '--force-run') forceRun = true;
        else if (arg === '--no-force-run') forceRun = false;
    }

    if (!taskPath || !botName || !Number.isFinite(runs) || runs < 1) usage();
    return {
        taskPath,
        botName,
        runs,
        methods: methods.split(',').map(m => m.trim()).filter(Boolean) as PlannerMethod[],
        models: models.split(',').map(m => m.trim()).filter(Boolean),
        server,
        api,
        gatewayHttp,
        apiBase,
        checkpoint,
        timeout,
        readyTimeout,
        settleMs,
        maxSteps,
        outDir,
        traceDir,
        domainDir,
        refine,
        rag,
        forceRun,
    };
}

function readTask(path: string): TaskSpec {
    return JSON.parse(readFileSync(path, 'utf8')) as TaskSpec;
}

async function waitForGatewayReady(gatewayHttp: string, botName: string, timeoutMs: number): Promise<void> {
    const url = `${gatewayHttp.replace(/\/$/, '')}/status/${encodeURIComponent(botName)}`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                const status = await response.json();
                if (status.status !== 'dead' && status.inGame === true && status.player) {
                    console.log(`[Batch] Bot ready at (${status.player.worldX}, ${status.player.worldZ}), stateAge=${status.stateAge ?? 'n/a'}ms`);
                    return;
                }
            }
        } catch {
            // Gateway may still be reconnecting; keep polling.
        }
        await sleep(1000);
    }
    throw new Error(`Timed out waiting ${timeoutMs}ms for ${botName} to be in-game through gateway`);
}

async function runCommand(
    cmd: string[],
    cwd = process.cwd(),
    options: { printOutput?: boolean; printCommand?: boolean } = {},
): Promise<{ ok: boolean; output: string }> {
    const printCommand = options.printCommand ?? true;
    const printOutput = options.printOutput ?? true;
    if (printCommand) console.log(`$ ${cmd.join(' ')}`);
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    const output = `${stdout}${stderr}`;
    if (printOutput) process.stdout.write(output);
    return { ok: exitCode === 0, output };
}

function latestTracePath(output: string): string | undefined {
    return output.match(/Episode trace written:\s*(.+\.json)/)?.[1]?.trim();
}

function readTraceSummary(tracePath: string | undefined): Record<string, unknown> {
    if (!tracePath || !existsSync(tracePath)) return {};

    const envelope = JSON.parse(readFileSync(tracePath, 'utf8')) as {
        trace: EpisodeTrace;
        verifier?: VerifierResult;
    };

    return {
        success: envelope.trace.metrics.success,
        totalDurationMs: envelope.trace.metrics.totalDurationMs,
        invalidActionCount: envelope.trace.metrics.invalidActionCount,
        replanningCount: envelope.trace.metrics.replanningCount,
        executionSteps: envelope.trace.execution.length,
        finalTick: envelope.trace.finalState?.tick,
        pddlDomainModelId: envelope.trace.pddlArtifacts?.domainModelId,
        pddlEmbedded: Boolean(envelope.trace.pddlArtifacts),
        verifierEvidence: envelope.verifier?.evidence?.join(' | ') ?? '',
    };
}

function domainKey(method: PlannerMethod, model: string): string {
    return `${method}|${model}`;
}

function methodUsesRag(method: PlannerMethod, ragEnabled: boolean): boolean {
    return ragEnabled && (method === 'static_rag' || method === 'learned_domain');
}

function domainPathFor(task: TaskSpec, method: PlannerMethod, model: string, domainDir: string, ragEnabled: boolean): string {
    const source = methodUsesRag(method, ragEnabled) ? 'rag' : 'internal';
    return join(domainDir, `${task.id}-${method}-${source}-${safeModelName(model)}.json`);
}

function domainUseLabel(method: PlannerMethod, model: string, ragEnabled: boolean, domainPath?: string): string {
    if (model === 'none') {
        return method === 'pddl' || method === 'learned_domain'
            ? 'default symbolic cook-shrimp domain'
            : 'scripted cook-shrimp control';
    }
    const source = methodUsesRag(method, ragEnabled) ? 'Graph RAG + LLM domain extraction' : 'LLM internal/action-doc domain extraction';
    return `${source}${domainPath ? ` (${domainPath})` : ''}`;
}

function csvValue(value: unknown): string {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(path: string, rows: Array<Record<string, unknown>>): void {
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const lines = [
        headers.join(','),
        ...rows.map(row => headers.map(header => csvValue(row[header])).join(',')),
    ];
    writeFileSync(path, `${lines.join('\n')}\n`);
}

async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function requestBrowserReload(gatewayHttp: string, botName: string): Promise<void> {
    const url = `${gatewayHttp.replace(/\/$/, '')}/reload/${encodeURIComponent(botName)}`;
    console.log(`[Batch] Reloading browser bot via ${url}`);
    try {
        const response = await fetch(url);
        const text = await response.text();
        const trimmed = text.trim();
        if (trimmed) {
            try {
                const parsed = JSON.parse(trimmed);
                console.log(`[Batch] ${parsed.message ?? trimmed}`);
            } catch {
                console.log(trimmed.slice(0, 300));
            }
        }
        if (!response.ok && response.status !== 404) {
            throw new Error(`Gateway reload failed (${response.status}): ${text.slice(0, 300)}`);
        }
    } catch (error) {
        throw new Error(`Browser reload request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function main() {
    const options = parseArgs();
    const task = readTask(options.taskPath);
    mkdirSync(options.outDir, { recursive: true });
    mkdirSync(options.traceDir, { recursive: true });

    const domainByConfig = new Map<string, string>();
    async function ensureDomain(method: PlannerMethod, model: string): Promise<string | undefined> {
        if (model === 'none') return undefined;

        const key = domainKey(method, model);
        const cached = domainByConfig.get(key);
        if (cached) return cached;

        const domainPath = domainPathFor(task, method, model, options.domainDir, options.rag);
        if (!existsSync(domainPath)) {
            const result = await runCommand([
                'bun',
                'experiments/extract-domain.ts',
                '--task',
                options.taskPath,
                '--models',
                model,
                '--api-base',
                options.apiBase,
                '--out',
                options.domainDir,
                ...(methodUsesRag(method, options.rag) ? ['--rag'] : []),
            ]);
            if (!result.ok) throw new Error(`Domain extraction failed for ${method}/${model}`);

            const legacyPath = join(options.domainDir, `${task.id}-${safeModelName(model)}.json`);
            if (legacyPath !== domainPath && existsSync(legacyPath)) {
                writeFileSync(domainPath, readFileSync(legacyPath, 'utf8'));
            }
            if (!existsSync(domainPath)) {
                throw new Error(`Domain extraction did not produce expected path: ${domainPath}`);
            }
        }

        domainByConfig.set(key, domainPath);
        return domainPath;
    }

    const rows: Array<Record<string, unknown>> = [];
    const checkpointPath = options.checkpoint || task.startState?.checkpointPath;
    const totalTrials = options.methods.length * options.models.length * options.runs;
    let trialIndex = 0;

    for (const method of options.methods) {
        for (const model of options.models) {
            for (let run = 1; run <= options.runs; run++) {
                trialIndex++;
                console.log(`\n[Batch] Trial ${trialIndex}/${totalTrials}: method=${method} model=${model} run=${run}/${options.runs}`);
                const domain = await ensureDomain(method, model);
                if (checkpointPath) {
                    console.log(`[Batch] Loading checkpoint: ${checkpointPath}`);
                    const loaded = await runCommand(
                        ['bun', 'experiments/load-save.ts', options.botName, checkpointPath, '--api', options.api],
                        process.cwd(),
                        { printOutput: false },
                    );
                    if (!loaded.ok) {
                        process.stdout.write(loaded.output);
                        throw new Error(`Checkpoint load failed for run ${run}`);
                    }
                    await requestBrowserReload(options.gatewayHttp, options.botName);
                    console.log(`[Batch] Waiting ${options.settleMs}ms for browser relog/client load...`);
                    await sleep(options.settleMs);
                }

                console.log('[Batch] Verifying bot relog...');
                const launched = await runCommand(
                    [
                        'bun',
                        'sdk/cli.ts',
                        options.botName,
                        '--server',
                        options.server,
                        '--timeout',
                        String(options.timeout),
                        '--launch',
                    ],
                    process.cwd(),
                    { printOutput: false },
                );
                if (!launched.ok) {
                    process.stdout.write(launched.output);
                    throw new Error(`Bot launch/verification failed for run ${run}`);
                }
                await waitForGatewayReady(options.gatewayHttp, options.botName, options.readyTimeout);

                const episodeCmd = [
                    'bun',
                    'experiments/run-episode.ts',
                    options.taskPath,
                    '--bot',
                    options.botName,
                    '--method',
                    method,
                    '--server',
                    options.server,
                    '--out',
                    options.traceDir,
                    '--model',
                    model,
                ];
                if (options.forceRun) {
                    episodeCmd.push('--force-run', '--api', options.api);
                }
                if (options.maxSteps > 0) {
                    episodeCmd.push('--max-steps', String(options.maxSteps));
                }
                episodeCmd.push('--ready-timeout', String(options.readyTimeout));
                if (domain) {
                    episodeCmd.push('--domain', domain);
                }

                console.log('[Batch] Running episode...');
                const episode = await runCommand(episodeCmd, process.cwd(), { printOutput: false });
                const tracePath = latestTracePath(episode.output);
                const traceSummary = readTraceSummary(tracePath);
                if (!episode.ok) process.stdout.write(episode.output);
                rows.push({
                    taskId: task.id,
                    method,
                    model,
                    run,
                    ok: episode.ok,
                    tracePath,
                    ...traceSummary,
                    domainPath: domain,
                    domainUse: domainUseLabel(method, model, options.rag, domain),
                    ragContextEnabled: methodUsesRag(method, options.rag),
                    completedAt: new Date().toISOString(),
                });

                const successLabel = traceSummary.success === true ? 'PASS' : 'FAIL';
                console.log(
                    `[Batch] ${successLabel} trace=${tracePath ?? 'none'} ` +
                    `steps=${traceSummary.executionSteps ?? '?'} ` +
                    `durationMs=${traceSummary.totalDurationMs ?? '?'} ` +
                    `evidence=${traceSummary.verifierEvidence ?? ''}`,
                );

                if (
                    options.refine &&
                    method === 'learned_domain' &&
                    model !== 'none' &&
                    episode.ok &&
                    tracePath &&
                    domain
                ) {
                    const refinedDomain = join(options.domainDir, `${task.id}-${safeModelName(model)}-learned-run-${run}.json`);
                    const refined = await runCommand([
                        'bun',
                        'experiments/refine-domain.ts',
                        '--domain',
                        domain,
                        '--trace',
                        tracePath,
                        '--model',
                        model,
                        '--api-base',
                        options.apiBase,
                        '--out',
                        refinedDomain,
                    ]);
                    if (refined.ok) {
                        domainByConfig.set(domainKey(method, model), refinedDomain);
                    } else {
                        console.warn(`Refinement failed for ${model} after run ${run}; keeping previous domain model.`);
                    }
                }
            }
        }
    }

    const outPath = join(options.outDir, `batch-${task.id}-${Date.now()}.json`);
    const csvPath = outPath.replace(/\.json$/i, '.csv');
    const aggregates = aggregateRows(rows);
    writeFileSync(outPath, JSON.stringify({ options, aggregates, rows }, null, 2));
    writeCsv(csvPath, rows);
    console.log(`Batch summary written: ${outPath}`);
    console.log(`Batch CSV written: ${csvPath}`);
}

function aggregateRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
        const key = `${row.method}|${row.model}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    return [...groups.entries()].map(([key, group]) => {
        const [method, model] = key.split('|');
        const successes = group.filter(row => row.success === true).length;
        const durations = group.map(row => Number(row.totalDurationMs ?? 0)).filter(Number.isFinite);
        const invalids = group.map(row => Number(row.invalidActionCount ?? 0)).filter(Number.isFinite);
        return {
            method,
            model,
            runs: group.length,
            successes,
            successRate: group.length ? successes / group.length : 0,
            avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
            avgInvalidActions: invalids.length ? invalids.reduce((a, b) => a + b, 0) / invalids.length : 0,
        };
    });
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
