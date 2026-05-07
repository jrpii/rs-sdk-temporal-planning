"""Local OSRS Graph RAG agent entry point.

This CLI uses the structured OSRS Wiki dataset and graph exports from the
parent rs-sdk project, then sends grounded context to an OpenAI-compatible local
LLM endpoint such as Ollama.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Dict, List

from src.losthq_catalog import retrieve_losthq_context
from src.osrs_graph_rag import OsrsGraphRag


if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")


OSRS_SYSTEM_PROMPT = """You are an OSRS domain-model and planning assistant.
You help build symbolic domain knowledge for an rs-sdk bot from retrieved OSRS Wiki facts.

Ground rules:
- Use the retrieved context as evidence. Do not invent exact requirements or effects that are not supported.
- Prefer the first Direct Match when the context says there is a strong title/alias match.
- For domain-model preconditions/effects, copy from "Hard Planning Facts From Best Direct Match" when present.
- In recipe facts, `level` is a precondition and `xp` is an effect/reward.
- Do not mix recipe/action facts from similarly named pages unless the question asks for comparison.
- Prefer structured `facts.recipes`, `facts.equipment`, `facts.actions`, and `facts.variants` over prose when they disagree.
- Use Graph Neighbors as background context only. Core preconditions/effects must come from Direct Match facts or Traversed Edges from that direct match.
- If prose and structured recipe facts disagree, report the conflict under uncertainty instead of merging both into hard preconditions.
- Quest links, categories, and page topics are associations, not quest-completion preconditions, unless an explicit requirement field says completion is required.
- Distinguish hard structured facts from likely planning hypotheses.
- For action/domain-model questions, organize the answer as: entities, actions, preconditions, effects, resources/locations, uncertainty.
- Mention which wiki pages or graph edges support the answer.
- If the context is insufficient, say what additional page or game observation should be queried next.
- When a section titled "LostHQ 2004 game catalog" is present, treat it as authoritative for **whether an NPC or item exists in the 2004-era client data** and for in-game options/drops summaries. The wiki slice may omit or differ; prefer LostHQ for existence in that snapshot.
"""


def build_user_prompt(question: str, context: str) -> str:
    return f"""Question:
{question}

Retrieved context:
{context}

Answer for an agent that will use this knowledge for Graph RAG, planning, or domain-model creation."""


def configure_ollama(api_base: str, model: str, api_key: str) -> None:
    os.environ["API_BASE"] = api_base.rstrip("/")
    os.environ["MODEL_NAME"] = model
    os.environ["OPENAI_API_KEY"] = api_key


def call_local_llm(question: str, context: str, max_tokens: int, temperature: float) -> Dict[str, str]:
    from src.agent import chat_agent

    messages: List[Dict[str, str]] = [
        {"role": "system", "content": OSRS_SYSTEM_PROMPT},
        {"role": "user", "content": build_user_prompt(question, context)},
    ]
    return chat_agent(messages, max_tokens=max_tokens, temperature=temperature, timeout=300)


def answer_once(args: argparse.Namespace, index: OsrsGraphRag, question: str) -> None:
    context = index.retrieve_context(
        question,
        top_k=args.top_k,
        max_neighbors=args.neighbors,
        primary_type=args.primary_type,
    )
    if args.losthq:
        context = context + "\n\n" + retrieve_losthq_context(question, top_each=args.losthq_top_each)

    if args.show_context or args.no_llm:
        print("\n=== Retrieved Context ===")
        print(context)

    if args.no_llm:
        return

    response = call_local_llm(question, context, max_tokens=args.max_tokens, temperature=args.temperature)
    print("\n=== Agent Answer ===")
    if response.get("ok"):
        print(response.get("text") or "")
    else:
        print(f"LLM ERROR: {response.get('error')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="OSRS Wiki Graph RAG agent for local Ollama-compatible LLMs.")
    parser.add_argument("--question", "-q", type=str, default=None, help="Question to answer. If omitted with --interactive, prompts repeatedly.")
    parser.add_argument("--interactive", "-i", action="store_true", help="Run an interactive question loop.")
    parser.add_argument("--structured", type=str, default=os.getenv("OSRS_STRUCTURED_PATH", "../../data/wiki/osrs-wiki-structured-2004.jsonl"), help="Structured wiki JSONL path.")
    parser.add_argument("--graph-dir", type=str, default=os.getenv("OSRS_GRAPH_DIR", "../../data/wiki/graph-2004"), help="Graph export directory.")
    parser.add_argument("--api-base", type=str, default=os.getenv("API_BASE", "http://127.0.0.1:11434/v1"), help="OpenAI-compatible API base. Ollama default: http://127.0.0.1:11434/v1")
    parser.add_argument("--model", type=str, default=os.getenv("MODEL_NAME", os.getenv("MODEL", "gemma3:12b")), help="Local model name, e.g. gemma3:12b, gemma3:4b, deepseek-r1:7b, or gpt-oss:20b.")
    parser.add_argument("--api-key", type=str, default=os.getenv("OPENAI_API_KEY", "ollama"), help="Bearer token. Ollama accepts any value.")
    parser.add_argument("--top-k", type=int, default=6, help="Direct lexical matches to retrieve.")
    parser.add_argument("--neighbors", type=int, default=14, help="Graph neighbors to add from top matches.")
    parser.add_argument("--primary-type", type=str, default=None, help="Optional coarse type filter, e.g. item, npc, quest.")
    parser.add_argument("--max-tokens", type=int, default=1200, help="Maximum answer tokens.")
    parser.add_argument("--temperature", type=float, default=0.1, help="LLM temperature.")
    parser.add_argument("--show-context", action="store_true", help="Print retrieved context before the LLM answer.")
    parser.add_argument("--no-llm", action="store_true", help="Only run retrieval; do not call the local model.")
    parser.add_argument(
        "--losthq",
        action="store_true",
        help="Append LostHQ 2004 NPC/item catalog context (needs data/losthq/*.json from bun tools/losthq-sync.ts).",
    )
    parser.add_argument(
        "--losthq-top-each",
        type=int,
        default=5,
        help="Max NPC and max item hits to include when --losthq is set.",
    )
    args = parser.parse_args()

    configure_ollama(args.api_base, args.model, args.api_key)
    index = OsrsGraphRag(structured_path=args.structured, graph_dir=args.graph_dir)
    print(f"Loading OSRS Graph RAG index from {args.structured} and {args.graph_dir}...", flush=True)
    index.load()
    print(f"Loaded {len(index.pages)} structured pages.", flush=True)

    if args.question:
        answer_once(args, index, args.question)
        return

    if not args.interactive:
        parser.error("Provide --question or use --interactive.")

    print("Enter OSRS planning/domain-model questions. Empty line exits.")
    while True:
        question = input("\nosrs-rag> ").strip()
        if not question:
            break
        answer_once(args, index, question)


if __name__ == "__main__":
    main()
