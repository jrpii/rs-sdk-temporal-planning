#!/usr/bin/env bun
/**
 * Filter structured OSRS Wiki records to pages likely available at a chosen
 * in-universe cutoff date (wiki release/addition vs removal dates).
 *
 * Default cutoff matches the preservation-style “revision 254” snapshot
 * (September 7, 2004). Override with `--cutoff` for other eras (for example
 * `2004-12-31` for “anything in calendar year 2004”, or `2007-12-31` for 2007).
 *
 * Strict vs lax (same as the prior 2007 workflow):
 * - Default: drop records with unknown addition date.
 * - Lax: pass `--include-unknown-added` for a recall-oriented superset.
 *
 * Example:
 *   bun tools/osrs-wiki-filter-temporal.ts
 *   bun tools/osrs-wiki-filter-temporal.ts --include-unknown-added --out data/wiki/osrs-wiki-structured-2004-plus-unknown.jsonl --stats-out data/wiki/osrs-wiki-structured-2004-plus-unknown-stats.json
 */

// Bun provides Node-compatible built-ins at runtime; these ignores keep the
// editor quiet when the repo is opened before `bun install` has restored types.
// @ts-ignore
import { createReadStream, createWriteStream } from 'fs';
// @ts-ignore
import { mkdir, writeFile } from 'fs/promises';
// @ts-ignore
import { dirname } from 'path';
// @ts-ignore
import { createInterface } from 'readline';

const DEFAULT_INPUT = 'data/wiki/osrs-wiki-structured.jsonl';
const DEFAULT_OUTPUT = 'data/wiki/osrs-wiki-structured-2004.jsonl';
const DEFAULT_STATS = 'data/wiki/osrs-wiki-structured-2004-stats.json';
/** In-universe snapshot: revision 254 target date (Sept 7, 2004). */
const DEFAULT_CUTOFF = '2004-09-07';

const runtimeProcess = (globalThis as any).process as {
    argv: string[];
    exit(code?: number): never;
};

interface Options {
    input: string;
    output: string;
    statsOut: string;
    cutoff: string;
    includeUnknownAdded: boolean;
    limit?: number;
}

interface DateParts {
    raw: string;
    year: number;
    month?: number;
    day?: number;
}

interface StructuredRecord {
    page?: { title?: string };
    entity?: { primaryType?: string };
    dateAdded?: string | null;
    dateRemoved?: string | null;
    lifecycle?: {
        added?: { value?: string } | null;
        removed?: { value?: string } | null;
        contentYears?: number[];
    };
}

interface FilterDecision {
    include: boolean;
    reason: string;
    added?: DateParts;
    removed?: DateParts;
}

interface FilterStats {
    input: string;
    output: string;
    cutoff: string;
    includeUnknownAdded: boolean;
    read: number;
    written: number;
    parseErrors: number;
    excluded: Record<string, number>;
    includedByPrimaryType: Record<string, number>;
    excludedByPrimaryType: Record<string, number>;
    sampleExcluded: Array<{ title: string; reason: string; dateAdded?: string | null; dateRemoved?: string | null }>;
}

function printUsage(): void {
    console.log(`
Usage:
  bun tools/osrs-wiki-filter-temporal.ts [options]

Options:
  --input <path>                 Structured wiki JSONL. Default: ${DEFAULT_INPUT}
  --out <path>                   Filtered output JSONL. Default: ${DEFAULT_OUTPUT}
  --stats-out <path>             Stats JSON path. Default: ${DEFAULT_STATS}
  --cutoff <YYYY-MM-DD>          Availability cutoff. Default: ${DEFAULT_CUTOFF}
  --include-unknown-added        Keep records with unknown release/addition date.
  --limit <n>                    Stop after reading n records, for smoke tests.
  -h, --help                     Show this help.
`);
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        input: DEFAULT_INPUT,
        output: DEFAULT_OUTPUT,
        statsOut: DEFAULT_STATS,
        cutoff: DEFAULT_CUTOFF,
        includeUnknownAdded: false,
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        switch (arg) {
            case '--input':
                if (!next) throw new Error('--input requires a path');
                options.input = next;
                i++;
                break;
            case '--out':
            case '--output':
                if (!next) throw new Error('--out requires a path');
                options.output = next;
                i++;
                break;
            case '--stats-out':
                if (!next) throw new Error('--stats-out requires a path');
                options.statsOut = next;
                i++;
                break;
            case '--cutoff':
                if (!next) throw new Error('--cutoff requires a YYYY-MM-DD value');
                options.cutoff = next;
                i++;
                break;
            case '--include-unknown-added':
                options.includeUnknownAdded = true;
                break;
            case '--limit':
                if (!next) throw new Error('--limit requires a number');
                options.limit = Number(next);
                i++;
                break;
            case '-h':
            case '--help':
                printUsage();
                runtimeProcess.exit(0);
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!parseDateParts(options.cutoff)) {
        throw new Error(`Invalid --cutoff date: ${options.cutoff}`);
    }
    return options;
}

function parseDateParts(value: string | null | undefined): DateParts | null {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw || /^unknown$/i.test(raw)) return null;

    const match = raw.match(/^((?:19|20)\d{2})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/);
    if (!match) return null;
    return {
        raw,
        year: Number(match[1]),
        month: match[2] ? Number(match[2]) : undefined,
        day: match[3] ? Number(match[3]) : undefined,
    };
}

function compareDateParts(a: DateParts, b: DateParts): number {
    const aMonth = a.month ?? 12;
    const bMonth = b.month ?? 12;
    const aDay = a.day ?? 31;
    const bDay = b.day ?? 31;
    if (a.year !== b.year) return a.year - b.year;
    if (aMonth !== bMonth) return aMonth - bMonth;
    return aDay - bDay;
}

function firstContentYear(record: StructuredRecord): DateParts | null {
    const years = record.lifecycle?.contentYears?.filter(year => Number.isFinite(year)).sort((a, b) => a - b) ?? [];
    if (years.length === 0) return null;
    return { raw: String(years[0]), year: years[0] };
}

function addedDate(record: StructuredRecord): DateParts | null {
    return parseDateParts(record.dateAdded)
        ?? parseDateParts(record.lifecycle?.added?.value)
        ?? firstContentYear(record);
}

function removedDate(record: StructuredRecord): DateParts | null {
    return parseDateParts(record.dateRemoved)
        ?? parseDateParts(record.lifecycle?.removed?.value);
}

function shouldInclude(record: StructuredRecord, cutoff: DateParts, includeUnknownAdded: boolean): FilterDecision {
    const added = addedDate(record);
    const removed = removedDate(record);

    if (!added && !includeUnknownAdded) {
        return { include: false, reason: 'unknown_added_date', removed: removed ?? undefined };
    }
    if (added && compareDateParts(added, cutoff) > 0) {
        return { include: false, reason: 'added_after_cutoff', added, removed: removed ?? undefined };
    }
    if (removed && compareDateParts(removed, cutoff) <= 0) {
        return { include: false, reason: 'removed_on_or_before_cutoff', added: added ?? undefined, removed };
    }
    return { include: true, reason: added ? 'available_at_cutoff' : 'unknown_added_included', added: added ?? undefined, removed: removed ?? undefined };
}

async function filterStructured(options: Options): Promise<FilterStats> {
    const cutoff = parseDateParts(options.cutoff);
    if (!cutoff) throw new Error(`Invalid cutoff: ${options.cutoff}`);

    await mkdir(dirname(options.output), { recursive: true });
    await mkdir(dirname(options.statsOut), { recursive: true });

    const stats: FilterStats = {
        input: options.input,
        output: options.output,
        cutoff: options.cutoff,
        includeUnknownAdded: options.includeUnknownAdded,
        read: 0,
        written: 0,
        parseErrors: 0,
        excluded: {},
        includedByPrimaryType: {},
        excludedByPrimaryType: {},
        sampleExcluded: [],
    };

    const output = createWriteStream(options.output, { encoding: 'utf8' });
    const rl = createInterface({
        input: createReadStream(options.input, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        if (options.limit && stats.read >= options.limit) break;
        stats.read++;

        try {
            const record = JSON.parse(line) as StructuredRecord;
            const primaryType = record.entity?.primaryType ?? 'unknown';
            const decision = shouldInclude(record, cutoff, options.includeUnknownAdded);
            if (decision.include) {
                // Preserve the structured record exactly as emitted by the structuring
                // pipeline. The filter should only include/exclude records, never
                // compact or normalize fields.
                output.write(`${line}\n`);
                stats.written++;
                stats.includedByPrimaryType[primaryType] = (stats.includedByPrimaryType[primaryType] ?? 0) + 1;
            } else {
                stats.excluded[decision.reason] = (stats.excluded[decision.reason] ?? 0) + 1;
                stats.excludedByPrimaryType[primaryType] = (stats.excludedByPrimaryType[primaryType] ?? 0) + 1;
                if (stats.sampleExcluded.length < 50) {
                    stats.sampleExcluded.push({
                        title: record.page?.title ?? 'unknown',
                        reason: decision.reason,
                        dateAdded: record.dateAdded ?? null,
                        dateRemoved: record.dateRemoved ?? null,
                    });
                }
            }
        } catch {
            stats.parseErrors++;
        }

        if (stats.read % 10_000 === 0) {
            console.log(`Read ${stats.read.toLocaleString()}, written ${stats.written.toLocaleString()}...`);
        }
    }

    await new Promise<void>((resolve, reject) => {
        output.end(() => resolve());
        output.on('error', reject);
    });

    await writeFile(options.statsOut, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
    return stats;
}

try {
    const options = parseArgs(runtimeProcess.argv);
    const stats = await filterStructured(options);
    console.log(`Done. Read: ${stats.read}, written: ${stats.written}, parse errors: ${stats.parseErrors}`);
    console.log(`Excluded: ${JSON.stringify(stats.excluded)}`);
    console.log(`Stats: ${options.statsOut}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    runtimeProcess.exit(1);
}
