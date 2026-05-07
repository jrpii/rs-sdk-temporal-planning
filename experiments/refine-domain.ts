#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { ACTION_DOCS, EXECUTABLE_ACTION_IDS, safeModelName, sanitizeLearnedDomainModel } from './domain-model';
import { exportPddl } from './pddl';
import { chatCompletion, extractJsonObject } from './llm';
import type { EpisodeTrace, LearnedDomainModel } from './schemas';
import type { KnowledgeBaseData } from './knowledge-base';

function usage(exitCode = 1): never {
    console.log(`
Refine a learned domain model from an episode trace.

Usage:
  bun experiments/refine-domain.ts --domain runs/domain-models/model.json --trace runs/traces/episode.json --model gemma3:12b [--kb runs/kb/global.json] [--out runs/domain-models/refined.json]

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
    let kbPath = '';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--domain') domainPath = args[++i] ?? '';
        else if (arg === '--trace') tracePath = args[++i] ?? '';
        else if (arg === '--model') model = args[++i] ?? model;
        else if (arg === '--api-base') apiBase = args[++i] ?? apiBase;
        else if (arg === '--out') outPath = args[++i] ?? '';
        else if (arg === '--kb') kbPath = args[++i] ?? '';
    }

    if (!domainPath || !tracePath) usage();
    if (!outPath) {
        outPath = join('runs', 'domain-models', `${Date.now()}-${safeModelName(model)}-refined.json`);
    }
    return { domainPath, tracePath, model, apiBase, outPath, kbPath };
}

function compactKbForPrompt(kb: KnowledgeBaseData): unknown {
    const locNames = Object.keys(kb.locsByName ?? {});
    const topLocs = locNames.slice(0, 60).map(name => {
        const group = kb.locsByName[name]!;
        const ids = Object.keys(group.byId ?? {});
        return {
            name,
            ids: ids.slice(0, 10).map(id => {
                const v = group.byId[id]!;
                return {
                    id: v.id,
                    lastSeenTick: v.lastSeenTick,
                    seenCount: v.seenCount,
                    options: (v.options ?? []).slice(0, 8),
                    positions: (v.positions ?? []).slice(0, 6),
                };
            }),
        };
    });
    const npcNames = Object.keys(kb.npcsByName ?? {});
    const topNpcs = npcNames.slice(0, 40).map(name => {
        const group = kb.npcsByName[name]!;
        const variantKeys = Object.keys(group.variants ?? {});
        return {
            name,
            variants: variantKeys.slice(0, 6).map(k => {
                const v = group.variants[k]!;
                return {
                    key: k,
                    combatLevel: v.combatLevel,
                    lastSeenTick: v.lastSeenTick,
                    seenCount: v.seenCount,
                    options: (v.options ?? []).slice(0, 8),
                    positions: (v.positions ?? []).slice(0, 6),
                };
            }),
        };
    });
    return { updatedAt: kb.updatedAt, topLocs, topNpcs };
}

function refinementPrompt(domain: LearnedDomainModel, traceEnvelope: { trace: EpisodeTrace; verifier?: unknown }, kb?: KnowledgeBaseData): string {
    const compactTrace = {
        task: traceEnvelope.trace.task,
        method: traceEnvelope.trace.method,
        initialPddlProblem: traceEnvelope.trace.pddlArtifacts?.initialProblem,
        finalPddlProblem: traceEnvelope.trace.pddlArtifacts?.finalProblem,
        plan: traceEnvelope.trace.plan,
        agenticReplans: traceEnvelope.trace.agenticReplans?.map(replan => ({
            replanIndex: replan.replanIndex,
            triggeredBy: replan.triggeredBy,
            ragQueries: replan.ragQueries,
            notes: replan.notes,
            plan: replan.plan,
            learnedLessons: replan.learnedLessons,
            symbolicReplan: replan.symbolicReplan,
        })),
        currentDomainLessons: domain.lessons ?? [],
        execution: traceEnvelope.trace.execution.map(step => ({
            action: step.action,
            result: step.result,
            startedTick: step.startedTick,
            endedTick: step.endedTick,
            beforePosition: step.before.position,
            afterPosition: step.after.position,
            beforeInventory: step.before.inventory,
            afterInventory: step.after.inventory,
            beforeNearbyLocs: step.before.nearbyLocs,
            afterNearbyLocs: step.after.nearbyLocs,
            beforeNearbyNpcs: step.before.nearbyNpcs,
            afterNearbyNpcs: step.after.nearbyNpcs,
            beforeMessages: step.before.recentMessages,
            afterMessages: step.after.recentMessages,
            delta: step.delta,
        })),
        finalState: traceEnvelope.trace.finalState,
        metrics: traceEnvelope.trace.metrics,
        verifier: traceEnvelope.verifier,
    };

    return `
You are refining a symbolic planning domain model from environment feedback.

Available actions:
${ACTION_DOCS}

Previous domain model:
${JSON.stringify(domain, null, 2)}

${kb ? `Persistent knowledge base snapshot (deduped observations across runs):\n${JSON.stringify(compactKbForPrompt(kb), null, 2)}\n` : ''}

Episode trace and verifier:
${JSON.stringify(compactTrace, null, 2)}

Return ONLY a revised LearnedDomainModel JSON object.
Rules:
- Preserve valid action IDs that the executor can run. Use only executable action ids from this set:
  ${EXECUTABLE_ACTION_IDS.join(', ')}
- Keep actions executable: if you add a new action schema id not in that set, it will be ignored/broken.
- If an action was valid but stochastic (e.g. burned food), do not add a false missing precondition.
- Use negativeEvidence for true failed preconditions/reachability/action mismatch.
- If the trace shows a reachability failure followed by a recovery action such as opening a door/gate, add or refine an action schema for that recovery when executable.
- If an agentic replan or exploration step solved a failure, encode that as symbolic action preconditions/effects and a "lessons" entry so the next episode's first plan can include it.
- If the knowledge base contains stable facility coordinates (e.g. Range/Fire), encode them in "knownFacilities" so future episodes can exploit them without re-discovering.
- Evidence-to-effects mapping (critical):
  - If a step is "interact_loc" with optionPattern matching "Mine" and delta.xpGained.Mining > 0, add an "xp_gained" effect with { skill: "Mining", minXp: 1 }.
  - If a step is "interact_loc" with optionPattern matching "Mine" and delta.inventoryAdded includes "Iron ore", add an "item_added" effect with { item: "Iron ore", count: 1 }.
  - For interact_loc in general, prefer preconditions using "near_loc_option" when available: { kind: "near_loc_option", args: { loc: "<LocName>", option: "<Option>" } }.
- Prefer observed environment evidence over wiki priors when they conflict.
- If the trace shows repeated direct-action failure, consider whether a missing precondition, tool, location, or intermediate navigation action should be represented.
- Update confidence values and notes based on observed success/failure.
`.trim();
}

async function main() {
    const { domainPath, tracePath, model, apiBase, outPath, kbPath } = parseArgs();
    const domain = JSON.parse(readFileSync(domainPath, 'utf8')) as LearnedDomainModel;
    const traceEnvelope = JSON.parse(readFileSync(tracePath, 'utf8')) as { trace: EpisodeTrace; verifier?: unknown };
    const kb = kbPath ? (JSON.parse(readFileSync(kbPath, 'utf8')) as KnowledgeBaseData) : undefined;

    const rawText = await chatCompletion({
        apiBase,
        model,
        messages: [
            { role: 'system', content: 'You refine symbolic planning domain models. Return strict JSON only.' },
            { role: 'user', content: refinementPrompt(domain, traceEnvelope, kb) },
        ],
        temperature: 0.2,
    });

    const refined = sanitizeLearnedDomainModel(extractJsonObject(rawText) as LearnedDomainModel, traceEnvelope.trace.task, domain, { includeRecoveryActions: true });
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
