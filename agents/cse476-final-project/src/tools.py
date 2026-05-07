### Small math/code/wiki tools for ReAct agent.
import math
from typing import Callable, Dict
from src.losthq_catalog import losthq_lookup_item, losthq_lookup_npc, retrieve_losthq_context
from src.osrs_graph_rag import graph_expand, wiki_search

# Run math calculations, return result or error message.
def math_tool(expr: str) -> str:
    env = {name: getattr(math, name) for name in dir(math) if not name.startswith("_")}
    # Helpers the model uses in math questions.
    def _digit_sum(n: int) -> int:
        return sum(int(d) for d in str(int(n)))
    env.update(
        {
            "abs": abs,
            "min": min,
            "max": max,
            "round": round,
            "C": math.comb,
            "binom": math.comb,
            "s": _digit_sum,
        }
    )
    try:
        return str(eval(expr, {"__builtins__": {}}, env)) # Evaluate the expression.
    except Exception as error:
        return f"ERROR: {error}"

# Check if provided python code compiles, returns OK, or error message.
def python_tool(code: str) -> str:
    try:
        compile(code, "<python_tool>", "exec")
        return "OK"
    except SyntaxError as error:
        return f"SYNTAX ERROR: {error.msg} (line {error.lineno})"
    except Exception as error:
        return f"ERROR: {error}"

# Simple reflection tool for domains without numeric/code tools.
def reflect_tool(note: str) -> str:
    if note:
        return f"Reflect more carefully on this aspect: {note}"
    return "Reflect: double-check your reasoning, assumptions, and final answer for consistency."

def wiki_search_tool(query: str) -> str:
    return wiki_search(query, top_k=5)

def graph_expand_tool(title: str) -> str:
    return graph_expand(title, max_neighbors=12)


def losthq_search_tool(query: str) -> str:
    """NPC + item lexical search against LostHQ 2004 catalog (local JSON)."""
    return retrieve_losthq_context(query.strip(), top_each=5)


def losthq_npc_tool(term: str) -> str:
    """NPC by debugname or fuzzy name (LostHQ / rev-254-style data)."""
    return losthq_lookup_npc(term.strip())


def losthq_item_tool(term: str) -> str:
    """Item by debugname, id, or fuzzy name (LostHQ)."""
    return losthq_lookup_item(term.strip())


# Dictionary of available tools, cool.
TOOLS: Dict[str, Callable[[str], str]] = {
    "math": math_tool,
    "python": python_tool,
    "reflect": reflect_tool,
    "wiki_search": wiki_search_tool,
    "graph_expand": graph_expand_tool,
    "losthq_search": losthq_search_tool,
    "losthq_npc": losthq_npc_tool,
    "losthq_item": losthq_item_tool,
}

# Run a tool with a given name and argument.
def run_tool(name: str, arg: str) -> str:
    tool = TOOLS.get(name.lower())
    return tool(arg) if tool else f"ERROR: unknown tool '{name}'"
