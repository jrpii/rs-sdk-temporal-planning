#!/usr/bin/env bun
/**
 * Build a lightweight knowledge graph from structured OSRS Wiki JSONL.
 *
 * Outputs:
 *   - nodes.jsonl / edges.jsonl for Graph RAG ingestion
 *   - gephi-nodes.csv / gephi-edges.csv for visualization
 *   - stats.json with graph and PageRank summaries
 *
 * Example:
 *   bun tools/osrs-wiki-graph.ts
 */

// Bun provides Node-compatible built-ins at runtime; these ignores keep the
// editor quiet when the repo is opened before `bun install` has restored types.
// @ts-ignore
import { createReadStream, createWriteStream } from 'fs';
// @ts-ignore
import { mkdir, writeFile } from 'fs/promises';
// @ts-ignore
import { join, resolve } from 'path';
// @ts-ignore
import { createInterface } from 'readline';

const DEFAULT_INPUT = 'data/wiki/osrs-wiki-structured.jsonl';
const DEFAULT_OUT_DIR = 'data/wiki/graph';
const GRAPH_SCHEMA_VERSION = 'osrs-wiki-graph-v1';

const runtimeProcess = (globalThis as any).process as {
    argv: string[];
    exit(code?: number): never;
};

interface Options {
    input: string;
    outDir: string;
    maxPageLinks: number;
    pageRankIterations: number;
    damping: number;
    includeMissingPages: boolean;
}

interface ExtractedLink {
    target: string;
    label: string;
}

interface StructuredRecord {
    schemaVersion: string;
    page: {
        pageid?: number;
        revid?: number;
        title: string;
        url?: string;
        fetchedAt?: string;
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
    taxonomy: {
        categories: string[];
        hiddenCategories: string[];
        templates: string[];
        infoboxTemplates: string[];
        tags: string[];
    };
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
        lengths: {
            html?: number;
            wikitext?: number;
            plainText: number;
        };
        sections: Array<{
            heading: string;
            kind: string;
            links: ExtractedLink[];
        }>;
    };
}

interface GraphNode {
    id: string;
    label: string;
    kind: 'page' | 'page_ref' | 'category' | 'action' | 'slot' | 'combat_style';
    primaryType?: string;
    types?: string[];
    title?: string;
    url?: string;
    dateAdded?: string | null;
    dateRemoved?: string | null;
    members?: boolean;
    tradeable?: boolean;
    equipable?: boolean;
    aliases?: string[];
    lead?: string;
    pageid?: number;
    indegree: number;
    outdegree: number;
    weightedIndegree: number;
    weightedOutdegree: number;
    pageLinkIndegree: number;
    pageLinkOutdegree: number;
    pageRank: number;
    pageLinkPageRank: number;
}

interface GraphEdge {
    id: string;
    source: string;
    target: string;
    relation: string;
    label: string;
    weight: number;
    evidenceCount: number;
    field?: string;
}

interface GraphBuildStats {
    recordsRead: number;
    parseErrors: number;
    structuredSchemaVersions: Record<string, number>;
    nodesByKind: Record<string, number>;
    pagesByPrimaryType: Record<string, number>;
    edgesByRelation: Record<string, number>;
}

function printUsage(): void {
    console.log(`
Usage:
  bun tools/osrs-wiki-graph.ts [options]

Options:
  --input <path>                 Structured wiki JSONL. Default: ${DEFAULT_INPUT}
  --out-dir <path>               Output directory. Default: ${DEFAULT_OUT_DIR}
  --max-page-links <n>           Max generic outgoing wiki links per page. Default: 100
  --page-rank-iterations <n>     PageRank iterations. Default: 25
  --damping <n>                  PageRank damping factor. Default: 0.85
  --no-missing-pages             Do not create page_ref nodes for linked titles missing from the dataset.
  -h, --help                     Show this help.
`);
}

function parseArgs(argv: string[]): Options {
    const options: Options = {
        input: DEFAULT_INPUT,
        outDir: DEFAULT_OUT_DIR,
        maxPageLinks: 100,
        pageRankIterations: 25,
        damping: 0.85,
        includeMissingPages: true,
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
            case '--out-dir':
                if (!next) throw new Error('--out-dir requires a path');
                options.outDir = next;
                i++;
                break;
            case '--max-page-links':
                if (!next) throw new Error('--max-page-links requires a number');
                options.maxPageLinks = Number(next);
                i++;
                break;
            case '--page-rank-iterations':
                if (!next) throw new Error('--page-rank-iterations requires a number');
                options.pageRankIterations = Number(next);
                i++;
                break;
            case '--damping':
                if (!next) throw new Error('--damping requires a number');
                options.damping = Number(next);
                i++;
                break;
            case '--no-missing-pages':
                options.includeMissingPages = false;
                break;
            case '-h':
            case '--help':
                printUsage();
                runtimeProcess.exit(0);
                break;
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isFinite(options.maxPageLinks) || options.maxPageLinks < 0) {
        throw new Error('--max-page-links must be a non-negative number');
    }
    if (!Number.isFinite(options.pageRankIterations) || options.pageRankIterations < 1) {
        throw new Error('--page-rank-iterations must be a positive number');
    }
    if (!Number.isFinite(options.damping) || options.damping <= 0 || options.damping >= 1) {
        throw new Error('--damping must be between 0 and 1');
    }

    return options;
}

function normalizeTitle(value: string): string {
    return value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function normalizeKey(value: string): string {
    return normalizeTitle(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function pageNodeId(title: string): string {
    return `page:${normalizeTitle(title)}`;
}

function categoryNodeId(category: string): string {
    return `category:${normalizeTitle(category)}`;
}

function conceptNodeId(kind: GraphNode['kind'], label: string): string {
    return `${kind}:${normalizeTitle(label)}`;
}

function ensureNode(nodes: Map<string, GraphNode>, node: Omit<GraphNode, 'indegree' | 'outdegree' | 'weightedIndegree' | 'weightedOutdegree' | 'pageLinkIndegree' | 'pageLinkOutdegree' | 'pageRank' | 'pageLinkPageRank'>): GraphNode {
    const existing = nodes.get(node.id);
    if (existing) {
        const preservePageKind = existing.kind === 'page' && node.kind === 'page_ref';
        Object.assign(existing, Object.fromEntries(Object.entries(node).filter(([, value]) => value !== undefined)));
        if (preservePageKind || node.kind === 'page') {
            existing.kind = 'page';
        }
        return existing;
    }

    const created: GraphNode = {
        ...node,
        indegree: 0,
        outdegree: 0,
        weightedIndegree: 0,
        weightedOutdegree: 0,
        pageLinkIndegree: 0,
        pageLinkOutdegree: 0,
        pageRank: 0,
        pageLinkPageRank: 0,
    };
    nodes.set(node.id, created);
    return created;
}

function addEdge(edges: Map<string, GraphEdge>, source: string, target: string, relation: string, weight: number, field?: string): void {
    if (!source || !target || source === target) {
        return;
    }

    const key = `${source}\t${target}\t${relation}\t${field ?? ''}`;
    const existing = edges.get(key);
    if (existing) {
        existing.weight += weight;
        existing.evidenceCount++;
        return;
    }

    edges.set(key, {
        id: `edge:${edges.size + 1}`,
        source,
        target,
        relation,
        label: field ? `${relation}:${field}` : relation,
        weight,
        evidenceCount: 1,
        field,
    });
}

function maybePageRef(nodes: Map<string, GraphNode>, title: string, includeMissingPages: boolean): string | undefined {
    const id = pageNodeId(title);
    if (!includeMissingPages && !nodes.has(id)) {
        return undefined;
    }
    ensureNode(nodes, {
        id,
        label: title,
        kind: 'page_ref',
        title,
    });
    return id;
}

function addPageTargetEdge(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, source: string, targetTitle: string, relation: string, weight: number, includeMissingPages: boolean, field?: string): void {
    const target = maybePageRef(nodes, targetTitle, includeMissingPages);
    if (target) {
        addEdge(edges, source, target, relation, weight, field);
    }
}

function addConceptEdge(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, source: string, kind: GraphNode['kind'], label: string, relation: string, weight: number, field?: string): void {
    const cleanLabel = label.trim();
    if (!cleanLabel) {
        return;
    }
    const target = conceptNodeId(kind, cleanLabel);
    ensureNode(nodes, {
        id: target,
        label: cleanLabel,
        kind,
    });
    addEdge(edges, source, target, relation, weight, field);
}

function ingestRecord(record: StructuredRecord, options: Options, nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, stats: GraphBuildStats): void {
    stats.structuredSchemaVersions[record.schemaVersion] = (stats.structuredSchemaVersions[record.schemaVersion] ?? 0) + 1;
    stats.pagesByPrimaryType[record.entity.primaryType] = (stats.pagesByPrimaryType[record.entity.primaryType] ?? 0) + 1;

    const source = pageNodeId(record.page.title);
    ensureNode(nodes, {
        id: source,
        label: record.page.title,
        kind: 'page',
        primaryType: record.entity.primaryType,
        types: record.entity.types,
        title: record.page.title,
        url: record.page.url,
        dateAdded: record.dateAdded,
        dateRemoved: record.dateRemoved,
        members: record.entity.members,
        tradeable: record.entity.tradeable,
        equipable: record.entity.equipable,
        aliases: record.entity.aliases,
        lead: record.content.lead,
        pageid: record.page.pageid,
    });

    for (const target of record.relations.outgoingLinks.slice(0, options.maxPageLinks)) {
        addPageTargetEdge(nodes, edges, source, target, 'wiki_link', 1, options.includeMissingPages);
    }

    for (const link of record.content.leadLinks) {
        addPageTargetEdge(nodes, edges, source, link.target, 'lead_link', 4, options.includeMissingPages);
    }

    for (const link of record.relations.infoboxLinks) {
        addPageTargetEdge(nodes, edges, source, link.target, 'infobox_link', 5, options.includeMissingPages, link.field);
    }

    for (const category of record.taxonomy.categories) {
        const target = categoryNodeId(category);
        ensureNode(nodes, {
            id: target,
            label: category,
            kind: 'category',
        });
        addEdge(edges, source, target, 'in_category', 0.5);
    }

    for (const action of record.facts.actions) {
        addConceptEdge(nodes, edges, source, 'action', action, 'has_action', 2);
    }

    if (record.facts.equipment?.slot) {
        addConceptEdge(nodes, edges, source, 'slot', record.facts.equipment.slot, 'equips_in_slot', 2);
    }
    if (record.facts.equipment?.combatStyle) {
        addConceptEdge(nodes, edges, source, 'combat_style', record.facts.equipment.combatStyle, 'uses_combat_style', 1.5);
    }

    for (const recipe of record.facts.recipes) {
        for (const skill of recipe.skills) {
            addPageTargetEdge(nodes, edges, source, skill.name, 'requires_skill', 3, options.includeMissingPages, skill.level !== undefined ? `level:${skill.level}` : undefined);
        }
        for (const tool of recipe.tools) {
            addPageTargetEdge(nodes, edges, source, tool, 'requires_tool', 2.5, options.includeMissingPages);
        }
        for (const facility of recipe.facilities) {
            addPageTargetEdge(nodes, edges, source, facility, 'requires_facility', 2.5, options.includeMissingPages);
        }
        for (const material of recipe.materials) {
            addPageTargetEdge(nodes, edges, source, material.item, 'requires_material', 3, options.includeMissingPages, material.quantity !== undefined ? `qty:${material.quantity}` : undefined);
        }
        for (const output of recipe.outputs) {
            addPageTargetEdge(nodes, edges, source, output.item, 'produces_item', 3, options.includeMissingPages, output.quantity !== undefined ? `qty:${output.quantity}` : undefined);
        }
    }

    for (const variant of record.facts.variants) {
        if (variant.quest) {
            addPageTargetEdge(nodes, edges, source, variant.quest, 'variant_quest', 2, options.includeMissingPages, variant.label);
        }
        if (variant.location) {
            addPageTargetEdge(nodes, edges, source, variant.location, 'variant_location', 2, options.includeMissingPages, variant.label);
        }
        for (const action of variant.actions) {
            addConceptEdge(nodes, edges, source, 'action', action, 'variant_action', 1.5, variant.label);
        }
    }
}

function finalizeDegrees(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>): void {
    for (const node of nodes.values()) {
        node.indegree = 0;
        node.outdegree = 0;
        node.weightedIndegree = 0;
        node.weightedOutdegree = 0;
        node.pageLinkIndegree = 0;
        node.pageLinkOutdegree = 0;
    }

    for (const edge of edges.values()) {
        const source = nodes.get(edge.source);
        const target = nodes.get(edge.target);
        if (!source || !target) {
            continue;
        }
        source.outdegree++;
        target.indegree++;
        source.weightedOutdegree += edge.weight;
        target.weightedIndegree += edge.weight;

        if (isPageLinkEdge(edge, source, target)) {
            source.pageLinkOutdegree++;
            target.pageLinkIndegree++;
        }
    }
}

function isPageLinkEdge(edge: GraphEdge, source: GraphNode, target: GraphNode): boolean {
    return (source.kind === 'page' || source.kind === 'page_ref')
        && (target.kind === 'page' || target.kind === 'page_ref')
        && ['wiki_link', 'lead_link', 'infobox_link'].includes(edge.relation);
}

function computePageRank(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, iterations: number, damping: number, pageLinksOnly: boolean): Map<string, number> {
    const ids = [...nodes.keys()];
    const n = ids.length;
    const ranks = new Map<string, number>(ids.map(id => [id, 1 / n]));
    const adjacency = new Map<string, Array<{ target: string; weight: number }>>();
    const outWeights = new Map<string, number>();

    for (const edge of edges.values()) {
        const source = nodes.get(edge.source);
        const target = nodes.get(edge.target);
        if (!source || !target) {
            continue;
        }
        if (pageLinksOnly && !isPageLinkEdge(edge, source, target)) {
            continue;
        }
        if (pageLinksOnly && source.kind !== 'page') {
            continue;
        }

        adjacency.get(edge.source)?.push({ target: edge.target, weight: edge.weight })
            ?? adjacency.set(edge.source, [{ target: edge.target, weight: edge.weight }]);
        outWeights.set(edge.source, (outWeights.get(edge.source) ?? 0) + edge.weight);
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
        const next = new Map<string, number>(ids.map(id => [id, (1 - damping) / n]));
        let dangling = 0;

        for (const id of ids) {
            const rank = ranks.get(id) ?? 0;
            const outgoing = adjacency.get(id);
            const outWeight = outWeights.get(id) ?? 0;
            if (!outgoing || outWeight === 0) {
                dangling += rank;
                continue;
            }
            for (const edge of outgoing) {
                next.set(edge.target, (next.get(edge.target) ?? 0) + damping * rank * (edge.weight / outWeight));
            }
        }

        const danglingShare = damping * dangling / n;
        for (const id of ids) {
            next.set(id, (next.get(id) ?? 0) + danglingShare);
        }

        ranks.clear();
        for (const [id, rank] of next) {
            ranks.set(id, rank);
        }
    }

    return ranks;
}

function csv(value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    const text = Array.isArray(value) ? value.join('|') : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function jsonStringify(value: unknown): string {
    return JSON.stringify(value);
}

function streamEnd(stream: ReturnType<typeof createWriteStream>): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.on('error', reject);
        stream.end(resolve);
    });
}

function topNodes(nodes: Map<string, GraphNode>, key: keyof Pick<GraphNode, 'indegree' | 'weightedIndegree' | 'pageLinkIndegree' | 'pageRank' | 'pageLinkPageRank'>, limit = 25): Array<Record<string, unknown>> {
    return [...nodes.values()]
        .filter(node => node.kind === 'page' || node.kind === 'page_ref')
        .sort((a, b) => Number(b[key]) - Number(a[key]))
        .slice(0, limit)
        .map(node => ({
            id: node.id,
            title: node.title ?? node.label,
            kind: node.kind,
            primaryType: node.primaryType,
            value: node[key],
        }));
}

async function writeOutputs(outDir: string, nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge>, stats: GraphBuildStats, options: Options): Promise<void> {
    await mkdir(outDir, { recursive: true });

    const nodesJsonl = createWriteStream(join(outDir, 'nodes.jsonl'));
    const edgesJsonl = createWriteStream(join(outDir, 'edges.jsonl'));
    const gephiNodes = createWriteStream(join(outDir, 'gephi-nodes.csv'));
    const gephiEdges = createWriteStream(join(outDir, 'gephi-edges.csv'));

    gephiNodes.write([
        'Id',
        'Label',
        'kind',
        'primaryType',
        'types',
        'url',
        'dateAdded',
        'dateRemoved',
        'members',
        'tradeable',
        'equipable',
        'indegree',
        'outdegree',
        'weightedIndegree',
        'weightedOutdegree',
        'pageLinkIndegree',
        'pageLinkOutdegree',
        'pageRank',
        'pageLinkPageRank',
    ].join(',') + '\n');

    for (const node of nodes.values()) {
        nodesJsonl.write(jsonStringify({
            schemaVersion: GRAPH_SCHEMA_VERSION,
            ...node,
        }) + '\n');
        gephiNodes.write([
            csv(node.id),
            csv(node.label),
            csv(node.kind),
            csv(node.primaryType),
            csv(node.types),
            csv(node.url),
            csv(node.dateAdded),
            csv(node.dateRemoved),
            csv(node.members),
            csv(node.tradeable),
            csv(node.equipable),
            node.indegree,
            node.outdegree,
            node.weightedIndegree,
            node.weightedOutdegree,
            node.pageLinkIndegree,
            node.pageLinkOutdegree,
            node.pageRank,
            node.pageLinkPageRank,
        ].join(',') + '\n');
    }

    gephiEdges.write(['Source', 'Target', 'Type', 'Weight', 'Label', 'relation', 'field', 'evidenceCount'].join(',') + '\n');

    for (const edge of edges.values()) {
        edgesJsonl.write(jsonStringify({
            schemaVersion: GRAPH_SCHEMA_VERSION,
            ...edge,
        }) + '\n');
        gephiEdges.write([
            csv(edge.source),
            csv(edge.target),
            'Directed',
            edge.weight,
            csv(edge.label),
            csv(edge.relation),
            csv(edge.field),
            edge.evidenceCount,
        ].join(',') + '\n');
    }

    await Promise.all([
        streamEnd(nodesJsonl),
        streamEnd(edgesJsonl),
        streamEnd(gephiNodes),
        streamEnd(gephiEdges),
    ]);

    for (const node of nodes.values()) {
        stats.nodesByKind[node.kind] = (stats.nodesByKind[node.kind] ?? 0) + 1;
    }
    for (const edge of edges.values()) {
        stats.edgesByRelation[edge.relation] = (stats.edgesByRelation[edge.relation] ?? 0) + 1;
    }

    const summary = {
        schemaVersion: GRAPH_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        input: resolve(options.input),
        outDir: resolve(options.outDir),
        options,
        ...stats,
        nodeCount: nodes.size,
        edgeCount: edges.size,
        topByIndegree: topNodes(nodes, 'indegree'),
        topByWeightedIndegree: topNodes(nodes, 'weightedIndegree'),
        topByPageLinkIndegree: topNodes(nodes, 'pageLinkIndegree'),
        topByPageRank: topNodes(nodes, 'pageRank'),
        topByPageLinkPageRank: topNodes(nodes, 'pageLinkPageRank'),
    };

    await writeFile(join(outDir, 'stats.json'), JSON.stringify(summary, null, 2), 'utf8');
}

async function main(): Promise<void> {
    const options = parseArgs(runtimeProcess.argv);
    const input = resolve(options.input);
    const outDir = resolve(options.outDir);
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const stats: GraphBuildStats = {
        recordsRead: 0,
        parseErrors: 0,
        structuredSchemaVersions: {},
        nodesByKind: {},
        pagesByPrimaryType: {},
        edgesByRelation: {},
    };

    console.log(`Input: ${input}`);
    console.log(`Output directory: ${outDir}`);

    const rl = createInterface({ input: createReadStream(input) });
    for await (const line of rl) {
        if (!line.trim()) {
            continue;
        }
        stats.recordsRead++;
        try {
            const record = JSON.parse(line) as StructuredRecord;
            ingestRecord(record, options, nodes, edges, stats);
        } catch (error) {
            stats.parseErrors++;
            console.warn(`Skipping malformed line ${stats.recordsRead}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    console.log(`Records read: ${stats.recordsRead}, parse errors: ${stats.parseErrors}`);
    console.log(`Computing degrees for ${nodes.size} nodes and ${edges.size} edges...`);
    finalizeDegrees(nodes, edges);

    console.log(`Computing PageRank (${options.pageRankIterations} iterations)...`);
    const pageRank = computePageRank(nodes, edges, options.pageRankIterations, options.damping, false);
    const pageLinkPageRank = computePageRank(nodes, edges, options.pageRankIterations, options.damping, true);
    for (const node of nodes.values()) {
        node.pageRank = pageRank.get(node.id) ?? 0;
        node.pageLinkPageRank = pageLinkPageRank.get(node.id) ?? 0;
    }

    console.log('Writing graph outputs...');
    await writeOutputs(outDir, nodes, edges, stats, options);

    console.log(`Done. Nodes: ${nodes.size}, edges: ${edges.size}`);
    console.log(`Gephi nodes: ${join(outDir, 'gephi-nodes.csv')}`);
    console.log(`Gephi edges: ${join(outDir, 'gephi-edges.csv')}`);
    console.log(`Stats: ${join(outDir, 'stats.json')}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    runtimeProcess.exit(1);
});
