#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ACTION_DOCS, safeModelName } from './domain-model';
import { exportPddl } from './pddl';
import { chatCompletion, extractJsonObject } from './llm';
import type { EpisodeTrace, LearnedDomainModel } from './schemas';

function usage(exitCode = 1): never {
    console.log(`
Refine a learned domain model from an episode trace.

Usage:
  bun experiments/refine-domain.ts --domain runs/domain-models/model.json --trace runs/traces/episode.json --model gemma3:12b [--out runs/domain-models/refined.json]

The output can be fed back into run-episode.ts with --method pddl or learned_domain.
`.trim());
    process.exit(exitCode);
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);

    let domainPath = '';
    let tracePath = '';
    let model = 'gemma3:12b';
    let apiBase = 'http://127.0.0.1:11434/v1';
    let outPath = '';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--domain') domainPath = args[++i] ?? '';
        else if (arg === '--trace') tracePath = args[++i] ?? '';
        else if (arg === '--model') model = args[++i] ?? model;
        else if (arg === '--api-base') apiBase = args[++i] ?? apiBase;
        else if (arg === '--out') outPath = args[++i] ?? '';
    }

    if (!domainPath || !tracePath) usage();
    if (!outPath) {
        outPath = join('runs', 'domain-models', `${Date.now()}-${safeModelName(model)}-refined.json`);
    }
    return { domainPath, tracePath, model, apiBase, outPath };
}

function refinementPrompt(domain: LearnedDomainModel, traceEnvelope: { trace: EpisodeTrace; verifier?: unknown }): string {
    const compactTrace = {
        task: traceEnvelope.trace.task,
        method: traceEnvelope.trace.method,
        plan: traceEnvelope.trace.plan,
        execution: traceEnvelope.trace.execution.map(step => ({
            action: step.action,
            result: step.result,
            beforeInventory: step.before.inventory,
            afterInventory: step.after.inventory,
            delta: step.delta,
        })),
        metrics: traceEnvelope.trace.metrics,
        verifier: traceEnvelope.verifier,
    };

    return `
You are refining a symbolic planning domain model from environment feedback.

Available actions:
${ACTION_DOCS}

Previous domain model:
${JSON.stringify(domain, null, 2)}

Episode trace and verifier:
${JSON.stringify(compactTrace, null, 2)}

Return ONLY a revised LearnedDomainModel JSON object.
Rules:
- Preserve valid action IDs that the executor can run, especially "use_item_on_cooking_source".
- If an action was valid but stochastic (e.g. burned food), do not add a false missing precondition.
- Use negativeEvidence for true failed preconditions/reachability/action mismatch.
- Update confidence values and notes based on observed success/failure.
`.trim();
}

async function main() {
    const { domainPath, tracePath, model, apiBase, outPath } = parseArgs();
    const domain = JSON.parse(readFileSync(domainPath, 'utf8')) as LearnedDomainModel;
    const traceEnvelope = JSON.parse(readFileSync(tracePath, 'utf8')) as { trace: EpisodeTrace; verifier?: unknown };

    const rawText = await chatCompletion({
        apiBase,
        model,
        messages: [
            { role: 'system', content: 'You refine symbolic planning domain models. Return strict JSON only.' },
            { role: 'user', content: refinementPrompt(domain, traceEnvelope) },
        ],
        temperature: 0.2,
    });

    const refined = extractJsonObject(rawText) as LearnedDomainModel;
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(refined, null, 2));
    writeFileSync(outPath.replace(/\.json$/i, '.raw.txt'), rawText);

    const pddl = exportPddl(traceEnvelope.trace.task, traceEnvelope.trace.finalState ?? traceEnvelope.trace.execution[0]!.before, refined);
    writeFileSync(outPath.replace(/\.json$/i, '.domain.pddl'), pddl.domain);
    writeFileSync(outPath.replace(/\.json$/i, '.problem.pddl'), pddl.problem);
    console.log(`Refined domain model written: ${outPath}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
