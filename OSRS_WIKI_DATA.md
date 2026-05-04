# OSRS Wiki Structured Dataset

This repository includes tools for turning OSRS Wiki pages into structured JSONL records and a graph export suitable for RAG, Graph RAG, EDA, and Gephi visualization.

Generated data lives under `data/wiki/`, which is ignored by git because the crawl and graph files are large.

## Current Outputs

Structured article dataset:

```powershell
bun tools/osrs-wiki-structure.ts --out data/wiki/osrs-wiki-structured.jsonl
```

Current full structured stats:

- Records processed/written: `35,003`
- Parse/write errors: `0`
- Schema version: `osrs-wiki-structured-v4`
- Records with `dateAdded`: `27,875`
- Records with `dateRemoved`: `1,833`
- Primary type distribution: `item` 12,389, `article` 5,898, `scenery` 5,561, `npc` 4,175, `monster` 1,652, `music` 1,228, `location` 1,108, `guide` 793, plus smaller type groups.

Graph exports:

```powershell
# Full Graph RAG export. Richer, but heavy for Gephi.
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured.jsonl --out-dir data/wiki/graph --max-page-links 100 --page-rank-iterations 25

# Smaller visualization export. Usually better for Gephi/report figures.
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured.jsonl --out-dir data/wiki/graph-gephi-small --max-page-links 25 --page-rank-iterations 25
```

Current graph sizes:

- `data/wiki/graph`: `45,589` nodes, `3,154,405` edges.
- `data/wiki/graph-gephi-small`: `44,216` nodes, `1,399,251` edges.

Each graph directory contains:

- `nodes.jsonl`: Graph RAG node records.
- `edges.jsonl`: Graph RAG edge records.
- `gephi-nodes.csv`: Gephi node table.
- `gephi-edges.csv`: Gephi edge table.
- `stats.json`: Counts, type distributions, relation distributions, top indegree nodes, and top PageRank nodes.

## Structured Record Schema

Each line in `osrs-wiki-structured.jsonl` is one wiki page record.

Important top-level fields:

- `schemaVersion`: Current value is `osrs-wiki-structured-v4`.
- `source`: Wiki source identifier.
- `extractedAt`: Time the structured record was generated.
- `page`: Page identity and crawl metadata.
- `entity`: Stable entity identity and coarse type classification.
- `dateAdded` / `dateRemoved`: Top-level lifecycle fields intended for filtering.
- `lifecycle`: Date candidates and extracted year evidence.
- `taxonomy`: Categories, hidden categories, templates, infobox templates, and tags.
- `infoboxes`: Parsed top-level infobox templates with raw params and normalized fields.
- `facts`: Extracted domain facts.
- `relations`: Outgoing wiki links and infobox-specific links.
- `content`: Lead text, lead links, plain text, optional raw wikitext, lengths, and structured sections.

### `entity`

`entity.primaryType` and `entity.types` are intentionally coarse and low-cardinality. They are meant for stable filtering and broad routing, not for preserving every wiki category.

Examples:

- A quest NPC has `primaryType: "npc"`, while `Quest NPCs`, `Bankers`, or `Lunar Isle` remain in `taxonomy.categories`.
- A quest item has `primaryType: "item"`, while `Quest items`, `Ring slot items`, or `Crafting` remain in taxonomy fields.

Use `taxonomy.categories`, `taxonomy.tags`, and `facts.fields` when you need fine-grained OSRS labels.

### `taxonomy`

`taxonomy.categories` preserves visible wiki categories. `taxonomy.hiddenCategories` keeps maintenance and structural categories. `taxonomy.templates` includes every template reported by the wiki API, including modules and buckets. `taxonomy.infoboxTemplates` is the cleaner list of parsed infobox-style templates.

For RAG and EDA, prefer:

- `taxonomy.categories` for page classification.
- `taxonomy.tags` for broad faceted filtering.
- `taxonomy.infoboxTemplates` for identifying pages with structured infobox data.

### `facts`

`facts` is where the script promotes common OSRS wiki patterns into normalized data:

- `ids`: Numeric page/entity IDs from infobox fields.
- `maps`: Map coordinates from `{{Map}}` templates.
- `actions`: Options/actions such as `Talk-to`, `Bank`, `Wield`, or `Destroy`.
- `variants`: Version-aligned facts from switch infoboxes. Use this for NPCs or objects with multiple forms, locations, IDs, or action sets.
- `equipment`: Equipment slot, attack speed/range, combat style, and combat bonuses.
- `recipes`: Recipe skill requirements, tools, facilities, materials, outputs, ticks, and members flag.
- `fields`: Consolidated normalized infobox fields.

### `relations`

`relations.outgoingLinks` is broad and useful for graph context, but it is noisy. Treat it as "the wiki page mentions this target", not as a hard gameplay precondition.

`relations.infoboxLinks` is more semantically meaningful because it comes from structured fields such as `quest`, `location`, `monster`, `release`, `preceded`, or `succeeded`.

### `content`

`content.lead` is the best compact text chunk for retrieval. `content.leadLinks` is often much cleaner than the full outgoing link list.

`content.sections` keeps section-level structure:

- `heading`, `level`, `kind`, `path`, and `anchor` describe where the section came from.
- `plainText` is the cleaned section text.
- `wikitext` is present when raw wikitext was kept.
- `links` and `templates` preserve section-local graph signals.

Template-heavy sections may have sparse plain text but rich `templates`. For example, `Combat stats` and `Creation` sections often matter because their templates populate `facts.equipment` or `facts.recipes`.

## Graph Schema

`tools/osrs-wiki-graph.ts` builds a graph from the structured records.

Node kinds:

- `page`: A structured wiki page present in the dataset.
- `page_ref`: A linked page title not present as a structured record in the current dataset.
- `category`: A wiki category node.
- `action`: An action/option concept node.
- `slot`: Equipment slot concept node.
- `combat_style`: Combat style concept node.

Important node metrics:

- `indegree` / `outdegree`: Directed edge counts across the whole exported graph.
- `weightedIndegree` / `weightedOutdegree`: Edge-weighted versions.
- `pageLinkIndegree` / `pageLinkOutdegree`: Counts only page-to-page `wiki_link`, `lead_link`, and `infobox_link` edges.
- `pageRank`: Weighted PageRank over all exported edges.
- `pageLinkPageRank`: Weighted PageRank over page-to-page link edges only. This is usually the best node-size column for report visualizations.

Edge relations:

- `wiki_link`: Generic outgoing wiki page link.
- `lead_link`: Link in the page lead. Higher-signal than generic outgoing links.
- `infobox_link`: Link in an infobox field. High-signal structured relation.
- `in_category`: Page belongs to a wiki category.
- `has_action`: Page/entity has an action or option.
- `equips_in_slot`: Equipment slot relation.
- `uses_combat_style`: Equipment combat style relation.
- `variant_quest`, `variant_location`, `variant_action`: Version-aligned variant facts.
- `requires_skill`, `requires_tool`, `requires_facility`, `requires_material`: Recipe requirement relations.
- `produces_item`: Recipe output relation.

## Gephi Workflow

Use `data/wiki/graph-gephi-small` first for report figures. The full graph is better for Graph RAG but heavier to visualize.

In Gephi:

1. Import `gephi-nodes.csv` as nodes.
2. Import `gephi-edges.csv` as directed edges.
3. Size nodes by `pageLinkPageRank` for a page-centric view, or by `pageLinkIndegree` for a simpler popularity view.
4. Color nodes by `primaryType` for page nodes, or by `kind` if you want to distinguish pages, categories, actions, and slots.
5. Filter to `kind == page` for a clean page-only view.
6. Filter edge relation types if needed. Good report-friendly subsets are `lead_link + infobox_link`, or `requires_* + produces_item` for crafting graphs.
7. Run a layout such as ForceAtlas2, then use modularity/community detection if you want clusters.

If Gephi struggles, regenerate with a smaller generic link cap:

```powershell
bun tools/osrs-wiki-graph.ts --input data/wiki/osrs-wiki-structured.jsonl --out-dir data/wiki/graph-gephi-tiny --max-page-links 10 --page-rank-iterations 25
```

The semantic edges are not capped by `--max-page-links`; only broad generic `wiki_link` edges are reduced.

## Graph RAG Query Guidance

A useful Graph RAG agent should treat the structured JSONL as the source of textual/factual evidence and the graph as a navigation layer.

Recommended retrieval pattern:

1. Use lexical/vector search over `content.lead`, `content.sections[].plainText`, `facts.fields`, `taxonomy.categories`, and `entity.aliases`.
2. Resolve candidate pages to graph node IDs using normalized page titles.
3. Expand from candidates with relation-aware priorities:
   - Highest precision: `infobox_link`, `lead_link`, `requires_*`, `produces_item`, `has_action`, `variant_*`.
   - Broad context: `wiki_link`, `in_category`.
4. Use `dateAdded` and `dateRemoved` to answer time-bounded questions or filter removed/temporary content.
5. Use `entity.primaryType` for coarse filters, and `taxonomy.categories/tags` for fine filters.
6. Use `facts.variants` when a page has multiple versions; do not assume flattened `facts.fields` values align by index unless using `variants`.
7. Cite or inspect the source page fields before turning an edge into a hard planning rule.

Example query strategies:

- "How do I craft a perfect ring?"
  - Retrieve the `'perfect' ring` page.
  - Follow `requires_skill`, `requires_tool`, `requires_facility`, and `requires_material`.
  - Read `facts.recipes` for exact level, XP, ticks, materials, and output.

- "Which NPCs can bank on Lunar Isle?"
  - Search for pages with `primaryType: npc`, action `Bank`, and location/category signals around `Lunar Isle`.
  - Prefer `facts.variants` because actions and locations may differ by NPC version.

- "What content was available during a date?"
  - Filter pages where `dateAdded <= date` and `dateRemoved` is null or after the date.
  - Use `primaryType` and categories to narrow to items, NPCs, quests, events, or locations.

- "What are neighbors of a concept for graph expansion?"
  - Start from the page node.
  - Expand 1 hop through `lead_link` and `infobox_link`.
  - Expand recipe/action/variant edges if the question is about planning actions.
  - Add broader `wiki_link` neighbors only when recall matters more than precision.

Redirect aliases are a separate useful layer. If generated with `tools/osrs-wiki-crawler.ts --redirects-only`, use the redirects JSONL as an alias resolver before page lookup.
