"""OSRS Wiki Graph RAG retrieval helpers.

The retriever is intentionally dependency-light. It loads the structured wiki
JSONL and graph JSONL exports produced by the parent rs-sdk tooling, then offers
lexical search plus one-hop graph expansion for agent prompts and tools.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_STRUCTURED_PATH = Path("../../data/wiki/osrs-wiki-structured.jsonl")
DEFAULT_GRAPH_DIR = Path("../../data/wiki/graph-gephi-small")

TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9'+_-]*", re.IGNORECASE)

RELATION_PRIORITY = {
    "lead_link": 5.0,
    "infobox_link": 4.0,
    "requires_material": 9.0,
    "requires_skill": 9.0,
    "requires_tool": 8.0,
    "requires_facility": 8.0,
    "produces_item": 8.0,
    "variant_location": 4.0,
    "variant_quest": 4.0,
    "has_action": 3.0,
    "variant_action": 3.0,
    "equips_in_slot": 2.5,
    "uses_combat_style": 2.0,
    "wiki_link": 1.0,
    "in_category": 0.5,
}


def repo_relative(path: Path) -> Path:
    if path.is_absolute():
        return path
    return (Path(__file__).resolve().parents[1] / path).resolve()


def normalize_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("_", " ").strip()).lower()


def normalize_phrase(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", normalize_title(value)).strip()


def page_node_id(title: str) -> str:
    return f"page:{normalize_title(title)}"


def tokenize(text: str) -> List[str]:
    return [token.lower() for token in TOKEN_RE.findall(text or "") if len(token) > 1]


def clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


@dataclass
class WikiPage:
    title: str
    node_id: str
    primary_type: str
    types: List[str]
    aliases: List[str]
    categories: List[str]
    date_added: Optional[str]
    date_removed: Optional[str]
    url: Optional[str]
    lead: str
    facts: Dict[str, Any]
    sections: List[Dict[str, Any]]
    page_rank: float = 0.0
    page_link_page_rank: float = 0.0


@dataclass
class GraphEdge:
    source: str
    target: str
    relation: str
    weight: float
    field: Optional[str] = None


@dataclass
class SearchResult:
    page: WikiPage
    score: float
    reasons: List[str] = field(default_factory=list)


class OsrsGraphRag:
    """In-memory lexical and graph retriever for the OSRS Wiki dataset."""

    def __init__(
        self,
        structured_path: Optional[Path] = None,
        graph_dir: Optional[Path] = None,
        max_edges_per_node: int = 250,
    ) -> None:
        structured = Path(structured_path) if structured_path is not None else Path(os.getenv("OSRS_STRUCTURED_PATH", str(DEFAULT_STRUCTURED_PATH)))
        graph = Path(graph_dir) if graph_dir is not None else Path(os.getenv("OSRS_GRAPH_DIR", str(DEFAULT_GRAPH_DIR)))
        self.structured_path = repo_relative(structured)
        self.graph_dir = repo_relative(graph)
        self.max_edges_per_node = max_edges_per_node
        self.pages: Dict[str, WikiPage] = {}
        self.title_to_id: Dict[str, str] = {}
        self.inverted: Dict[str, Counter[str]] = defaultdict(Counter)
        self.out_edges: Dict[str, List[GraphEdge]] = defaultdict(list)
        self.loaded = False

    def load(self) -> None:
        if self.loaded:
            return
        self._load_pages()
        self._load_graph_node_metrics()
        self._load_graph_edges()
        self.loaded = True

    def _load_pages(self) -> None:
        if not self.structured_path.exists():
            raise FileNotFoundError(f"Structured wiki JSONL not found: {self.structured_path}")

        with self.structured_path.open("r", encoding="utf-8") as fp:
            for line in fp:
                if not line.strip():
                    continue
                record = json.loads(line)
                title = record["page"]["title"]
                node_id = page_node_id(title)
                taxonomy = record.get("taxonomy", {})
                content = record.get("content", {})
                entity = record.get("entity", {})
                facts = record.get("facts", {})
                page = WikiPage(
                    title=title,
                    node_id=node_id,
                    primary_type=entity.get("primaryType", "article"),
                    types=entity.get("types", []),
                    aliases=entity.get("aliases", []),
                    categories=taxonomy.get("categories", []),
                    date_added=record.get("dateAdded"),
                    date_removed=record.get("dateRemoved"),
                    url=record.get("page", {}).get("url"),
                    lead=content.get("lead", ""),
                    facts={
                        "actions": facts.get("actions", []),
                        "equipment": facts.get("equipment"),
                        "recipes": facts.get("recipes", []),
                        "variants": facts.get("variants", []),
                        "maps": facts.get("maps", []),
                        "fields": facts.get("fields", {}),
                    },
                    sections=[
                        {
                            "heading": section.get("heading"),
                            "kind": section.get("kind"),
                            "plainText": clip(section.get("plainText", ""), 900),
                        }
                        for section in content.get("sections", [])[:8]
                    ],
                )
                self.pages[node_id] = page
                for name in [title, *page.aliases]:
                    self.title_to_id[normalize_title(name)] = node_id
                    self.title_to_id[normalize_phrase(name)] = node_id
                self._index_page(page)

    def _index_page(self, page: WikiPage) -> None:
        weighted_fields = [
            (page.title, 12),
            (" ".join(page.aliases), 10),
            (page.primary_type, 4),
            (" ".join(page.types), 4),
            (" ".join(page.categories), 3),
            (page.lead, 2),
        ]
        fields = page.facts.get("fields", {})
        if isinstance(fields, dict):
            weighted_fields.append((" ".join(str(v) for values in fields.values() for v in values), 2))

        for text, weight in weighted_fields:
            for token in tokenize(text):
                self.inverted[token][page.node_id] += weight

    def _load_graph_node_metrics(self) -> None:
        nodes_path = self.graph_dir / "nodes.jsonl"
        if not nodes_path.exists():
            return
        with nodes_path.open("r", encoding="utf-8") as fp:
            for line in fp:
                if not line.strip():
                    continue
                node = json.loads(line)
                page = self.pages.get(node.get("id"))
                if not page:
                    continue
                page.page_rank = float(node.get("pageRank") or 0.0)
                page.page_link_page_rank = float(node.get("pageLinkPageRank") or 0.0)

    def _load_graph_edges(self) -> None:
        edges_path = self.graph_dir / "edges.jsonl"
        if not edges_path.exists():
            return

        candidates: Dict[str, List[GraphEdge]] = defaultdict(list)
        with edges_path.open("r", encoding="utf-8") as fp:
            for line in fp:
                if not line.strip():
                    continue
                raw = json.loads(line)
                relation = raw.get("relation", "")
                if relation not in RELATION_PRIORITY:
                    continue
                source = raw.get("source", "")
                target = raw.get("target", "")
                if not source or not target:
                    continue
                edge = GraphEdge(
                    source=source,
                    target=target,
                    relation=relation,
                    weight=float(raw.get("weight") or 1.0),
                    field=raw.get("field"),
                )
                candidates[source].append(edge)

        for source, edges in candidates.items():
            edges.sort(key=self._edge_score, reverse=True)
            self.out_edges[source] = edges[: self.max_edges_per_node]

    def _edge_score(self, edge: GraphEdge) -> float:
        target_rank = self.pages.get(edge.target, WikiPage("", "", "", [], [], [], None, None, None, "", {}, [])).page_link_page_rank
        score = RELATION_PRIORITY.get(edge.relation, 1.0) * edge.weight * (1.0 + math.log1p(target_rank * 100000))
        if edge.relation == "infobox_link" and edge.field in {"release", "removal", "update", "removalupdate"}:
            score *= 0.2
        target_title = edge.target.removeprefix("page:")
        if re.fullmatch(r"\d{4}|\d{1,2} [a-z]+", target_title):
            score *= 0.2
        return score

    def resolve_title(self, title: str) -> Optional[str]:
        self.load()
        normalized = normalize_title(title)
        if normalized in self.title_to_id:
            return self.title_to_id[normalized]
        node_id = page_node_id(title)
        return node_id if node_id in self.pages else None

    def search(self, query: str, top_k: int = 8, primary_type: Optional[str] = None) -> List[SearchResult]:
        self.load()
        scores: Counter[str] = Counter()
        reasons: Dict[str, List[str]] = defaultdict(list)
        query_norm = normalize_title(query)
        query_phrase = normalize_phrase(query)
        query_tokens = set(tokenize(query))

        exact = self.resolve_title(query)
        if exact:
            scores[exact] += 100
            reasons[exact].append("exact title/alias match")

        for token in tokenize(query):
            for node_id, score in self.inverted.get(token, {}).items():
                scores[node_id] += score
                if len(reasons[node_id]) < 4:
                    reasons[node_id].append(f"matched token '{token}'")

        for node_id, page in self.pages.items():
            if query_norm and query_norm in normalize_title(page.title):
                scores[node_id] += 25
                reasons[node_id].append("title contains query")
            page_phrases = [normalize_phrase(page.title), *(normalize_phrase(alias) for alias in page.aliases)]
            for phrase in page_phrases:
                if len(phrase) >= 4 and phrase in query_phrase:
                    scores[node_id] += 250 if " " in phrase else 40
                    reasons[node_id].append("query contains title/alias phrase")
                    break
            recipe_score = self._recipe_query_score(page, query_tokens, query_phrase)
            if recipe_score:
                scores[node_id] += recipe_score
                reasons[node_id].append("recipe inputs/outputs match query")
            if "burnt" not in query_tokens and (
                "burnt" in normalize_phrase(page.title)
                or any("burnt food" == normalize_phrase(category) for category in page.categories)
            ):
                scores[node_id] -= 90
                reasons[node_id].append("burnt output deprioritized for non-burn query")

        results: List[SearchResult] = []
        for node_id, score in scores.items():
            page = self.pages[node_id]
            if primary_type and page.primary_type != primary_type:
                continue
            rank_boost = math.log1p(page.page_link_page_rank * 100000) * 2
            results.append(SearchResult(page=page, score=score + rank_boost, reasons=reasons[node_id]))

        results.sort(key=lambda item: item.score, reverse=True)
        return results[:top_k]

    def _recipe_query_score(self, page: WikiPage, query_tokens: set[str], query_phrase: str) -> float:
        best = 0.0
        for recipe in page.facts.get("recipes") or []:
            score = 0.0
            recipe_parts = []
            for collection in ("materials", "outputs"):
                for item in recipe.get(collection, []):
                    name = str(item.get("item", ""))
                    recipe_parts.append((collection, name))
            for tool in recipe.get("tools", []):
                recipe_parts.append(("tools", str(tool)))
            for facility in recipe.get("facilities", []):
                recipe_parts.append(("facilities", str(facility)))
            for skill in recipe.get("skills", []):
                recipe_parts.append(("skills", str(skill.get("name", ""))))

            for kind, name in recipe_parts:
                tokens = set(tokenize(name))
                if not tokens:
                    continue
                phrase = normalize_phrase(name)
                if phrase and len(phrase) >= 4 and phrase in query_phrase:
                    score += 40 if kind == "outputs" else 80
                    continue
                overlap = len(tokens & query_tokens)
                if overlap == len(tokens):
                    score += 25 if kind == "outputs" else 45
                elif overlap > 0 and overlap / len(tokens) >= 0.5:
                    score += 15

            best = max(best, score)
        return best

    def expand(self, titles: Iterable[str], max_neighbors: int = 20) -> Tuple[List[WikiPage], List[GraphEdge]]:
        self.load()
        seed_ids = [node_id for title in titles if (node_id := self.resolve_title(title))]
        seen = set(seed_ids)
        edges: List[GraphEdge] = []
        neighbors: List[WikiPage] = []

        for seed_id in seed_ids:
            for edge in self.out_edges.get(seed_id, [])[:max_neighbors]:
                edges.append(edge)
                if edge.target in self.pages and edge.target not in seen:
                    seen.add(edge.target)
                    neighbors.append(self.pages[edge.target])

        neighbors.sort(key=lambda page: page.page_link_page_rank, reverse=True)
        return neighbors[:max_neighbors], edges[: max_neighbors * max(1, len(seed_ids))]

    def retrieve_context(
        self,
        query: str,
        top_k: int = 6,
        max_neighbors: int = 14,
        primary_type: Optional[str] = None,
    ) -> str:
        results = self.search(query, top_k=top_k, primary_type=primary_type)
        focused = bool(results and any(
            reason in {"exact title/alias match", "query contains title/alias phrase"}
            for reason in results[0].reasons
        ))
        context_results = results[:1] if focused else results
        seed_results = context_results[:2] if focused else results[:4]
        neighbors, edges = self.expand([result.page.title for result in seed_results], max_neighbors=max_neighbors)

        lines = ["# Retrieved OSRS Wiki Context", ""]
        if focused:
            lines.append("Note: A strong title/alias match was found. Prefer the first direct match and use graph neighbors only as supporting context.")
            lines.append("")
        if context_results:
            lines.extend(self._format_hard_facts(context_results[0].page))
        lines.append("## Direct Matches")
        for idx, result in enumerate(context_results, 1):
            lines.extend(self._format_page(result.page, idx, result.score, result.reasons))

        if neighbors:
            lines.append("## Graph Neighbors")
            for idx, page in enumerate(neighbors, 1):
                lines.extend(self._format_page(page, idx, None, ["graph neighbor"], include_facts=False))

        if edges:
            lines.append("## Traversed Edges")
            for edge in edges[:40]:
                source = self.pages.get(edge.source)
                target = self.pages.get(edge.target)
                if not source or not target:
                    continue
                field = f", field={edge.field}" if edge.field else ""
                lines.append(f"- {source.title} --{edge.relation}{field}, weight={edge.weight:g}--> {target.title}")

        return "\n".join(lines)

    def _format_hard_facts(self, page: WikiPage) -> List[str]:
        facts = page.facts
        lines = [
            "## Hard Planning Facts From Best Direct Match",
            f"Use these as authoritative hard facts for `{page.title}`. Do not add extra preconditions/effects unless another direct fact or traversed edge supports them.",
            "- Interpretation rule: recipe skill `level` is a precondition; recipe `xp` is an effect/reward.",
            "- Interpretation rule: quest/category/lead links are associations, not completion preconditions, unless a recipe or explicit requirement field says so.",
        ]
        if facts.get("actions"):
            lines.append(f"- Available item/entity actions: {', '.join(facts['actions'])}")
        recipes = facts.get("recipes") or []
        for idx, recipe in enumerate(recipes[:3], 1):
            skills = ", ".join(
                f"{skill.get('name')} level {skill.get('level')} xp {skill.get('xp')}"
                for skill in recipe.get("skills", [])
            )
            materials = ", ".join(
                f"{material.get('quantity', 1)} x {material.get('item')}"
                for material in recipe.get("materials", [])
            )
            outputs = ", ".join(
                f"{output.get('quantity', 1)} x {output.get('item')}"
                for output in recipe.get("outputs", [])
            )
            tools = ", ".join(recipe.get("tools", [])) or "none"
            facilities = ", ".join(recipe.get("facilities", [])) or "none"
            ticks = recipe.get("ticks", "unknown")
            lines.append(f"- Recipe {idx}: skills=[{skills or 'none'}]; tools=[{tools}]; facilities=[{facilities}]; materials=[{materials or 'none'}]; outputs=[{outputs or 'none'}]; ticks={ticks}.")
        if facts.get("equipment"):
            lines.append(f"- Equipment fact: {json.dumps(facts['equipment'], ensure_ascii=False)[:700]}")
        if facts.get("variants"):
            lines.append(f"- Variant count: {len(facts['variants'])}. Use variants only when version-specific facts matter.")
        lines.append("")
        return lines

    def _format_page(self, page: WikiPage, idx: int, score: Optional[float], reasons: List[str], include_facts: bool = True) -> List[str]:
        score_text = f", score={score:.2f}" if score is not None else ""
        lines = [
            f"### {idx}. {page.title} ({page.primary_type}{score_text})",
            f"- URL: {page.url or 'unknown'}",
            f"- Added/removed: {page.date_added or 'unknown'} / {page.date_removed or 'active-or-unknown'}",
            f"- Categories: {', '.join(page.categories[:10])}",
            f"- Retrieval reasons: {', '.join(reasons[:5])}",
        ]
        if include_facts:
            lines.append(f"- Lead: {clip(page.lead, 900)}")

        facts = page.facts
        if include_facts:
            if facts.get("actions"):
                lines.append(f"- Actions: {', '.join(facts['actions'][:12])}")
            if facts.get("equipment"):
                lines.append(f"- Equipment: {json.dumps(facts['equipment'], ensure_ascii=False)[:900]}")
            if facts.get("recipes"):
                lines.append(f"- Authoritative structured recipes for action modeling: {json.dumps(facts['recipes'][:3], ensure_ascii=False)[:1200]}")
            if facts.get("variants"):
                lines.append(f"- Variants: {json.dumps(facts['variants'][:4], ensure_ascii=False)[:1200]}")
            if facts.get("maps"):
                lines.append(f"- Maps: {json.dumps(facts['maps'][:4], ensure_ascii=False)}")
        else:
            lines.append("- Neighbor use: node identity/background only. Use only Traversed Edges for hard requirements/effects.")

        if include_facts:
            useful_sections = [section for section in page.sections if section.get("plainText")]
            for section in useful_sections[:3]:
                lines.append(f"- Section [{section.get('heading')}]: {clip(section.get('plainText', ''), 500)}")
        lines.append("")
        return lines


_DEFAULT_INDEX: Optional[OsrsGraphRag] = None


def get_default_index() -> OsrsGraphRag:
    global _DEFAULT_INDEX
    if _DEFAULT_INDEX is None:
        _DEFAULT_INDEX = OsrsGraphRag()
    _DEFAULT_INDEX.load()
    return _DEFAULT_INDEX


def wiki_search(query: str, top_k: int = 5) -> str:
    return get_default_index().retrieve_context(query, top_k=top_k, max_neighbors=8)


def graph_expand(title: str, max_neighbors: int = 12) -> str:
    index = get_default_index()
    neighbors, edges = index.expand([title], max_neighbors=max_neighbors)
    if not neighbors and not edges:
        return f"No graph neighbors found for {title!r}."
    lines = [f"# Graph expansion for {title}", ""]
    for edge in edges:
        target = index.pages.get(edge.target)
        if target:
            lines.append(f"- {edge.relation} -> {target.title} ({target.primary_type}, weight={edge.weight:g})")
    return "\n".join(lines)
