"""Benchmark local Ollama models on OSRS Graph RAG tasks.

The goal is not a formal eval suite. It records enough timing and basic quality
signals to choose different local models for fast planning feedback vs slower
domain-model drafting.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime
import json
from pathlib import Path
import time
from typing import Any, Dict, List

from osrs_agent import OSRS_SYSTEM_PROMPT, build_user_prompt, configure_ollama
from src.agent import chat_agent
from src.osrs_graph_rag import OsrsGraphRag


DEFAULT_MODELS = [
    "gemma3:12b",
    "gemma3:4b",
    "deepseek-r1:7b",
    "gpt-oss:20b",
]

TASKS = [
    {
        "id": "domain_model_recipe",
        "kind": "domain_model_generation",
        "question": "Build a small domain model for crafting a perfect ring.",
        "expected": ["'perfect' ring", "Crafting", "level 40", "70", "Ring mould", "Anvil", "'perfect' gold bar", "Ruby"],
        "avoid": ["quest completion is required", "completed the Family Crest", "hammer"],
    },
    {
        "id": "planning_feedback_recipe",
        "kind": "planning_feedback",
        "question": "A bot has a Ruby, a 'perfect' gold bar, a ring mould, Crafting level 40, and is near an anvil. What action should it try next, and what facts support that?",
        "expected": ["Anvil", "Ring mould", "'perfect' gold bar", "Ruby", "Crafting", "70"],
        "avoid": ["furnace is required", "Family Crest must be completed"],
    },
    {
        "id": "npc_variant_banking",
        "kind": "domain_model_generation",
        "question": "Build a small domain model for 'Birds-Eye' Jack and his banking interaction.",
        "expected": ["Banker", "Bank", "Collect", "Lunar Isle", "Dream Mentor", "variant"],
        "avoid": ["all versions can bank", "Pirate can bank"],
    },
]


def score_response(text: str, expected: List[str], avoid: List[str]) -> Dict[str, Any]:
    lower = text.lower()
    expected_hits = [term for term in expected if term.lower() in lower]
    avoid_hits = [term for term in avoid if term.lower() in lower]
    return {
        "expected_hits": expected_hits,
        "expected_hit_count": len(expected_hits),
        "expected_total": len(expected),
        "avoid_hits": avoid_hits,
        "avoid_hit_count": len(avoid_hits),
        "score": len(expected_hits) - 2 * len(avoid_hits),
    }


def run_one(
    model: str,
    task: Dict[str, Any],
    index: OsrsGraphRag,
    max_tokens: int,
    temperature: float,
    api_base: str,
    api_key: str,
) -> Dict[str, Any]:
    configure_ollama(api_base, model, api_key)

    retrieval_start = time.perf_counter()
    context = index.retrieve_context(task["question"], top_k=3, max_neighbors=8)
    retrieval_seconds = time.perf_counter() - retrieval_start

    messages = [
        {"role": "system", "content": OSRS_SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(task["question"], context)},
    ]

    generation_start = time.perf_counter()
    response = chat_agent(messages, max_tokens=max_tokens, temperature=temperature, timeout=600)
    generation_seconds = time.perf_counter() - generation_start
    text = response.get("text") or ""
    quality = score_response(text, task["expected"], task["avoid"])

    return {
        "model": model,
        "task_id": task["id"],
        "task_kind": task["kind"],
        "ok": bool(response.get("ok")),
        "error": response.get("error"),
        "retrieval_seconds": round(retrieval_seconds, 3),
        "generation_seconds": round(generation_seconds, 3),
        "total_seconds": round(retrieval_seconds + generation_seconds, 3),
        "response_chars": len(text),
        "response_preview": text[:1200],
        **quality,
    }


def write_outputs(out_dir: Path, results: List[Dict[str, Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "osrs_model_benchmark.json"
    csv_path = out_dir / "osrs_model_benchmark.csv"
    md_path = out_dir / "osrs_model_benchmark.md"

    json_path.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    fieldnames = [
        "model",
        "task_id",
        "task_kind",
        "ok",
        "retrieval_seconds",
        "generation_seconds",
        "total_seconds",
        "response_chars",
        "score",
        "expected_hit_count",
        "expected_total",
        "avoid_hit_count",
        "error",
    ]
    with csv_path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        for row in results:
            writer.writerow({field: row.get(field) for field in fieldnames})

    by_model: Dict[str, List[Dict[str, Any]]] = {}
    for row in results:
        by_model.setdefault(row["model"], []).append(row)

    lines = [
        "# OSRS Graph RAG Model Benchmark",
        "",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        "",
        "| Model | Runs | Avg generation s | Avg total s | Avg score | Avoid hits |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for model, rows in by_model.items():
        avg_gen = sum(row["generation_seconds"] for row in rows) / len(rows)
        avg_total = sum(row["total_seconds"] for row in rows) / len(rows)
        avg_score = sum(row["score"] for row in rows) / len(rows)
        avoid_hits = sum(row["avoid_hit_count"] for row in rows)
        lines.append(f"| `{model}` | {len(rows)} | {avg_gen:.2f} | {avg_total:.2f} | {avg_score:.2f} | {avoid_hits} |")

    lines.extend(["", "## Per-Run Results", ""])
    for row in results:
        lines.append(f"### {row['model']} / {row['task_id']}")
        lines.append(f"- Generation seconds: {row['generation_seconds']}")
        lines.append(f"- Score: {row['score']} ({row['expected_hit_count']}/{row['expected_total']} expected hits, {row['avoid_hit_count']} avoid hits)")
        if row.get("error"):
            lines.append(f"- Error: {row['error']}")
        lines.append("")
        lines.append("```text")
        lines.append(row.get("response_preview", ""))
        lines.append("```")
        lines.append("")

    md_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark Ollama models on OSRS Graph RAG tasks.")
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS, help="Ollama model names to test.")
    parser.add_argument("--structured", default="../../data/wiki/osrs-wiki-structured-2004.jsonl")
    parser.add_argument("--graph-dir", default="../../data/wiki/graph-2004")
    parser.add_argument("--api-base", default="http://127.0.0.1:11434/v1")
    parser.add_argument("--api-key", default="ollama")
    parser.add_argument("--max-tokens", type=int, default=1000)
    parser.add_argument("--temperature", type=float, default=0.1)
    parser.add_argument("--out-dir", default="results/osrs_benchmarks")
    args = parser.parse_args()

    index_start = time.perf_counter()
    index = OsrsGraphRag(structured_path=args.structured, graph_dir=args.graph_dir)
    print(f"Loading OSRS Graph RAG index from {args.structured} and {args.graph_dir}...", flush=True)
    index.load()
    print(f"Loaded {len(index.pages)} pages in {time.perf_counter() - index_start:.2f}s", flush=True)

    results: List[Dict[str, Any]] = []
    for model in args.models:
        for task in TASKS:
            print(f"Running {model} on {task['id']}...", flush=True)
            result = run_one(model, task, index, args.max_tokens, args.temperature, args.api_base, args.api_key)
            print(f"  total={result['total_seconds']}s score={result['score']} avoid={result['avoid_hit_count']}", flush=True)
            results.append(result)

    out_dir = Path(args.out_dir)
    write_outputs(out_dir, results)
    print(f"Wrote benchmark results to {out_dir.resolve()}", flush=True)


if __name__ == "__main__":
    main()
