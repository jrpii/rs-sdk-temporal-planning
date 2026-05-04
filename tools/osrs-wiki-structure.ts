#!/usr/bin/env bun
/**
 * Post-process OSRS Wiki crawl JSONL into compact structured records for
 * RAG, graph-RAG, EDA, and later domain-model extraction.
 *
 * Example:
 *   bun tools/osrs-wiki-structure.ts
 *
 * Smoke test:
 *   bun tools/osrs-wiki-structure.ts --limit 100 --out data/wiki/osrs-wiki-structured-sample.jsonl
 */

// Bun provides Node-compatible built-ins at runtime; these ignores keep the
// editor quiet when the repo is opened before `bun install` has restored types.
// @ts-ignore
import { createReadStream } from 'fs';
// @ts-ignore
import { mkdir, writeFile } from 'fs/promises';
// @ts-ignore
import { dirname, resolve } from 'path';
// @ts-ignore
import { createInterface } from 'readline';

const DEFAULT_INPUT = 'data/wiki/osrs-wiki-pages.jsonl';
const DEFAULT_OUTPUT = 'data/wiki/osrs-wiki-structured.jsonl';
const SCHEMA_VERSION = 'osrs-wiki-structured-v4';

const runtimeProcess = (globalThis as any).process as {
    argv: string[];
    exit(code?: number): never;
};

interface Options {
    input: string;
    output: string;
    limit?: number;
    keepWikitext: boolean;
    maxSections: number;
    maxLinks: number;
    statsOut?: string;
}

interface RawWikiPage {
    source?: string;
    fetchedAt?: string;
    apiUrl?: string;
    pageid?: number;
    revid?: number;
    namespace?: number;
    title: string;
    requestedTitle?: string;
    url?: string;
    requestedUrl?: string;
    crawl?: { source?: string; redirected?: boolean };
    categories?: RawCategory[];
    links?: RawLink[];
    templates?: RawLink[];
    sections?: RawSection[];
    properties?: unknown;
    htmlLength?: number;
    wikitext?: string;
    wikitextLength?: number;
}

interface RawCategory {
    category: string;
    hidden?: boolean;
    sortkey?: string;
}

interface RawLink {
    ns: number;
    title: string;
    exists?: boolean;
}

interface RawSection {
    toclevel?: number;
    level?: string;
    line?: string;
    number?: string;
    index?: string;
    anchor?: string;
}

interface ParsedTemplate {
    name: string;
    normalizedName: string;
    params: Record<string, string>;
    positional: string[];
}

interface DateCandidate {
    value: string;
    precision: 'day' | 'month' | 'year' | 'raw';
    raw: string;
    source: string;
}

interface ExtractedLink {
    target: string;
    label: string;
}

interface StructuredRecord {
    schemaVersion: string;
    source: string;
    extractedAt: string;
    page: {
        pageid?: number;
        revid?: number;
        namespace?: number;
        title: string;
        url?: string;
        fetchedAt?: string;
        sourceCrawl?: string;
        redirected?: boolean;
    };
    entity: {
        title: string;
        normalizedTitle: string;
        primaryType: string;
        types: string[];
        aliases: string[];
        members?: boolean;
        tradeable?: boolean;
        equipable?: boolean;
    };
    dateAdded: string | null;
    dateRemoved: string | null;
    lifecycle: {
        added: DateCandidate | null;
        removed: DateCandidate | null;
        addedCandidates: DateCandidate[];
        removedCandidates: DateCandidate[];
        contentYears: number[];
    };
    taxonomy: {
        categories: string[];
        hiddenCategories: string[];
        templates: string[];
        infoboxTemplates: string[];
        tags: string[];
    };
    infoboxes: Array<{
        template: string;
        params: Record<string, string>;
        normalizedFields: Record<string, string[]>;
    }>;
    facts: {
        ids: Array<{ field: string; value: number; raw: string }>;
        maps: Array<{ field: string; x?: number; y?: number; plane?: number; radius?: number; type?: string; name?: string }>;
        actions: string[];
        variants: Array<{
            index: number;
            label?: string;
            name?: string;
            release?: string;
            update?: string;
            id?: number;
            actions: string[];
            quest?: string;
            location?: string;
            examine?: string;
            maps: Array<{ field: string; x?: number; y?: number; plane?: number; radius?: number; type?: string; name?: string }>;
            fields: Record<string, string>;
        }>;
        equipment: {
            slot?: string;
            attackSpeed?: number;
            attackRange?: number;
            combatStyle?: string;
            bonuses: Record<string, number>;
        } | null;
        recipes: Array<{
            skills: Array<{ name: string; level?: number; xp?: number; boostable?: boolean }>;
            tools: string[];
            facilities: string[];
            materials: Array<{ item: string; quantity?: number; cost?: string }>;
            outputs: Array<{ item: string; quantity?: number; cost?: string }>;
            ticks?: number;
            members?: boolean;
            rawParams: Record<string, string>;
        }>;
        fields: Record<string, string[]>;
    };
    relations: {
        outgoingLinks: string[];
        outgoingLinkCount: number;
        infoboxLinks: Array<{ field: string; target: string; label: string }>;
    };
    content: {
        lead: string;
        leadLinks: ExtractedLink[];
        plainText: string;
        wikitext?: string;
        lengths: {
            html?: number;
            wikitext?: number;
            plainText: number;
        };
        sections: Array<{
            heading: string;
            level: number;
            kind: string;
            path: string[];
            anchor?: string;
            plainText: string;
            wikitext?: string;
            links: ExtractedLink[];
            templates: Array<{
                name: string;
                params: Record<string, string>;
                normalizedFields: Record<string, string[]>;
                positional: string[];
            }>;
        }>;
    };
}

interface RunStats {
    processed: number;
    written: number;
    errors: number;
    byPrimaryType: Record<string, number>;
    withDateAdded: number;
    withDateRemoved: number;
}

function printUsage(): void {
    console.log(`
Usage:
  bun tools/osrs-wiki-structure.ts [options]

Options:
  --input <path>       Input crawl JSONL. Default: ${DEFAULT_INPUT}
  --out <path>         Structured output JSONL. Default: ${DEFAULT_OUTPUT}
  --limit <n>          Stop after n input records; useful for smoke tests.
  --no-wikitext        Do not copy raw wikitext into structured records.
  --max-sections <n>   Maximum sections to keep per page. Default: 50
  --max-links <n>      Maximum outgoing article links to keep per page. Default: 500
  --stats-out <path>   Write run stats JSON. Default: <out>.stats.json
  -h, --help           Show this help.
`);
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}

function parseNonNegativeInteger(value: string, flag: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${flag} must be a non-negative integer`);
    }
    return parsed;
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        input: DEFAULT_INPUT,
        output: DEFAULT_OUTPUT,
        keepWikitext: true,
        maxSections: 50,
        maxLinks: 500,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '-h':
            case '--help':
                printUsage();
                runtimeProcess.exit(0);
                break;
            case '--input':
                options.input = requireValue(argv, i, arg);
                i++;
                break;
            case '--out':
            case '--output':
                options.output = requireValue(argv, i, arg);
                i++;
                break;
            case '--limit':
                options.limit = parseNonNegativeInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--no-wikitext':
                options.keepWikitext = false;
                break;
            case '--max-sections':
                options.maxSections = parseNonNegativeInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--max-links':
                options.maxLinks = parseNonNegativeInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--stats-out':
                options.statsOut = requireValue(argv, i, arg);
                i++;
                break;
            default:
                throw new Error(`Unknown option: ${arg}`);
        }
    }

    return options;
}

function normalizeTitle(title: string): string {
    return title.replace(/_/g, ' ').trim().toLowerCase();
}

function normalizeName(value: string): string {
    return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value: string): string {
    return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeKind(value: string): string {
    return normalizeKey(value)
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'section';
}

function baseFieldName(value: string): string {
    return normalizeKey(value).replace(/\d+$/, '').trim();
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.map(normalizeName).filter(Boolean))];
}

function stripHtmlEntities(value: string): string {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&apos;/g, "'");
}

function stripComments(text: string): string {
    return text.replace(/<!--[\s\S]*?-->/g, '');
}

function findTopLevelEquals(value: string): number {
    let templateDepth = 0;
    let linkDepth = 0;

    for (let i = 0; i < value.length; i++) {
        const pair = value.slice(i, i + 2);
        if (pair === '{{') {
            templateDepth++;
            i++;
            continue;
        }
        if (pair === '}}' && templateDepth > 0) {
            templateDepth--;
            i++;
            continue;
        }
        if (pair === '[[') {
            linkDepth++;
            i++;
            continue;
        }
        if (pair === ']]' && linkDepth > 0) {
            linkDepth--;
            i++;
            continue;
        }
        if (value[i] === '=' && templateDepth === 0 && linkDepth === 0) {
            return i;
        }
    }

    return -1;
}

function splitTopLevel(value: string, delimiter: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let templateDepth = 0;
    let linkDepth = 0;

    for (let i = 0; i < value.length; i++) {
        const pair = value.slice(i, i + 2);
        if (pair === '{{') {
            templateDepth++;
            i++;
            continue;
        }
        if (pair === '}}' && templateDepth > 0) {
            templateDepth--;
            i++;
            continue;
        }
        if (pair === '[[') {
            linkDepth++;
            i++;
            continue;
        }
        if (pair === ']]' && linkDepth > 0) {
            linkDepth--;
            i++;
            continue;
        }
        if (value[i] === delimiter && templateDepth === 0 && linkDepth === 0) {
            parts.push(value.slice(start, i));
            start = i + 1;
        }
    }

    parts.push(value.slice(start));
    return parts;
}

function extractTopLevelTemplateBodies(wikitext: string): string[] {
    const bodies: string[] = [];
    let depth = 0;
    let start = -1;

    for (let i = 0; i < wikitext.length - 1; i++) {
        const pair = wikitext.slice(i, i + 2);
        if (pair === '{{' && wikitext[i + 2] !== '{') {
            if (depth === 0) {
                start = i + 2;
            }
            depth++;
            i++;
            continue;
        }
        if (pair === '}}' && depth > 0) {
            depth--;
            if (depth === 0 && start !== -1) {
                bodies.push(wikitext.slice(start, i));
                start = -1;
            }
            i++;
        }
    }

    return bodies;
}

function parseTemplate(body: string): ParsedTemplate | null {
    const parts = splitTopLevel(body, '|');
    const rawName = parts.shift()?.trim();
    if (!rawName) {
        return null;
    }

    const params: Record<string, string> = {};
    const positional: string[] = [];

    for (const part of parts) {
        const eq = findTopLevelEquals(part);
        if (eq === -1) {
            positional.push(part.trim());
        } else {
            const key = part.slice(0, eq).trim();
            const value = part.slice(eq + 1).trim();
            if (key) {
                params[key] = value;
            }
        }
    }

    return {
        name: normalizeName(rawName),
        normalizedName: normalizeKey(rawName),
        params,
        positional,
    };
}

function structureTemplate(template: ParsedTemplate): {
    name: string;
    params: Record<string, string>;
    normalizedFields: Record<string, string[]>;
    positional: string[];
} {
    return {
        name: template.name,
        params: template.params,
        normalizedFields: normalizeInfoboxFields(template.params),
        positional: template.positional.map(stripWikiMarkup).filter(Boolean),
    };
}

function parseTemplates(wikitext: string): ParsedTemplate[] {
    return extractTopLevelTemplateBodies(stripComments(wikitext))
        .map(parseTemplate)
        .filter((template): template is ParsedTemplate => template !== null);
}

function removeTemplates(text: string): string {
    let current = text;
    for (let pass = 0; pass < 20; pass++) {
        const next = current.replace(/\{\{[^{}]*\}\}/g, ' ');
        if (next === current) {
            return next;
        }
        current = next;
    }
    return current;
}

function extractWikiLinks(value: string): ExtractedLink[] {
    const links: ExtractedLink[] = [];
    const regex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(value)) !== null) {
        const target = normalizeName(match[1] ?? '');
        if (!target || /^(file|image|category):/i.test(target)) {
            continue;
        }
        links.push({
            target,
            label: stripWikiMarkup(match[2] ?? target),
        });
    }

    return links;
}

function stripWikiMarkup(value: string): string {
    let text = stripComments(value);
    text = text.replace(/\{\|[\s\S]*?\n\|\}/g, ' ');
    text = text.replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ');
    text = text.replace(/<ref\b[^/>]*\/>/gi, ' ');
    text = text.replace(/\{\{mes\|([^{}|]+)(?:\|[^{}]*)?\}\}/gi, '$1');
    text = text.replace(/\[\[(?:File|Image):[^\]]+\]\]/gi, ' ');
    text = text.replace(/\[\[Category:[^\]]+\]\]/gi, ' ');
    text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, '$2');
    text = text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, '$1');
    text = text.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1');
    text = text.replace(/\[https?:\/\/[^\s\]]+\]/g, ' ');
    text = removeTemplates(text);
    text = text.replace(/'{2,5}/g, '');
    text = text.replace(/={2,}\s*([^=]+?)\s*={2,}/g, '$1');
    text = text.replace(/<[^>]+>/g, ' ');
    text = stripHtmlEntities(text);
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

function stripLeadingTopMatter(wikitext: string): string {
    let index = 0;
    const text = stripComments(wikitext);

    const skipWhitespace = (): void => {
        while (/\s/.test(text[index] ?? '')) {
            index++;
        }
    };

    const consumeBalanced = (open: string, close: string): boolean => {
        if (text.slice(index, index + open.length) !== open) {
            return false;
        }

        let depth = 0;
        for (let i = index; i < text.length - 1; i++) {
            const pair = text.slice(i, i + 2);
            if (pair === open) {
                depth++;
                i++;
                continue;
            }
            if (pair === close) {
                depth--;
                i++;
                if (depth === 0) {
                    index = i + 1;
                    return true;
                }
            }
        }

        return false;
    };

    let consumed = true;
    while (consumed) {
        consumed = false;
        skipWhitespace();

        if (consumeBalanced('{{', '}}')) {
            consumed = true;
            continue;
        }

        const fileMatch = text.slice(index).match(/^\[\[(?:File|Image):[^\]]+\]\]\s*/i);
        if (fileMatch) {
            index += fileMatch[0].length;
            consumed = true;
            continue;
        }

        if (text.slice(index, index + 2) === '{|') {
            const tableEnd = text.indexOf('\n|}', index);
            if (tableEnd !== -1) {
                index = tableEnd + 3;
                consumed = true;
            }
        }
    }

    return text.slice(index).trim();
}

function splitSections(wikitext: string, rawSections: RawSection[] | undefined, maxSections: number, keepWikitext: boolean): StructuredRecord['content']['sections'] {
    const headingRegex = /^(={2,6})\s*(.+?)\s*\1\s*$/gm;
    const headings: Array<{ heading: string; level: number; index: number; anchor?: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = headingRegex.exec(wikitext)) !== null) {
        headings.push({
            heading: stripWikiMarkup(match[2] ?? ''),
            level: match[1]?.length ?? 2,
            index: match.index,
        });
    }

    const pathStack: Array<{ level: number; heading: string }> = [];

    return headings.slice(0, maxSections).map((heading, idx) => {
        const start = heading.index;
        const end = headings[idx + 1]?.index ?? wikitext.length;
        const sectionText = wikitext.slice(start, end);
        const rawSection = rawSections?.find(section => normalizeName(section.line ?? '') === heading.heading);
        while (pathStack.length > 0 && pathStack[pathStack.length - 1]!.level >= heading.level) {
            pathStack.pop();
        }
        pathStack.push({ level: heading.level, heading: heading.heading });
        const templates = parseTemplates(sectionText).map(structureTemplate);

        return {
            heading: heading.heading,
            level: heading.level,
            kind: normalizeKind(heading.heading),
            path: pathStack.map(part => part.heading),
            anchor: rawSection?.anchor,
            plainText: stripWikiMarkup(sectionText),
            wikitext: keepWikitext ? sectionText.trim() : undefined,
            links: extractWikiLinks(sectionText),
            templates,
        };
    });
}

function extractLead(wikitext: string): string {
    const withoutTopMatter = stripLeadingTopMatter(wikitext).split(/^==/m)[0] ?? '';

    const plain = stripWikiMarkup(withoutTopMatter);
    return plain.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).slice(0, 2).join('\n\n');
}

function extractLeadLinks(wikitext: string): ExtractedLink[] {
    const withoutTopMatter = stripLeadingTopMatter(wikitext).split(/^==/m)[0] ?? '';
    return extractWikiLinks(removeTemplates(withoutTopMatter));
}

function normalizeInfoboxFields(params: Record<string, string>): Record<string, string[]> {
    const fields: Record<string, string[]> = {};

    for (const [key, value] of Object.entries(params)) {
        const base = baseFieldName(key);
        const clean = stripWikiMarkup(value);
        if (!base || !clean) {
            continue;
        }
        fields[base] ??= [];
        fields[base].push(clean);
    }

    for (const [key, values] of Object.entries(fields)) {
        fields[key] = uniqueStrings(values);
    }

    return fields;
}

function extractAliases(fields: Record<string, string[]>, title: string): string[] {
    const aliases = [
        ...(fields.aka ?? []).flatMap(value => value.split(/,\s*/)),
        ...(fields.nickname ?? []).flatMap(value => value.split(/,\s*/)),
        ...(fields.name ?? []),
    ];

    return uniqueStrings(aliases.filter(alias => normalizeTitle(alias) !== normalizeTitle(title)));
}

function parseBoolean(values: string[] | undefined): boolean | undefined {
    const first = values?.[0]?.toLowerCase();
    if (!first) {
        return undefined;
    }
    if (/^(yes|true|y)$/i.test(first)) {
        return true;
    }
    if (/^(no|false|n)$/i.test(first)) {
        return false;
    }
    return undefined;
}

function inferTypes(categories: string[], templateNames: string[]): string[] {
    const categoryKeys = categories.map(normalizeKey);
    const templateKeys = templateNames.map(normalizeKey);
    const types = new Set<string>();

    const hasCategory = (pattern: RegExp) => categoryKeys.some(value => pattern.test(value));
    const hasTemplate = (pattern: RegExp) => templateKeys.some(value => pattern.test(value));

    if (hasTemplate(/^infobox quest$|^quest details$/) || hasCategory(/^(quests|free-to-play quests|members' quests|novice quests|intermediate quests|experienced quests|master quests|grandmaster quests)$/)) types.add('quest');
    if (hasTemplate(/^infobox item$/) || hasCategory(/\bitems?\b/)) types.add('item');
    if (hasTemplate(/^infobox npc$/) || hasCategory(/non-player characters|\bnpcs?\b/)) types.add('npc');
    if (hasTemplate(/^infobox monster$/) || hasCategory(/\bmonsters?\b/)) types.add('monster');
    if (hasTemplate(/^infobox location$/) || hasCategory(/^(locations|cities|towns|dungeons)$/)) types.add('location');
    if (hasTemplate(/^infobox shop$/) || hasCategory(/^(shops|stores)$/)) types.add('shop');
    if (hasTemplate(/^infobox skill$/) || hasCategory(/^skills?$|skill training/)) types.add('skill');
    if (hasTemplate(/^infobox spell$/) || hasCategory(/\bspells?\b|magic spells/)) types.add('spell');
    if (hasTemplate(/^infobox prayer$/) || hasCategory(/\bprayers?\b/)) types.add('prayer');
    if (hasTemplate(/^infobox combat achievement$/) || hasCategory(/combat achievements|achievements tasks/)) types.add('combat_achievement');
    if (hasCategory(/achievement diar/)) types.add('achievement_diary');
    if (hasCategory(/\bminigames?\b/)) types.add('minigame');
    if (hasTemplate(/^infobox scenery$/) || hasCategory(/\bscenery\b/)) types.add('scenery');
    if (hasCategory(/\bguides?\b|quick guide|training/)) types.add('guide');
    if (hasCategory(/^(events|holiday events|birthday events|christmas events|easter events|halloween events|thanksgiving events|midsummer events)$/)) types.add('event');
    if (hasCategory(/\bmusic\b|soundtrack/)) types.add('music');

    return [...types];
}

function choosePrimaryType(types: string[]): string {
    const priority = [
        'item',
        'monster',
        'npc',
        'quest',
        'location',
        'shop',
        'skill',
        'spell',
        'prayer',
        'combat_achievement',
        'achievement_diary',
        'minigame',
        'scenery',
        'event',
        'guide',
        'music',
    ];

    return priority.find(type => types.includes(type)) ?? 'article';
}

function parseDateCandidate(rawValue: string, source: string): DateCandidate | null {
    const raw = stripWikiMarkup(rawValue).replace(/\s+/g, ' ').trim();
    if (!raw || /^unknown$/i.test(raw)) {
        return null;
    }

    const months: Record<string, string> = {
        january: '01',
        february: '02',
        march: '03',
        april: '04',
        may: '05',
        june: '06',
        july: '07',
        august: '08',
        september: '09',
        october: '10',
        november: '11',
        december: '12',
    };

    const dayMatch = raw.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
    if (dayMatch) {
        const day = dayMatch[1]!.padStart(2, '0');
        const month = months[dayMatch[2]!.toLowerCase()]!;
        return { value: `${dayMatch[3]}-${month}-${day}`, precision: 'day', raw, source };
    }

    const monthMatch = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
    if (monthMatch) {
        const month = months[monthMatch[1]!.toLowerCase()]!;
        return { value: `${monthMatch[2]}-${month}`, precision: 'month', raw, source };
    }

    const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
        return { value: yearMatch[0], precision: 'year', raw, source };
    }

    return { value: raw, precision: 'raw', raw, source };
}

function extractLifecycle(fields: Record<string, string[]>, categories: string[]): StructuredRecord['lifecycle'] {
    const addedCandidates: DateCandidate[] = [];
    const removedCandidates: DateCandidate[] = [];

    for (const [field, values] of Object.entries(fields)) {
        if (/^(release|released|date added|added|start date)$/.test(field)) {
            for (const value of values) {
                const candidate = parseDateCandidate(value, `infobox:${field}`);
                if (candidate) addedCandidates.push(candidate);
            }
        }
        if (/^(removal|removed|date removed|end date|discontinued)$/.test(field)) {
            for (const value of values) {
                const candidate = parseDateCandidate(value, `infobox:${field}`);
                if (candidate) removedCandidates.push(candidate);
            }
        }
    }

    const contentYears = uniqueStrings(categories)
        .map(category => category.match(/Content (?:released|removed) in ((?:19|20)\d{2})/i)?.[1])
        .filter((year): year is string => Boolean(year))
        .map(Number)
        .sort((a, b) => a - b);

    for (const category of categories) {
        const released = category.match(/Content released in ((?:19|20)\d{2})/i);
        if (released?.[1] && addedCandidates.length === 0) {
            addedCandidates.push({ value: released[1], precision: 'year', raw: category, source: 'category' });
        }

        const removed = category.match(/Content removed in ((?:19|20)\d{2})/i);
        if (removed?.[1] && removedCandidates.length === 0) {
            removedCandidates.push({ value: removed[1], precision: 'year', raw: category, source: 'category' });
        }
    }

    const byValue = (a: DateCandidate, b: DateCandidate) => a.value.localeCompare(b.value);
    addedCandidates.sort(byValue);
    removedCandidates.sort(byValue);

    return {
        added: addedCandidates[0] ?? null,
        removed: removedCandidates[0] ?? null,
        addedCandidates,
        removedCandidates,
        contentYears: [...new Set(contentYears)],
    };
}

function extractIds(fields: Record<string, string[]>): StructuredRecord['facts']['ids'] {
    const ids: StructuredRecord['facts']['ids'] = [];

    for (const [field, values] of Object.entries(fields)) {
        if (!/(^id$| id$|npc id|item id|object id|loc id|monster id)/i.test(field)) {
            continue;
        }

        for (const value of values) {
            for (const match of value.matchAll(/\b\d+\b/g)) {
                ids.push({ field, value: Number(match[0]), raw: value });
            }
        }
    }

    return ids;
}

function extractActions(fields: Record<string, string[]>): string[] {
    const actionValues = [
        ...(fields.options ?? []),
        ...(fields.option ?? []),
        ...(fields.actions ?? []),
    ];

    return uniqueStrings(actionValues.flatMap(value => value.split(/\s*,\s*/)).map(value => value.trim()).filter(Boolean));
}

function splitActions(value: string | undefined): string[] {
    if (!value) {
        return [];
    }
    return uniqueStrings(stripWikiMarkup(value).split(/\s*,\s*/).map(action => action.trim()).filter(Boolean));
}

function numberFromField(fields: Record<string, string[]>, field: string): number | undefined {
    const raw = fields[field]?.[0];
    if (raw === undefined || raw === '') {
        return undefined;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMapFromValue(field: string, value: string): Array<{ field: string; x?: number; y?: number; plane?: number; radius?: number; type?: string; name?: string }> {
    const maps: Array<{ field: string; x?: number; y?: number; plane?: number; radius?: number; type?: string; name?: string }> = [];

    for (const match of value.matchAll(/\{\{Map\|([^{}]+)\}\}/gi)) {
        const template = parseTemplate(`Map|${match[1]}`);
        if (!template) {
            continue;
        }

        maps.push({
            field,
            x: template.params.x ? Number(template.params.x) : undefined,
            y: template.params.y ? Number(template.params.y) : undefined,
            plane: template.params.plane ? Number(template.params.plane) : undefined,
            radius: template.params.r ? Number(template.params.r) : undefined,
            type: template.params.mtype,
            name: stripWikiMarkup(template.params.name ?? ''),
        });
    }

    return maps;
}

function extractVariants(infoboxes: ParsedTemplate[]): StructuredRecord['facts']['variants'] {
    const variants: StructuredRecord['facts']['variants'] = [];

    for (const infobox of infoboxes) {
        const versionIndexes = new Set<number>();
        for (const key of Object.keys(infobox.params)) {
            const match = key.match(/^(.+?)(\d+)$/);
            if (match) {
                versionIndexes.add(Number(match[2]));
            }
        }

        for (const index of [...versionIndexes].sort((a, b) => a - b)) {
            const fields: Record<string, string> = {};
            for (const [key, value] of Object.entries(infobox.params)) {
                const match = key.match(/^(.+?)(\d+)$/);
                if (match && Number(match[2]) === index) {
                    fields[baseFieldName(match[1]!)] = stripWikiMarkup(value);
                }
            }

            if (Object.keys(fields).length === 0) {
                continue;
            }

            variants.push({
                index,
                label: fields.version,
                name: fields.name,
                release: fields.release,
                update: fields.update,
                id: fields.id && Number.isFinite(Number(fields.id)) ? Number(fields.id) : undefined,
                actions: splitActions(fields.options),
                quest: fields.quest,
                location: fields.location,
                examine: fields.examine,
                maps: parseMapFromValue('map', infobox.params[`map${index}`] ?? ''),
                fields,
            });
        }
    }

    return variants;
}

function extractEquipment(fields: Record<string, string[]>): StructuredRecord['facts']['equipment'] {
    const bonusFields = [
        'astab',
        'aslash',
        'acrush',
        'amagic',
        'arange',
        'dstab',
        'dslash',
        'dcrush',
        'dmagic',
        'drange',
        'str',
        'rstr',
        'mdmg',
        'prayer',
    ];
    const bonuses: Record<string, number> = {};

    for (const field of bonusFields) {
        const value = numberFromField(fields, field);
        if (value !== undefined) {
            bonuses[field] = value;
        }
    }

    const hasEquipmentFact = Object.keys(bonuses).length > 0 || fields.slot || fields.speed || fields.attackrange || fields.combatstyle;
    if (!hasEquipmentFact) {
        return null;
    }

    return {
        slot: fields.slot?.[0],
        attackSpeed: numberFromField(fields, 'speed'),
        attackRange: numberFromField(fields, 'attackrange'),
        combatStyle: fields.combatstyle?.[0],
        bonuses,
    };
}

function templateNumber(template: ParsedTemplate, key: string): number | undefined {
    const raw = template.params[key];
    if (raw === undefined || raw === '') {
        return undefined;
    }

    const parsed = Number(stripWikiMarkup(raw));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function templateBoolean(template: ParsedTemplate, key: string): boolean | undefined {
    return parseBoolean(template.params[key] ? [stripWikiMarkup(template.params[key])] : undefined);
}

function extractRecipes(templates: ParsedTemplate[]): StructuredRecord['facts']['recipes'] {
    const recipes: StructuredRecord['facts']['recipes'] = [];

    for (const template of templates) {
        if (template.normalizedName !== 'recipe') {
            continue;
        }

        const skills: Array<{ name: string; level?: number; xp?: number; boostable?: boolean }> = [];
        const materials: Array<{ item: string; quantity?: number; cost?: string }> = [];
        const outputs: Array<{ item: string; quantity?: number; cost?: string }> = [];

        for (let i = 1; i <= 10; i++) {
            const skillName = stripWikiMarkup(template.params[`skill${i}`] ?? '');
            if (skillName) {
                skills.push({
                    name: skillName,
                    level: templateNumber(template, `skill${i}lvl`),
                    xp: templateNumber(template, `skill${i}exp`),
                    boostable: templateBoolean(template, `skill${i}boostable`),
                });
            }

            const material = stripWikiMarkup(template.params[`mat${i}`] ?? '');
            if (material) {
                materials.push({
                    item: material,
                    quantity: templateNumber(template, `mat${i}num`) ?? templateNumber(template, `mat${i}qty`),
                    cost: template.params[`mat${i}cost`] ? stripWikiMarkup(template.params[`mat${i}cost`]) : undefined,
                });
            }

            const output = stripWikiMarkup(template.params[`output${i}`] ?? '');
            if (output) {
                outputs.push({
                    item: output,
                    quantity: templateNumber(template, `output${i}num`) ?? templateNumber(template, `output${i}qty`),
                    cost: template.params[`output${i}cost`] ? stripWikiMarkup(template.params[`output${i}cost`]) : undefined,
                });
            }
        }

        recipes.push({
            skills,
            tools: uniqueStrings((template.params.tools ?? '').split(/\s*,\s*/).map(stripWikiMarkup)),
            facilities: uniqueStrings((template.params.facilities ?? '').split(/\s*,\s*/).map(stripWikiMarkup)),
            materials,
            outputs,
            ticks: templateNumber(template, 'ticks'),
            members: templateBoolean(template, 'members'),
            rawParams: template.params,
        });
    }

    return recipes;
}

function extractMapTemplates(infoboxes: ParsedTemplate[]): StructuredRecord['facts']['maps'] {
    const maps: StructuredRecord['facts']['maps'] = [];

    for (const infobox of infoboxes) {
        for (const [rawField, value] of Object.entries(infobox.params)) {
            const field = baseFieldName(rawField);
            if (!field.includes('map')) {
                continue;
            }

            maps.push(...parseMapFromValue(field, value));
        }
    }

    return maps;
}

function extractInfoboxLinks(infoboxes: ParsedTemplate[]): StructuredRecord['relations']['infoboxLinks'] {
    const links: StructuredRecord['relations']['infoboxLinks'] = [];

    for (const infobox of infoboxes) {
        for (const [rawField, value] of Object.entries(infobox.params)) {
            const field = baseFieldName(rawField);
            for (const link of extractWikiLinks(value)) {
                links.push({ field, target: link.target, label: link.label });
            }
        }
    }

    const seen = new Set<string>();
    return links.filter(link => {
        const key = `${link.field}|${link.target}|${link.label}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function buildStructuredRecord(raw: RawWikiPage, options: Options, extractedAt: string): StructuredRecord {
    const wikitext = raw.wikitext ?? '';
    const templates = parseTemplates(wikitext);
    const infoboxes = templates.filter(template => template.normalizedName.startsWith('infobox') || template.normalizedName === 'quest details');
    const categoryNames = uniqueStrings((raw.categories ?? []).filter(category => !category.hidden).map(category => category.category));
    const hiddenCategoryNames = uniqueStrings((raw.categories ?? []).filter(category => category.hidden).map(category => category.category));
    const templateNames = uniqueStrings([...(raw.templates ?? []).map(template => template.title.replace(/^Template:/i, '')), ...templates.map(template => template.name)]);
    const fields: Record<string, string[]> = {};

    const structuredInfoboxes = infoboxes.map(template => {
        const normalizedFields = normalizeInfoboxFields(template.params);
        for (const [field, values] of Object.entries(normalizedFields)) {
            fields[field] ??= [];
            fields[field].push(...values);
        }
        return {
            template: template.name,
            params: template.params,
            normalizedFields,
        };
    });

    for (const [field, values] of Object.entries(fields)) {
        fields[field] = uniqueStrings(values);
    }

    const types = inferTypes(categoryNames, templateNames);
    const primaryType = choosePrimaryType(types);
    const lifecycle = extractLifecycle(fields, categoryNames);
    const outgoingLinks = uniqueStrings((raw.links ?? [])
        .filter(link => link.ns === 0 && link.exists !== false)
        .map(link => link.title))
        .slice(0, options.maxLinks);
    const sections = splitSections(wikitext, raw.sections, options.maxSections, options.keepWikitext);
    const plainText = stripWikiMarkup(wikitext);
    const aliases = extractAliases(fields, raw.title);

    return {
        schemaVersion: SCHEMA_VERSION,
        source: raw.source ?? 'oldschool.runescape.wiki',
        extractedAt,
        page: {
            pageid: raw.pageid,
            revid: raw.revid,
            namespace: raw.namespace,
            title: raw.title,
            url: raw.url,
            fetchedAt: raw.fetchedAt,
            sourceCrawl: raw.crawl?.source,
            redirected: raw.crawl?.redirected,
        },
        entity: {
            title: raw.title,
            normalizedTitle: normalizeTitle(raw.title),
            primaryType,
            types: types.length > 0 ? types : ['article'],
            aliases,
            members: parseBoolean(fields.members),
            tradeable: parseBoolean(fields.tradeable),
            equipable: parseBoolean(fields.equipable),
        },
        dateAdded: lifecycle.added?.value ?? null,
        dateRemoved: lifecycle.removed?.value ?? null,
        lifecycle,
        taxonomy: {
            categories: categoryNames,
            hiddenCategories: hiddenCategoryNames,
            templates: templateNames,
            infoboxTemplates: structuredInfoboxes.map(infobox => infobox.template),
            tags: uniqueStrings([...categoryNames, primaryType, ...types]),
        },
        infoboxes: structuredInfoboxes,
        facts: {
            ids: extractIds(fields),
            maps: extractMapTemplates(infoboxes),
            actions: extractActions(fields),
            variants: extractVariants(infoboxes),
            equipment: extractEquipment(fields),
            recipes: extractRecipes(templates),
            fields,
        },
        relations: {
            outgoingLinks,
            outgoingLinkCount: (raw.links ?? []).filter(link => link.ns === 0 && link.exists !== false).length,
            infoboxLinks: extractInfoboxLinks(infoboxes),
        },
        content: {
            lead: extractLead(wikitext),
            leadLinks: extractLeadLinks(wikitext),
            plainText,
            wikitext: options.keepWikitext ? wikitext : undefined,
            lengths: {
                html: raw.htmlLength,
                wikitext: raw.wikitextLength ?? wikitext.length,
                plainText: plainText.length,
            },
            sections,
        },
    };
}

async function structureWiki(options: Options): Promise<RunStats> {
    const inputPath = resolve(options.input);
    const outputPath = resolve(options.output);
    const statsPath = resolve(options.statsOut ?? `${options.output}.stats.json`);
    const extractedAt = new Date().toISOString();
    const stats: RunStats = {
        processed: 0,
        written: 0,
        errors: 0,
        byPrimaryType: {},
        withDateAdded: 0,
        withDateRemoved: 0,
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await mkdir(dirname(statsPath), { recursive: true });

    const output = Bun.file(outputPath).writer();
    const lines = createInterface({
        input: createReadStream(inputPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of lines) {
        if (options.limit !== undefined && stats.processed >= options.limit) {
            break;
        }

        stats.processed++;
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        try {
            const raw = JSON.parse(trimmed) as RawWikiPage;
            const structured = buildStructuredRecord(raw, options, extractedAt);
            output.write(`${JSON.stringify(structured)}\n`);
            stats.written++;
            stats.byPrimaryType[structured.entity.primaryType] = (stats.byPrimaryType[structured.entity.primaryType] ?? 0) + 1;
            if (structured.dateAdded) stats.withDateAdded++;
            if (structured.dateRemoved) stats.withDateRemoved++;

            if (stats.written % 1_000 === 0) {
                console.log(`Structured ${stats.written} pages; latest: ${structured.page.title}`);
            }
        } catch (error) {
            stats.errors++;
            console.warn(`Failed to structure input line ${stats.processed}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    await output.end();
    await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
    return stats;
}

try {
    const options = parseArgs(runtimeProcess.argv.slice(2));
    console.log(`Input: ${resolve(options.input)}`);
    console.log(`Output: ${resolve(options.output)}`);
    console.log(`Schema: ${SCHEMA_VERSION}`);
    console.log(`Raw wikitext in output: ${options.keepWikitext ? 'yes' : 'no'}`);

    const stats = await structureWiki(options);
    console.log(`Done. Processed: ${stats.processed}, written: ${stats.written}, errors: ${stats.errors}`);
    console.log(`With dateAdded: ${stats.withDateAdded}, with dateRemoved: ${stats.withDateRemoved}`);
    console.log(`Primary types: ${JSON.stringify(stats.byPrimaryType)}`);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    runtimeProcess.exit(1);
}
