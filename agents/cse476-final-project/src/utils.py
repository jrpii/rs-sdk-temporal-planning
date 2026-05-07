### Utility functions for data loading, parsing, evaluation, and the agent loop.
import json
import re
from typing import Dict, List, Any

# Helper method to extract json data as a dictionary.
def parse_json_input(file_path: str) -> List[Dict[str, Any]]:
    with open(file_path, 'r', encoding='utf-8') as file:
        data = json.load(file)
    
    # Extract input & output, domain (if present)
    parsed = []
    for item in data:
        parsed_field = {"input": item["input"]}
        if "output" in item:
            parsed_field["output"] = item["output"]
        if "domain" in item:
            parsed_field["domain"] = item["domain"]
        parsed.append(parsed_field)
    
    return parsed

# Helper method to truncate text to max length (for terminal input logging w/o bloat).
def truncate(text: str, max_len: int = 500) -> str:
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."

# Heuristic to normalize and sanitize model's answer. (from observed output patterns)
def normalize_answer(text: str) -> str:
    string = text.strip()
    if not string:
        return ""

    # Regex to strip extra words.
    string = re.sub(r"(?i)^(the\s+final\s+answer\s+is[:\-\s]*)", "", string).strip()
    string = re.sub(r"(?i)^(final\s+answer[:\-\s]*)", "", string).strip()
    string = re.sub(r"(?i)^(answer[:\-\s]*)", "", string).strip()

    # Markdown sanitization.
    if string.startswith("$$") and string.endswith("$$"):
        string = string[2:-2].strip()
    elif string.startswith("$") and string.endswith("$"):
        string = string[1:-1].strip()

    markdown_box = re.fullmatch(r"\\boxed\{(.+)\}", string)
    if markdown_box:
        string = markdown_box.group(1).strip()

    # Trim trailing period (none of the answers have them for some reason).
    if string.endswith("."):
        string = string[:-1].strip()
    return " ".join(string.split())
