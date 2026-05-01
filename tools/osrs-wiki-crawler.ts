#!/usr/bin/env bun
/**
 * Crawl rendered HTML from the Old School RuneScape Wiki through the
 * MediaWiki Action API and write one page per JSONL record.
 *
 * Smoke test:
 *   bun tools/osrs-wiki-crawler.ts --limit 25
 *
 * Full main-namespace crawl:
 *   bun tools/osrs-wiki-crawler.ts --all --contact "you@example.edu"
 *
 * Focused crawls:
 *   bun tools/osrs-wiki-crawler.ts --titles "Cooking,Fishing,Cook's Assistant"
 *   bun tools/osrs-wiki-crawler.ts --titles-file data/wiki/task-pages.txt
 *   bun tools/osrs-wiki-crawler.ts --category "Cooking"
 *   bun tools/osrs-wiki-crawler.ts --prefix "Cook"
 */

// Bun provides Node-compatible built-ins at runtime; these ignores keep the
// editor quiet when the repo is opened before `bun install` has restored types.
// @ts-ignore
import { createReadStream, existsSync } from 'fs';
// @ts-ignore
import { appendFile, mkdir, readFile, stat } from 'fs/promises';
// @ts-ignore
import { dirname, resolve } from 'path';
// @ts-ignore
import { createInterface } from 'readline';

const DEFAULT_API_URL = 'https://oldschool.runescape.wiki/api.php';
const DEFAULT_OUTPUT = 'data/wiki/osrs-wiki-pages.jsonl';
const DEFAULT_REDIRECTS_OUTPUT = 'data/wiki/osrs-wiki-redirects.jsonl';
const DEFAULT_DELAY_MS = 1_000;
const DEFAULT_MAX_LAG = 5;
const MAX_RETRIES = 6;
const REDIRECT_BATCH_SIZE = 50;
const runtimeProcess = (globalThis as any).process as {
    argv: string[];
    env: Record<string, string | undefined>;
    exit(code?: number): never;
};

interface CrawlerOptions {
    apiUrl: string;
    output: string;
    delayMs: number;
    maxLag: number;
    namespace: number;
    limit?: number;
    prefix?: string;
    category?: string;
    titles: string[];
    titlesFile?: string;
    userAgent: string;
    resume: boolean;
    dryRun: boolean;
    includeTemplates: boolean;
    includeWikitext: boolean;
    includeRedirectPages: boolean;
    redirectsOutput?: string;
    redirectLimit?: number;
    redirectsOnly: boolean;
}

interface PageRef {
    pageid?: number;
    title: string;
    ns?: number;
    fullurl?: string;
    lastrevid?: number;
    source: string;
}

interface CrawlStats {
    discovered: number;
    fetched: number;
    skipped: number;
    errors: number;
    existingRecords: number;
    totalRecords: number;
    totalPages: number;
    outputBytes: number;
    htmlBytes: number;
    wikitextBytes: number;
    redirectAliasesFetched: number;
    redirectAliasesSkipped: number;
    redirectAliasesErrors: number;
    totalRedirectAliases: number;
    redirectsOutputBytes: number;
}

type JsonObject = Record<string, any>;

interface DatasetSummary {
    records: number;
    skipKeys: Set<string>;
    canonicalPageKeys: Set<string>;
    htmlBytes: number;
    wikitextBytes: number;
}

interface RedirectAliasSummary {
    records: number;
    aliasKeys: Set<string>;
}

interface RedirectRef {
    pageid?: number;
    title: string;
    ns?: number;
}

function printUsage(): void {
    console.log(`
Usage:
  bun tools/osrs-wiki-crawler.ts [options]

Options:
  --all                    Crawl every discovered page. Without --all or --limit, defaults to --limit 25.
  --limit <n>              Stop after writing n new page records.
  --out <path>             JSONL output path. Default: ${DEFAULT_OUTPUT}
  --api-url <url>          MediaWiki API endpoint. Default: ${DEFAULT_API_URL}
  --delay-ms <n>           Delay between API requests. Default: ${DEFAULT_DELAY_MS}
  --maxlag <n>             MediaWiki maxlag value. Default: ${DEFAULT_MAX_LAG}
  --namespace <n>          Namespace to crawl. Default: 0 (article pages)
  --prefix <text>          Crawl article titles starting with this prefix.
  --category <name>        Crawl pages in a category; "Category:" prefix is optional.
  --titles <a,b,c>         Comma-separated page titles to fetch.
  --titles-file <path>     Newline-separated page titles; blank lines and # comments are ignored.
  --user-agent <value>     Custom User-Agent. Prefer setting contact info.
  --contact <value>        Contact string included in the default User-Agent.
  --no-resume              Do not skip records already present in the output JSONL.
  --no-templates           Do not include MediaWiki template references in records.
  --include-wikitext       Also store raw MediaWiki wikitext and wikitextLength.
  --include-redirect-pages Include redirect pages when enumerating --all/--prefix.
  --redirects-out <path>   Write redirect aliases to JSONL. Default with --redirects-only: ${DEFAULT_REDIRECTS_OUTPUT}
  --redirects-only         Only crawl redirect aliases, not page content.
  --redirect-limit <n>     Stop after writing n new redirect alias records.
  --dry-run                List what would be fetched without writing records.
  -h, --help               Show this help.

Examples:
  bun tools/osrs-wiki-crawler.ts --limit 10
  bun tools/osrs-wiki-crawler.ts --all --contact "name@example.edu" --delay-ms 1000
  bun tools/osrs-wiki-crawler.ts --titles "Cooking,Fishing,Cook's Assistant"
`);
}

function requireValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}

function parsePositiveInteger(value: string, flag: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`${flag} must be a non-negative integer`);
    }
    return parsed;
}

function buildDefaultUserAgent(contact?: string): string {
    const contactText = contact?.trim() || runtimeProcess.env.OSRS_WIKI_CONTACT?.trim();
    if (contactText) {
        return `rs-sdk-temporal-planning/0.1 (${contactText}; research crawler; Bun)`;
    }

    return 'rs-sdk-temporal-planning/0.1 (research crawler; set OSRS_WIKI_CONTACT; Bun)';
}

function splitTitles(value: string): string[] {
    return value
        .split(',')
        .map(title => title.trim())
        .filter(Boolean);
}

function parseArgs(argv: string[]): CrawlerOptions {
    const options: CrawlerOptions = {
        apiUrl: DEFAULT_API_URL,
        output: DEFAULT_OUTPUT,
        delayMs: DEFAULT_DELAY_MS,
        maxLag: DEFAULT_MAX_LAG,
        namespace: 0,
        titles: [],
        userAgent: runtimeProcess.env.OSRS_WIKI_USER_AGENT?.trim() || buildDefaultUserAgent(),
        resume: true,
        dryRun: false,
        includeTemplates: true,
        includeWikitext: false,
        includeRedirectPages: false,
        redirectsOnly: false,
    };

    let sawAll = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        switch (arg) {
            case '-h':
            case '--help':
                printUsage();
                runtimeProcess.exit(0);
                break;
            case '--all':
                sawAll = true;
                break;
            case '--api-url':
                options.apiUrl = requireValue(argv, i, arg);
                i++;
                break;
            case '--out':
            case '--output':
                options.output = requireValue(argv, i, arg);
                i++;
                break;
            case '--delay-ms':
                options.delayMs = parsePositiveInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--maxlag':
                options.maxLag = parsePositiveInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--namespace':
                options.namespace = parsePositiveInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--limit':
                options.limit = parsePositiveInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--prefix':
                options.prefix = requireValue(argv, i, arg).trim();
                i++;
                break;
            case '--category':
                options.category = requireValue(argv, i, arg).trim();
                i++;
                break;
            case '--titles':
                options.titles.push(...splitTitles(requireValue(argv, i, arg)));
                i++;
                break;
            case '--titles-file':
                options.titlesFile = requireValue(argv, i, arg);
                i++;
                break;
            case '--user-agent':
                options.userAgent = requireValue(argv, i, arg);
                i++;
                break;
            case '--contact':
                options.userAgent = buildDefaultUserAgent(requireValue(argv, i, arg));
                i++;
                break;
            case '--no-resume':
                options.resume = false;
                break;
            case '--no-templates':
                options.includeTemplates = false;
                break;
            case '--include-wikitext':
                options.includeWikitext = true;
                break;
            case '--include-redirect-pages':
                options.includeRedirectPages = true;
                break;
            case '--redirects-out':
                options.redirectsOutput = requireValue(argv, i, arg);
                i++;
                break;
            case '--redirects-only':
                options.redirectsOnly = true;
                break;
            case '--redirect-limit':
                options.redirectLimit = parsePositiveInteger(requireValue(argv, i, arg), arg);
                i++;
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            default:
                throw new Error(`Unknown option: ${arg}`);
        }
    }

    if (options.redirectsOnly && !options.redirectsOutput) {
        options.redirectsOutput = DEFAULT_REDIRECTS_OUTPUT;
    }

    if (options.redirectsOnly && options.limit !== undefined) {
        throw new Error('Use --redirect-limit instead of --limit with --redirects-only.');
    }

    if (!sawAll && options.limit === undefined && !options.redirectsOnly) {
        options.limit = 25;
        console.log('No --all or --limit supplied; using --limit 25 for a safe smoke test.');
    }

    if (sawAll && options.limit !== undefined) {
        throw new Error('Use either --all or --limit, not both.');
    }

    return options;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function normalizeTitle(title: string): string {
    return title.replace(/_/g, ' ').trim().toLowerCase();
}

function pageKey(ref: { pageid?: number; title?: string }): string | undefined {
    if (ref.pageid !== undefined) {
        return `pageid:${ref.pageid}`;
    }
    if (ref.title) {
        return `title:${normalizeTitle(ref.title)}`;
    }
    return undefined;
}

function pageKeys(ref: { pageid?: number; title?: string }): string[] {
    const keys: string[] = [];
    if (ref.pageid !== undefined) {
        keys.push(`pageid:${ref.pageid}`);
    }
    if (ref.title) {
        keys.push(`title:${normalizeTitle(ref.title)}`);
    }
    return keys;
}

function aliasKey(alias: string): string {
    return `alias:${normalizeTitle(alias)}`;
}

function wikiPageUrl(title: string): string {
    return `https://oldschool.runescape.wiki/w/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

function wikiPageUrlWithFragment(title: string, fragment?: string): string {
    const baseUrl = wikiPageUrl(title);
    if (!fragment) {
        return baseUrl;
    }

    return `${baseUrl}#${encodeURIComponent(fragment.replace(/ /g, '_'))}`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function retryDelayMs(attempt: number): number {
    return Math.min(60_000, 1_000 * 2 ** attempt);
}

function retryAfterMs(response: Response): number | undefined {
    const retryAfter = response.headers.get('retry-after');
    if (!retryAfter) {
        return undefined;
    }

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1_000);
    }

    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
        return Math.max(0, date - Date.now());
    }

    return undefined;
}

class MediaWikiClient {
    private lastRequestAt = 0;

    constructor(private readonly options: CrawlerOptions) {}

    async get(params: Record<string, string | number | boolean | undefined>): Promise<JsonObject> {
        const requestParams = new URLSearchParams();
        requestParams.set('format', 'json');
        requestParams.set('formatversion', '2');
        requestParams.set('maxlag', String(this.options.maxLag));

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                requestParams.set(key, String(value));
            }
        }

        const url = new URL(this.options.apiUrl);
        url.search = requestParams.toString();

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            await this.throttle();

            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': this.options.userAgent,
                },
            });

            const body = await response.text();

            if (response.status === 429 || response.status === 503) {
                const waitMs = retryAfterMs(response) ?? retryDelayMs(attempt);
                console.warn(`API asked us to slow down (${response.status}); retrying in ${Math.ceil(waitMs / 1_000)}s.`);
                await sleep(waitMs);
                continue;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
            }

            const json = JSON.parse(body) as JsonObject;
            const error = json.error as JsonObject | undefined;
            if (error?.code === 'maxlag') {
                const waitMs = retryDelayMs(attempt);
                console.warn(`MediaWiki maxlag response; retrying in ${Math.ceil(waitMs / 1_000)}s.`);
                await sleep(waitMs);
                continue;
            }

            if (error) {
                throw new Error(`MediaWiki API error ${error.code ?? 'unknown'}: ${error.info ?? JSON.stringify(error)}`);
            }

            return json;
        }

        throw new Error(`MediaWiki API request failed after ${MAX_RETRIES + 1} attempts: ${url.toString()}`);
    }

    private async throttle(): Promise<void> {
        if (this.lastRequestAt === 0) {
            this.lastRequestAt = Date.now();
            return;
        }

        const elapsed = Date.now() - this.lastRequestAt;
        const waitMs = this.options.delayMs - elapsed;
        if (waitMs > 0) {
            await sleep(waitMs);
        }

        this.lastRequestAt = Date.now();
    }
}

async function readTitleFile(path: string): Promise<string[]> {
    const text = await readFile(path, 'utf8');
    return text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
}

function emptyDatasetSummary(): DatasetSummary {
    return {
        records: 0,
        skipKeys: new Set<string>(),
        canonicalPageKeys: new Set<string>(),
        htmlBytes: 0,
        wikitextBytes: 0,
    };
}

function emptyRedirectAliasSummary(): RedirectAliasSummary {
    return {
        records: 0,
        aliasKeys: new Set<string>(),
    };
}

async function loadDatasetSummary(outputPath: string): Promise<DatasetSummary> {
    const summary = emptyDatasetSummary();
    if (!existsSync(outputPath)) {
        return summary;
    }

    let lineNumber = 0;
    const lines = createInterface({
        input: createReadStream(outputPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of lines) {
        lineNumber++;
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        try {
            const record = JSON.parse(trimmed) as { pageid?: number; title?: string; html?: string; htmlLength?: number; wikitext?: string; wikitextLength?: number };
            summary.records++;

            for (const key of pageKeys(record)) {
                summary.skipKeys.add(key);
            }

            const key = pageKey(record);
            if (key) {
                summary.canonicalPageKeys.add(key);
            }

            summary.htmlBytes += typeof record.htmlLength === 'number' ? record.htmlLength : record.html?.length ?? 0;
            summary.wikitextBytes += typeof record.wikitextLength === 'number' ? record.wikitextLength : record.wikitext?.length ?? 0;
        } catch {
            console.warn(`Ignoring invalid JSONL line ${lineNumber} in ${outputPath}`);
        }
    }

    return summary;
}

async function loadRedirectAliasSummary(outputPath: string): Promise<RedirectAliasSummary> {
    const summary = emptyRedirectAliasSummary();
    if (!existsSync(outputPath)) {
        return summary;
    }

    let lineNumber = 0;
    const lines = createInterface({
        input: createReadStream(outputPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of lines) {
        lineNumber++;
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }

        try {
            const record = JSON.parse(trimmed) as { alias?: string };
            if (record.alias) {
                summary.aliasKeys.add(aliasKey(record.alias));
                summary.records++;
            }
        } catch {
            console.warn(`Ignoring invalid redirect JSONL line ${lineNumber} in ${outputPath}`);
        }
    }

    return summary;
}

async function* pagesFromTitles(titles: string[]): AsyncGenerator<PageRef> {
    for (const title of titles) {
        yield { title, source: 'titles' };
    }
}

async function* pagesFromCategory(client: MediaWikiClient, options: CrawlerOptions): AsyncGenerator<PageRef> {
    if (!options.category) {
        return;
    }

    const cmtitle = options.category.startsWith('Category:') ? options.category : `Category:${options.category}`;
    let cmcontinue: string | undefined;

    do {
        const json = await client.get({
            action: 'query',
            list: 'categorymembers',
            cmtitle,
            cmnamespace: options.namespace,
            cmlimit: 'max',
            cmcontinue,
        });

        const members = (json.query?.categorymembers ?? []) as JsonObject[];
        for (const member of members) {
            if (typeof member.title === 'string') {
                yield {
                    pageid: typeof member.pageid === 'number' ? member.pageid : undefined,
                    ns: typeof member.ns === 'number' ? member.ns : undefined,
                    title: member.title,
                    source: cmtitle,
                };
            }
        }

        cmcontinue = typeof json.continue?.cmcontinue === 'string' ? json.continue.cmcontinue : undefined;
    } while (cmcontinue);
}

async function* pagesFromAllPages(client: MediaWikiClient, options: CrawlerOptions): AsyncGenerator<PageRef> {
    let gapcontinue: string | undefined;

    do {
        const json = await client.get({
            action: 'query',
            generator: 'allpages',
            gapnamespace: options.namespace,
            gaplimit: 'max',
            gapprefix: options.prefix,
            gapfilterredir: options.includeRedirectPages ? 'all' : 'nonredirects',
            gapcontinue,
            prop: 'info',
            inprop: 'url',
        });

        const pages = ((json.query?.pages ?? []) as JsonObject[]).sort((a, b) => String(a.title).localeCompare(String(b.title)));
        for (const page of pages) {
            if (typeof page.title === 'string') {
                yield {
                    pageid: typeof page.pageid === 'number' ? page.pageid : undefined,
                    ns: typeof page.ns === 'number' ? page.ns : undefined,
                    title: page.title,
                    fullurl: typeof page.fullurl === 'string' ? page.fullurl : undefined,
                    lastrevid: typeof page.lastrevid === 'number' ? page.lastrevid : undefined,
                    source: options.prefix ? `allpages:${options.prefix}` : 'allpages',
                };
            }
        }

        gapcontinue = typeof json.continue?.gapcontinue === 'string' ? json.continue.gapcontinue : undefined;
    } while (gapcontinue);
}

async function* redirectRefsFromAllPages(client: MediaWikiClient, options: CrawlerOptions): AsyncGenerator<RedirectRef> {
    let apcontinue: string | undefined;

    do {
        const json = await client.get({
            action: 'query',
            list: 'allpages',
            apnamespace: options.namespace,
            aplimit: 'max',
            apprefix: options.prefix,
            apfilterredir: 'redirects',
            apcontinue,
        });

        const pages = ((json.query?.allpages ?? []) as JsonObject[]).sort((a, b) => String(a.title).localeCompare(String(b.title)));
        for (const page of pages) {
            if (typeof page.title === 'string') {
                yield {
                    pageid: typeof page.pageid === 'number' ? page.pageid : undefined,
                    ns: typeof page.ns === 'number' ? page.ns : undefined,
                    title: page.title,
                };
            }
        }

        apcontinue = typeof json.continue?.apcontinue === 'string' ? json.continue.apcontinue : undefined;
    } while (apcontinue);
}

async function* discoverPages(client: MediaWikiClient, options: CrawlerOptions): AsyncGenerator<PageRef> {
    if (options.titlesFile) {
        options.titles.push(...await readTitleFile(options.titlesFile));
    }

    const seenTitles = new Set<string>();
    const uniqueTitles = options.titles.filter(title => {
        const normalized = normalizeTitle(title);
        if (seenTitles.has(normalized)) {
            return false;
        }
        seenTitles.add(normalized);
        return true;
    });

    if (uniqueTitles.length > 0) {
        yield* pagesFromTitles(uniqueTitles);
    }

    if (options.category) {
        yield* pagesFromCategory(client, options);
    }

    if (uniqueTitles.length === 0 && !options.category) {
        yield* pagesFromAllPages(client, options);
    }
}

function compactParseArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

async function resolveRedirectBatch(client: MediaWikiClient, refs: RedirectRef[], options: CrawlerOptions): Promise<JsonObject[]> {
    if (refs.length === 0) {
        return [];
    }

    const json = await client.get({
        action: 'query',
        titles: refs.map(ref => ref.title).join('|'),
        redirects: true,
        prop: 'info',
        inprop: 'url',
    });

    const refsByTitle = new Map(refs.map(ref => [normalizeTitle(ref.title), ref]));
    const pagesByTitle = new Map<string, JsonObject>();
    for (const page of (json.query?.pages ?? []) as JsonObject[]) {
        if (typeof page.title === 'string') {
            pagesByTitle.set(normalizeTitle(page.title), page);
        }
    }

    const records: JsonObject[] = [];
    for (const redirect of (json.query?.redirects ?? []) as JsonObject[]) {
        if (typeof redirect.from !== 'string' || typeof redirect.to !== 'string') {
            continue;
        }

        const ref = refsByTitle.get(normalizeTitle(redirect.from));
        const target = pagesByTitle.get(normalizeTitle(redirect.to));
        const targetFragment = typeof redirect.tofragment === 'string' && redirect.tofragment.length > 0 ? redirect.tofragment : undefined;
        const targetBaseUrl = typeof target?.fullurl === 'string' ? target.fullurl : wikiPageUrl(redirect.to);

        records.push({
            source: 'oldschool.runescape.wiki',
            fetchedAt: new Date().toISOString(),
            apiUrl: options.apiUrl,
            namespace: ref?.ns ?? options.namespace,
            alias: redirect.from,
            aliasPageid: ref?.pageid,
            aliasUrl: wikiPageUrl(redirect.from),
            targetTitle: redirect.to,
            targetFragment,
            targetPageid: typeof target?.pageid === 'number' ? target.pageid : undefined,
            targetNamespace: typeof target?.ns === 'number' ? target.ns : options.namespace,
            targetUrl: targetFragment ? wikiPageUrlWithFragment(redirect.to, targetFragment) : targetBaseUrl,
            targetBaseUrl,
        });
    }

    return records;
}

async function fetchPageRecord(client: MediaWikiClient, ref: PageRef, options: CrawlerOptions): Promise<JsonObject> {
    const props = [
        'text',
        'categories',
        'links',
        'sections',
        'displaytitle',
        'revid',
        'properties',
    ];

    if (options.includeTemplates) {
        props.push('templates');
    }
    if (options.includeWikitext) {
        props.push('wikitext');
    }

    const json = await client.get({
        action: 'parse',
        pageid: ref.pageid,
        page: ref.pageid === undefined ? ref.title : undefined,
        redirects: true,
        prop: props.join('|'),
    });

    const parsed = json.parse as JsonObject | undefined;
    if (!parsed) {
        throw new Error(`Parse response did not include page data for ${ref.title}`);
    }

    const title = typeof parsed.title === 'string' ? parsed.title : ref.title;
    const html = typeof parsed.text === 'string' ? parsed.text : '';
    const wikitext = options.includeWikitext && typeof parsed.wikitext === 'string' ? parsed.wikitext : undefined;

    return {
        source: 'oldschool.runescape.wiki',
        fetchedAt: new Date().toISOString(),
        apiUrl: options.apiUrl,
        pageid: typeof parsed.pageid === 'number' ? parsed.pageid : ref.pageid,
        revid: typeof parsed.revid === 'number' ? parsed.revid : ref.lastrevid,
        namespace: ref.ns ?? options.namespace,
        title,
        requestedTitle: ref.title,
        displayTitle: typeof parsed.displaytitle === 'string' ? parsed.displaytitle : undefined,
        url: wikiPageUrl(title),
        requestedUrl: ref.fullurl ?? wikiPageUrl(ref.title),
        crawl: {
            source: ref.source,
            redirected: normalizeTitle(title) !== normalizeTitle(ref.title),
        },
        categories: compactParseArray(parsed.categories),
        links: compactParseArray(parsed.links),
        templates: options.includeTemplates ? compactParseArray(parsed.templates) : undefined,
        sections: compactParseArray(parsed.sections),
        properties: compactParseArray(parsed.properties),
        html,
        htmlLength: html.length,
        wikitext,
        wikitextLength: wikitext?.length,
    };
}

async function crawlRedirectAliases(client: MediaWikiClient, options: CrawlerOptions, stats: CrawlStats): Promise<void> {
    if (!options.redirectsOutput) {
        return;
    }

    const outputPath = resolve(options.redirectsOutput);
    const existing = options.resume ? await loadRedirectAliasSummary(outputPath) : emptyRedirectAliasSummary();
    stats.totalRedirectAliases = existing.records;
    stats.redirectsOutputBytes = existsSync(outputPath) ? (await stat(outputPath)).size : 0;

    if (!options.dryRun) {
        await mkdir(dirname(outputPath), { recursive: true });
    }

    console.log(`Redirect aliases output: ${outputPath}`);
    console.log(`Redirect aliases resume: ${options.resume ? `yes (${existing.records} existing aliases)` : 'no'}`);

    let batch: RedirectRef[] = [];

    const flushBatch = async (): Promise<void> => {
        if (batch.length === 0 || (options.redirectLimit !== undefined && stats.redirectAliasesFetched >= options.redirectLimit)) {
            batch = [];
            return;
        }

        const records = await resolveRedirectBatch(client, batch, options);
        batch = [];

        for (const record of records) {
            if (options.redirectLimit !== undefined && stats.redirectAliasesFetched >= options.redirectLimit) {
                break;
            }

            const key = typeof record.alias === 'string' ? aliasKey(record.alias) : undefined;
            if (key && existing.aliasKeys.has(key)) {
                stats.redirectAliasesSkipped++;
                continue;
            }
            if (key) {
                existing.aliasKeys.add(key);
            }

            if (options.dryRun) {
                console.log(`[dry-run redirect] ${record.aliasUrl} -> ${record.targetUrl}`);
            } else {
                await appendFile(outputPath, `${JSON.stringify(record)}\n`, 'utf8');
            }

            stats.redirectAliasesFetched++;
            stats.totalRedirectAliases++;

            if (stats.redirectAliasesFetched % 100 === 0 || stats.redirectAliasesFetched === 1) {
                console.log(`Redirect aliases: saved ${stats.redirectAliasesFetched}; latest ${record.alias} -> ${record.targetTitle}${record.targetFragment ? `#${record.targetFragment}` : ''}`);
            }
        }
    };

    try {
        for await (const ref of redirectRefsFromAllPages(client, options)) {
            if (options.redirectLimit !== undefined && stats.redirectAliasesFetched >= options.redirectLimit) {
                break;
            }

            batch.push(ref);
            if (batch.length >= REDIRECT_BATCH_SIZE) {
                await flushBatch();
            }
        }

        await flushBatch();
    } catch (error) {
        stats.redirectAliasesErrors++;
        console.warn(`Failed while crawling redirect aliases: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (existsSync(outputPath)) {
        stats.redirectsOutputBytes = (await stat(outputPath)).size;
    }
}

async function crawl(options: CrawlerOptions): Promise<CrawlStats> {
    const outputPath = resolve(options.output);
    const currentRunKeys = new Set<string>();
    const dataset = await loadDatasetSummary(outputPath);
    const stats: CrawlStats = {
        discovered: 0,
        fetched: 0,
        skipped: 0,
        errors: 0,
        existingRecords: dataset.records,
        totalRecords: dataset.records,
        totalPages: dataset.canonicalPageKeys.size,
        outputBytes: existsSync(outputPath) ? (await stat(outputPath)).size : 0,
        htmlBytes: dataset.htmlBytes,
        wikitextBytes: dataset.wikitextBytes,
        redirectAliasesFetched: 0,
        redirectAliasesSkipped: 0,
        redirectAliasesErrors: 0,
        totalRedirectAliases: 0,
        redirectsOutputBytes: 0,
    };
    const existingKeys = options.resume ? dataset.skipKeys : new Set<string>();

    if (!options.dryRun && !options.redirectsOnly) {
        await mkdir(dirname(outputPath), { recursive: true });
    }

    console.log(`API: ${options.apiUrl}`);
    if (!options.redirectsOnly) {
        console.log(`Output: ${outputPath}`);
    }
    console.log(`User-Agent: ${options.userAgent}`);
    if (!options.redirectsOnly) {
        console.log(`Resume: ${options.resume ? `yes (${dataset.records} existing records)` : 'no'}`);
    }
    console.log(`Delay: ${options.delayMs}ms between API requests`);
    console.log(`Mode: namespace ${options.namespace}, redirects ${options.includeRedirectPages ? 'included' : 'excluded from discovery'}, wikitext ${options.includeWikitext ? 'included' : 'not included'}`);

    const client = new MediaWikiClient(options);

    if (!options.redirectsOnly) {
        for await (const ref of discoverPages(client, options)) {
            if (options.limit !== undefined && stats.fetched >= options.limit) {
                break;
            }

            stats.discovered++;

            const refKeys = pageKeys(ref);
            if (refKeys.some(key => currentRunKeys.has(key) || existingKeys.has(key))) {
                stats.skipped++;
                continue;
            }

            for (const key of refKeys) {
                currentRunKeys.add(key);
            }

            const requestUrl = ref.fullurl ?? wikiPageUrl(ref.title);
            if (options.dryRun) {
                console.log(`[dry-run] ${requestUrl} (${ref.title})`);
                stats.fetched++;
            } else {
                try {
                    const progress = options.limit === undefined ? String(stats.fetched + 1) : `${stats.fetched + 1}/${options.limit}`;
                    console.log(`[${progress}] Fetching ${requestUrl} (${ref.title})`);
                    const record = await fetchPageRecord(client, ref, options);
                    await appendFile(outputPath, `${JSON.stringify(record)}\n`, 'utf8');
                    stats.fetched++;
                    stats.totalRecords++;

                    for (const key of pageKeys(record)) {
                        dataset.skipKeys.add(key);
                    }
                    const canonicalKey = pageKey(record);
                    if (canonicalKey) {
                        dataset.canonicalPageKeys.add(canonicalKey);
                    }
                    stats.totalPages = dataset.canonicalPageKeys.size;
                    stats.htmlBytes += typeof record.htmlLength === 'number' ? record.htmlLength : 0;
                    stats.wikitextBytes += typeof record.wikitextLength === 'number' ? record.wikitextLength : 0;

                    if (record.crawl?.redirected) {
                        console.log(`  -> redirected to ${record.url}`);
                    }
                    console.log(`  -> saved ${record.title} (${formatBytes(record.htmlLength ?? 0)} html)`);
                } catch (error) {
                    stats.errors++;
                    console.warn(`Failed to fetch ${ref.title}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }

        }
    }

    if (existsSync(outputPath)) {
        stats.outputBytes = (await stat(outputPath)).size;
    }

    await crawlRedirectAliases(client, options, stats);

    return stats;
}

try {
    const options = parseArgs(runtimeProcess.argv.slice(2));
    const stats = await crawl(options);
    console.log(`Done. Discovered: ${stats.discovered}, fetched: ${stats.fetched}, skipped: ${stats.skipped}, errors: ${stats.errors}`);
    console.log(`Dataset total: ${stats.totalRecords} JSONL records (${stats.totalPages} unique canonical pages), ${formatBytes(stats.outputBytes)} on disk.`);
    console.log(`Content total: ${formatBytes(stats.htmlBytes)} html${stats.wikitextBytes > 0 ? `, ${formatBytes(stats.wikitextBytes)} wikitext` : ''}.`);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    runtimeProcess.exit(1);
}
