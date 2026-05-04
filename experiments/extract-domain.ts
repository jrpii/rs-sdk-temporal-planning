#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ACTION_DOCS, defaultCookShrimpDomain, safeModelName } from './domain-model';
import { exportPddl } from './pddl';
import { chatCompletion, extractJsonObject } from './llm';
import type { LearnedDomainModel, StateSummary, TaskSpec } from './schemas';

function usage(exitCode = 1): never {
    console.log(`
Ask one or more LLMs to draft a symbolic action/domain model for a task.

Usage:
  bun experiments/extract-domain.ts --task experiments/task-presets/cook-shrimp-alkharid.json --models gemma3:12b,gemma3:4b [--api-base http://127.0.0.1:11434/v1] [--out runs/domain-models]
  bun experiments/extract-domain.ts --task experiments/task-presets/cook-shrimp-alkharid.json --models gemma3:12b --rag
  bun experiments/extract-domain.ts --task experiments/task-presets/cook-shrimp-alkharid.json --stub

The output JSON can be passed to:
  bun experiments/run-episode.ts <task.json> --bot McPlan --method pddl --domain <domain.json>
`.trim());
    process.exit(exitCode);
}

function parseArgs() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) usage(0);

    let taskPath = '';
    let models = 'gemma3:12b';
    let apiBase = 'http://127.0.0.1:11434/v1';
    let outDir = join('runs', 'domain-models');
    let stub = false;
    let rag = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--task') taskPath = args[++i] ?? '';
        else if (arg === '--models') models = args[++i] ?? models;
        else if (arg === '--api-base') apiBase = args[++i] ?? apiBase;
        else if (arg === '--out') outDir = args[++i] ?? outDir;
        else if (arg === '--stub') stub = true;
        else if (arg === '--rag') rag = true;
    }

    if (!taskPath) usage();
    return { taskPath, models: models.split(',').map(m => m.trim()).filter(Boolean), apiBase, outDir, stub, rag };
}

function readTask(path: string): TaskSpec {
    return JSON.parse(readFileSync(path, 'utf8')) as TaskSpec;
}

function emptyState(): StateSummary {
    return {
        tick: 0,
        inGame: true,
        skills: { Cooking: { level: 1, baseLevel: 1, xp: 0 } },
        inventory: { 'Raw shrimps': 1 },
        equipment: [],
        nearbyNpcs: [],
        nearbyLocs: [{ name: 'Range', distance: 2, options: [] }],
        groundItems: [],
        ui: { dialogOpen: false, interfaceOpen: false, shopOpen: false, bankOpen: false, modalOpen: false },
        recentMessages: [],
    };
}

async function retrieveGraphRagContext(task: TaskSpec): Promise<string> {
    const question = `What wiki facts support a planning domain model for this RuneScape task: ${task.description}`;
    const proc = Bun.spawn([
        'python',
        'osrs_agent.py',
        '--question',
        question,
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
        throw new Error(`Graph RAG retrieval failed: ${stderr || stdout}`);
    }
    return stdout;
}

function domainPrompt(task: TaskSpec, retrievalContext = ''): string {
    return `
Task:
${JSON.stringify(task, null, 2)}

${ACTION_DOCS}

${retrievalContext ? `Retrieved 2004 wiki / Graph RAG context:\n${retrievalContext}\n` : ''}

Use only the provided actions, the task JSON, ${retrievalContext ? 'retrieved context,' : ''} and your internal knowledge of 2004 RuneScape.
Draft a compact symbolic domain model that predicts action preconditions and effects.

Return ONLY JSON matching this TypeScript shape:
{
  "id": "short-model-id",
  "taskId": "${task.id}",
  "description": "string",
  "provenance": [{ "source": "llm", "reference": "model name", "confidence": 0.0 }],
  "notes": ["uncertainties or stochastic outcomes"],
  "actions": [{
    "id": "use_item_on_cooking_source",
    "name": "Use raw shrimps on cooking source",
    "description": "string",
    "parameters": [{ "name": "raw_item", "type": "item" }, { "name": "source", "type": "facility" }],
    "preconditions": [
      { "kind": "has_item", "args": { "item": "Raw shrimps", "count": 1 }, "provenance": [{ "source": "llm", "reference": "model", "confidence": 0.7 }], "confidence": 0.7 },
      { "kind": "near_loc", "args": { "name": "Range|Fire" }, "provenance": [{ "source": "llm", "reference": "model", "confidence": 0.7 }], "confidence": 0.7 }
    ],
    "effects": [
      { "kind": "item_removed", "args": { "item": "Raw shrimps", "count": 1 }, "provenance": [{ "source": "llm", "reference": "model", "confidence": 0.7 }], "confidence": 0.7 },
      { "kind": "item_added", "args": { "item": "Shrimps", "count": 1 }, "provenance": [{ "source": "llm", "reference": "model", "confidence": 0.5 }], "confidence": 0.5 },
      { "kind": "xp_gained", "args": { "skill": "Cooking", "minXp": 1 }, "provenance": [{ "source": "llm", "reference": "model", "confidence": 0.5 }], "confidence": 0.5 }
    ],
    "negativeEvidence": []
  }]
}
`.trim();
}

function normalizeDomain(raw: unknown, task: TaskSpec, model: string): LearnedDomainModel {
    const value = raw as Partial<LearnedDomainModel>;
    const fallback = defaultCookShrimpDomain(task.id);
    return {
        ...fallback,
        ...value,
        taskId: value.taskId || task.id,
        provenance: value.provenance?.length ? value.provenance : [{ source: 'llm', reference: model, confidence: 0.5 }],
        actions: value.actions?.length ? value.actions : fallback.actions,
    };
}

async function main() {
    const { taskPath, models, apiBase, outDir, stub, rag } = parseArgs();
    const task = readTask(taskPath);
    mkdirSync(outDir, { recursive: true });
    const retrievalContext = rag ? await retrieveGraphRagContext(task) : '';

    const selectedModels = stub ? ['stub-human-default'] : models;
    for (const model of selectedModels) {
        const rawText = stub
            ? JSON.stringify(defaultCookShrimpDomain(task.id), null, 2)
            : await chatCompletion({
                apiBase,
                model,
                messages: [
                    { role: 'system', content: 'You extract symbolic planning domain models. Return strict JSON only.' },
                    { role: 'user', content: domainPrompt(task, retrievalContext) },
                ],
            });

        const rawDomain = extractJsonObject(rawText);
        const domain = normalizeDomain(rawDomain, task, model);
        const safe = safeModelName(model);
        const jsonPath = join(outDir, `${task.id}-${safe}.json`);
        const rawPath = join(outDir, `${task.id}-${safe}.raw.txt`);
        const pddlDomainPath = join(outDir, `${task.id}-${safe}.domain.pddl`);
        const pddlProblemPath = join(outDir, `${task.id}-${safe}.problem.pddl`);
        const pddl = exportPddl(task, emptyState(), domain);

        writeFileSync(jsonPath, JSON.stringify(domain, null, 2));
        writeFileSync(rawPath, rawText);
        writeFileSync(pddlDomainPath, pddl.domain);
        writeFileSync(pddlProblemPath, pddl.problem);
        console.log(`Domain model written: ${jsonPath}`);
        console.log(`PDDL written: ${pddlDomainPath} ${pddlProblemPath}`);
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
