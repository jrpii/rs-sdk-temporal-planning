"""LostHQ (2004.losthq.rs) NPC/item catalog for rev-254–style game data.

Loads JSON snapshots from ``data/losthq/`` (run ``bun tools/losthq-sync.ts`` from
repo root). If files are missing, optionally fetches once via HTTP.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_LOSTHQ_NPCS: Optional[Dict[str, Any]] = None
_LOSTHQ_ITEMS: Optional[Dict[str, Any]] = None

BASE_URL = "https://2004.losthq.rs"
GAME_VER = os.getenv("LOSTHQ_GAME_VER", "254")
USER_AGENT = (
    "rs-sdk-temporal-planning/1.0 (academic game-research; local agent RAG; low frequency)"
)


def losthq_data_dir() -> Path:
    override = os.getenv("LOSTHQ_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()
    # Same layout as osrs_graph_rag: project dir + ../../data/...
    return (Path(__file__).resolve().parents[1] / "../../data/losthq").resolve()


def _maybe_fetch(path: Path, url_path: str) -> None:
    try:
        import requests
    except ImportError:
        return
    url = f"{BASE_URL}{url_path}?v={GAME_VER}"
    try:
        r = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json,*/*"},
            timeout=120,
        )
        if r.status_code != 200:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    except OSError:
        return


def _load_json(name: str, url_path: str) -> Dict[str, Any]:
    path = losthq_data_dir() / name
    if not path.is_file():
        _maybe_fetch(path, url_path)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def load_npcs() -> Dict[str, Any]:
    global _LOSTHQ_NPCS
    if _LOSTHQ_NPCS is None:
        _LOSTHQ_NPCS = _load_json("npc_data.json", "/js/npcdb/npc_data.json")
    return _LOSTHQ_NPCS


def load_items() -> Dict[str, Any]:
    global _LOSTHQ_ITEMS
    if _LOSTHQ_ITEMS is None:
        _LOSTHQ_ITEMS = _load_json("item_data.json", "/js/itemdb/item_data.json")
    return _LOSTHQ_ITEMS


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _tokens(s: str) -> List[str]:
    return [t for t in _norm(s).split() if len(t) > 1]


def _score_name(query_toks: List[str], name: str, debug: str) -> float:
    if not query_toks:
        return 0.0
    nl = _norm(name)
    dl = debug.lower()
    score = 0.0
    for t in query_toks:
        if t in dl:
            score += 3.0
        if t in nl:
            score += 2.0
    q = " ".join(query_toks)
    if q and q in nl:
        score += 12.0
    if q and q in dl.replace("_", " "):
        score += 10.0
    return score


def search_npcs(query: str, limit: int = 10) -> List[Tuple[str, float, Dict[str, Any]]]:
    npcs = load_npcs()
    if not npcs:
        return []
    qtok = _tokens(query)
    ranked: List[Tuple[str, float, Dict[str, Any]]] = []
    for debug, obj in npcs.items():
        if not isinstance(obj, dict):
            continue
        name = str(obj.get("name") or debug)
        sc = _score_name(qtok, name, debug)
        if sc > 0:
            ranked.append((debug, sc, obj))
    ranked.sort(key=lambda x: (-x[1], x[2].get("name") or x[0]))
    return ranked[:limit]


def search_items(query: str, limit: int = 10) -> List[Tuple[str, float, Dict[str, Any]]]:
    items = load_items()
    if not items:
        return []
    qtok = _tokens(query)
    ranked: List[Tuple[str, float, Dict[str, Any]]] = []
    for debug, obj in items.items():
        if not isinstance(obj, dict):
            continue
        name = str(obj.get("name") or debug)
        sc = _score_name(qtok, name, debug)
        tags = obj.get("searchTags") or []
        if isinstance(tags, str):
            tags = tags.split()
        if isinstance(tags, list):
            tag_l = " ".join(str(t).lower() for t in tags)
            for t in qtok:
                if t in tag_l:
                    sc += 1.5
        if sc > 0:
            ranked.append((debug, sc, obj))
    ranked.sort(key=lambda x: (-x[1], x[2].get("name") or x[0]))
    return ranked[:limit]


def _clip_drops(drops: Any, max_rows: int = 12) -> Any:
    if not isinstance(drops, dict):
        return drops
    out: Dict[str, Any] = {}
    for key in ("always", "rollable", "tertiary"):
        block = drops.get(key)
        if isinstance(block, list):
            out[key] = block[:max_rows]
            if len(block) > max_rows:
                out[key + "_truncated"] = len(block) - max_rows
    return out or drops


def summarize_npc(debug: str, obj: Dict[str, Any], detail: bool = True) -> str:
    name = obj.get("name", debug)
    vis = obj.get("vislevel", "")
    lines = [
        f"- **{name}** (`debugname={debug}`)",
        f"  - display_level: {vis}",
        f"  - examine/desc: {str(obj.get('desc', ''))[:240]}",
    ]
    ops = [obj.get(k) for k in ("op1", "op2", "op3", "op4", "op5") if obj.get(k)]
    if ops:
        lines.append(f"  - options: {', '.join(str(o) for o in ops if o)}")
    if detail and obj.get("drops"):
        d = _clip_drops(obj["drops"], 8)
        lines.append(f"  - drops (truncated): {json.dumps(d, ensure_ascii=False)[:1800]}")
    return "\n".join(lines)


def summarize_item(debug: str, obj: Dict[str, Any]) -> str:
    name = obj.get("name", debug)
    iid = obj.get("id", "")
    lines = [
        f"- **{name}** (`debugname={debug}`, id={iid})",
    ]
    skip = {"name", "id", "debugname", "searchTags"}
    extra = []
    for k, v in sorted(obj.items()):
        if k in skip or v in (None, "", [], {}):
            continue
        if isinstance(v, (dict, list)):
            s = json.dumps(v, ensure_ascii=False)
            if len(s) > 400:
                s = s[:400] + "..."
        else:
            s = str(v)
        extra.append(f"  - {k}: {s}")
    lines.extend(extra[:20])
    return "\n".join(lines)


def retrieve_losthq_context(query: str, top_each: int = 5) -> str:
    """Lexical match over LostHQ NPC + item DB for grounding (markdown)."""
    npcs = load_npcs()
    items = load_items()
    if not npcs and not items:
        return (
            "# LostHQ 2004 catalog\n\n"
            "No local data. From repo root run: `bun tools/losthq-sync.ts` "
            "(writes `data/losthq/*.json`), or set `LOSTHQ_DATA_DIR`.\n"
        )

    n_hits = search_npcs(query, top_each)
    i_hits = search_items(query, top_each)

    lines: List[str] = [
        "# LostHQ 2004 game catalog (rev-style snapshot)",
        f"Source: [{BASE_URL}]({BASE_URL}) NPC/item databases. Prefer this for **exists-in-this-era** checks.",
        "",
    ]
    if n_hits:
        lines.append("## NPC matches")
        for debug, _sc, obj in n_hits:
            lines.append(summarize_npc(debug, obj))
        lines.append("")
    else:
        lines.append("## NPC matches\n(none for this query)\n")

    if i_hits:
        lines.append("## Item matches")
        for debug, _sc, obj in i_hits:
            lines.append(summarize_item(debug, obj))
        lines.append("")
    else:
        lines.append("## Item matches\n(none for this query)\n")

    return "\n".join(lines)


def losthq_lookup_npc(term: str) -> str:
    term = term.strip()
    if not term:
        return "ERROR: empty npc query"
    npcs = load_npcs()
    if not npcs:
        return "ERROR: no npc_data.json — run `bun tools/losthq-sync.ts` from repo root."
    if term in npcs:
        return summarize_npc(term, npcs[term], detail=True)
    hits = search_npcs(term, 8)
    if not hits:
        return f"No LostHQ NPC match for {term!r}."
    out = ["Top NPC candidates (use exact debugname in-game where relevant):\n"]
    for debug, sc, obj in hits:
        out.append(summarize_npc(debug, obj, detail=False))
        out.append(f"  (score={sc:.1f})\n")
    return "\n".join(out)


def losthq_lookup_item(term: str) -> str:
    term = term.strip()
    if not term:
        return "ERROR: empty item query"
    items = load_items()
    if not items:
        return "ERROR: no item_data.json — run `bun tools/losthq-sync.ts` from repo root."
    if term in items:
        return summarize_item(term, items[term])
    # also match by id
    if term.isdigit():
        tid = int(term)
        for dbg, obj in items.items():
            if isinstance(obj, dict) and int(obj.get("id") or -1) == tid:
                return summarize_item(dbg, obj)
    hits = search_items(term, 8)
    if not hits:
        return f"No LostHQ item match for {term!r}."
    out = ["Top item candidates:\n"]
    for debug, sc, obj in hits:
        out.append(summarize_item(debug, obj))
        out.append(f"  (score={sc:.1f})\n")
    return "\n".join(out)
