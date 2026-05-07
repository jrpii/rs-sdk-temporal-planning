### Simple agent for making LLM API calls and related helpers.
import re
from typing import Any, Dict, List, Optional
import requests
from scripts.config import get_api_key, get_api_base, get_model_name
from src.prompts import get_react_system_prompt
from src.tools import run_tool

API_KEY = get_api_key()
API_BASE = get_api_base()
MODEL = get_model_name()

# Domain and difficulty labels.
DOMAINS = ["math", "coding", "future_prediction", "planning", "common_sense", "osrs"]
COMPLEXITY_LEVELS = ["easy", "medium", "hard", "extremely hard"]

# Chat helper that works with message history for ReAct agent.
def chat_agent(messages: List[Dict[str, str]], max_tokens: int = 512, temperature: float = 0.0, timeout: int = 120) -> Dict[str, Any]:
    # Build request URL and headers (like notebook).
    url = f"{API_BASE}/chat/completions"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": MODEL,
        "messages": messages, # Now pass in message history to give it persistent context.
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    
    # Try to make the request (again like the notebook).
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            message = data.get("choices", [{}])[0].get("message", {})
            text = message.get("content") or message.get("reasoning") or ""
            return {"ok": True, "text": text.strip() if text else None, "error": None}
        try:
            # try best-effort to surface error text
            error_text = resp.json()
        except:
            error_text = resp.text
        return {"ok": False, "text": None, "error": str(error_text)}
    except requests.RequestException as e:
        return {"ok": False, "text": None, "error": str(e)}

# Simpler CoT-style call w/ system prompt and user message.
def call_agent(system_prompt: str, user_message: str, max_tokens: int = 512, temperature: float = 0.0, timeout: int = 120) -> Dict[str, Any]:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    return chat_agent(messages, max_tokens=max_tokens, temperature=temperature, timeout=timeout)

# Have model infere domain lavel from question.
def guess_domain(text: str) -> str:
    system_prompt = (
        "You are a classifier that assigns a single domain label to a question. "
        "Possible domain labels are: math, coding, future_prediction, planning, common_sense, osrs. "
        "Reply with exactly one of these labels and nothing else."
    )
    user_message = (
        "Question:\n"
        f"{text}\n\n"
        "Choose the single best domain label from: math, coding, future_prediction, "
        "planning, common_sense, osrs, general.\n"
        "Reply with exactly one domain label (for example: math)."
    )
    
    resp = call_agent(system_prompt=system_prompt, user_message=user_message, max_tokens=8)
    if not resp["ok"] or not resp.get("text"):
        return "general"

    label = resp["text"].strip().split()[0].lower()
    return label if label in DOMAINS else "general"

# Have model infere complexity level from question.
def guess_complexity(text: str) -> str:
    system_prompt = (
        "You are a difficulty classifier for questions. "
        "Choose exactly one label from: easy, medium, hard, extremely hard. "
        "Reply with only that label and nothing else."
    )
    user_message = (
        "Question:\n"
        f"{text}\n\n"
        "Classify the difficulty of this question as exactly one of: "
        "easy, medium, hard, extremely hard.\n"
        "Reply with just that single label."
    )

    resp = call_agent(system_prompt=system_prompt, user_message=user_message, max_tokens=8)
    if not resp["ok"] or not resp.get("text"):
        return "medium"

    label = resp["text"].strip().lower().split()[0]
    return label if label in COMPLEXITY_LEVELS else "medium"

# Parse action from the message.
def parse_action(text: str) -> Optional[Dict[str, str]]:
    for line in reversed(text.splitlines()):
        line = line.strip()

        if line.lower().startswith("action:"):
            body = line.split(":", 1)[1].strip()
            match = re.match(r"<(\w+)>\[(.*)\]", body) # Action: <TOOL_NAME>[ARGUMENT]
            if match:
                return {"tool": match.group(1), "argument": match.group(2)}
    return None

# Parse final answer from the mressage.
def parse_final_answer(text: str) -> Optional[str]:
    for line in reversed(text.splitlines()):
        if "final answer" in line.lower():
            parts = line.split(":", 1)
            return parts[1].strip() if len(parts) > 1 else line.strip()
    return None

# Run a single ReAct itteration for a question (ReAct loop is Think, Act, Observe).
def run_react_loop(question: str, max_steps: int = 3, temperature: float = 0.2) -> Dict[str, Any]:
    system_prompt = get_react_system_prompt()
    messages: List[Dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": question},
    ]
    trace: List[str] = []

    # Run loop for the max number of steps (<20 calls required on high end).
    for _ in range(max_steps):
        response = chat_agent(messages, max_tokens=512, temperature=temperature)
        if not response["ok"]:
            return {"ok": False, "answer": None, "trace": "\n".join(trace), "error": response["error"]}

        text = response.get("text") or ""
        trace.append(text)
        messages.append({"role": "assistant", "content": text})
        final = parse_final_answer(text)

        if final is not None:
            return {"ok": True, "answer": final, "trace": "\n".join(trace), "error": None}

        action = parse_action(text)
        if action is None:
            break

        observation = run_tool(action["tool"], action["argument"])
        messages.append({"role": "user", "content": f"[Observation]: {observation}"})

    # Make one last call that forces the model to commit to a final answer (if step limit reached).
    if trace:
        user = (
            "You have reached the step limit for using tools.\n"
            "Based on the entire conversation and all observations above, "
            "you must now provide the final answer.\n"
            "Respond with a single line starting with 'Final Answer:' followed by the answer, "
            "and do not include any additional explanation."
        )
        messages.append({"role": "user", "content": user})
        forced_resp = chat_agent(messages, max_tokens=256, temperature=0.0)
        if forced_resp["ok"] and forced_resp.get("text"):
            text = forced_resp["text"] or ""
            trace.append(text)
            final = parse_final_answer(text)
            if final is not None:
                return {"ok": True, "answer": final, "trace": "\n".join(trace), "error": None}
            return {
                "ok": False,
                "answer": None,
                "trace": "\n".join(trace),
                "error": "Failed to produce a 'Final Answer:' line.",
            }

    return {
        "ok": False,
        "answer": None,
        "trace": "\n".join(trace),
        "error": "No final answer produced within max_steps.",
    }
