### Main script, will eventually be entry point for agent loop.
import sys
import argparse
import random
import json
from pathlib import Path
from datetime import datetime
from src.utils import parse_json_input, truncate, normalize_answer
from src.agent import call_agent, guess_domain, guess_complexity, run_react_loop
from src.prompts import get_reasoning_system_prompt, get_extract_prompt
from generate_answer_template import validate_results

# Address Unicode encoding for Windows (keep parsed data unchanged.)
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, required=True, help="Path to JSON file for agent to parse.")
    parser.add_argument("--max-entries", type=int, default=None, help="Max entries to process.")
    parser.add_argument("--max-reasoning-tokens", type=int, default=512, help="Max tokens for reasoning pass.")
    parser.add_argument("--max-answer-tokens", type=int, default=128, help="Max tokens for answer extraction pass.")
    parser.add_argument("--output", type=str, default=None, help="Write answers to JSON for grading.")
    
    args = parser.parse_args()

    # If running on test, default to results/test_data_outputs/run-timestamp.json
    input_name = Path(args.input).name
    if args.output is None and "test_data" in input_name:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        results_dir = Path("results") / "test_data_outputs"
        results_dir.mkdir(parents=True, exist_ok=True)
        args.output = str(results_dir / f"{Path(input_name).stem}_{ts}.json")

    # Ensure parent directory output exists and file is created.
    if args.output is not None:
        out_path = Path(args.output)
        # Use trailing slash or existing directory as taget, make file.
        if args.output.endswith(("/", "\\")) or out_path.is_dir():
            out_dir = out_path
            out_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            stem = Path(input_name).stem or "outputs"
            out_path = out_dir / f"{stem}_{ts}.json"
        else:
            if out_path.parent:
                out_path.parent.mkdir(parents=True, exist_ok=True)
        args.output = str(out_path)
        print(f"Logging answers to {args.output}", flush=True)

    data = parse_json_input(args.input)

    # Infer domain and difficulty for a prefix of the data (limit if max-entries is set).
    if args.max_entries is not None and args.max_entries > 0:
        meta_limit = 10 * args.max_entries
    else:
        meta_limit = len(data)

    print(f"Inferring domain and difficulty for up to {meta_limit} entries... this may take a while...", flush=True)
    subset = []
    for idx, entry in enumerate(data):
        if idx >= meta_limit:
            break

        if "domain" not in entry or not entry["domain"]:
            entry["domain"] = guess_domain(entry.get("input", ""))
        if "complexity" not in entry or not entry["complexity"]:
            entry["complexity"] = guess_complexity(entry.get("input", ""))

        subset.append(entry)
        print(f"Entry {entry.get('input', '')[:50]}: Domain: {entry.get('domain', 'unknown')}, Complexity: {entry.get('complexity', 'unknown')}", flush=True)
    
    if subset:
        data = subset

    # Sort by domain, then randomly sample up to max-entries per domain (when domain is available, else do max overall).
    if args.max_entries is not None:
        with_domain = []
        without_domain = []
        for item in data:
            if "domain" in item and item["domain"] is not None:
                with_domain.append(item)
            else:
                without_domain.append(item)

        if with_domain:
            by_domain = {}
            for item in with_domain:
                domain = item.get("domain")
                by_domain.setdefault(domain, []).append(item)

            sampled = []
            for domain, entries in by_domain.items():
                if len(entries) > args.max_entries:
                    sampled.extend(random.sample(entries, args.max_entries))
                else:
                    sampled.extend(entries)

            data = sampled
            random.shuffle(data)
        else:
            data = without_domain[:args.max_entries]
    
    print(f"Loaded {len(data)} entries.\n", flush=True)

    # Log answers for grading if output path set.
    answers = [] if args.output else None

    # Correctness tracking for dev.
    total_answered = 0
    total_correct = 0
    domain_stats = {}

    try:
        # Simple two-pass inference loop
        for idx, entry in enumerate(data, 1):
            print(f"\nEntry {idx}/{len(data)}", flush=True)
            print(f"INPUT: {truncate(entry['input'], 500)}", flush=True)

            # Get system prompt based on domain (seperated in order to add domain approximation).
            domain = entry.get("domain", "unknown")
            complexity = entry.get("complexity", "unknown")
            system_prompt = get_reasoning_system_prompt(domain, complexity)

            # Set/scale temperature and max tokens based on complexity.
            complexity_lvl = str(complexity).lower()
            base_max = args.max_reasoning_tokens
            if complexity_lvl in ("extremely hard"):
                reasoning_temp = 0.5
                reasoning_max_tokens = int(base_max * 2)
            elif complexity_lvl in ("hard"):
                reasoning_temp = 0.4
                reasoning_max_tokens = int(base_max * 1.5)
            elif complexity_lvl == "medium":
                reasoning_temp = 0.25
                reasoning_max_tokens = base_max
            else:
                reasoning_temp = 0.0
                reasoning_max_tokens = max(128, int(base_max * 0.5))

            # CoT reasoning call.
            reasoning = call_agent(system_prompt=system_prompt, user_message=entry["input"], max_tokens=reasoning_max_tokens, temperature=reasoning_temp)

            final_answer = None
            react_answer = None

            # Extraction CoT reasoning and log CoT answer.
            if reasoning["ok"] and reasoning.get("text"):
                print(f"REASONING OUTPUT:\n{reasoning['text']}", flush=True)

                # Extraction call
                extract_system = get_extract_prompt(domain)
                extract_user = (
                    "Problem:\n"
                    f"{entry['input']}\n"
                    "Draft solution:\n"
                    f"{reasoning['text']}\n"
                    "Extract and return only the final answer string."
                )
                extraction = call_agent(
                    system_prompt=extract_system,
                    user_message=extract_user,
                    max_tokens=args.max_answer_tokens
                )

                if extraction["ok"] and extraction["text"] is not None:
                    model_answer = extraction["text"].strip()
                    # For coding tasks, keep the raw code.
                    if domain == "coding":
                        final_answer = model_answer
                    else:
                        final_answer = normalize_answer(model_answer)
                    print(f"COT ANSWER: {final_answer}", flush=True)
                else:
                    print(f"ERROR (extraction): {extraction['error']}", flush=True)
            else:
                print(f"ERROR (reasoning): {reasoning['error']}", flush=True)

            # ReAct usage policy: decide steps by difficulty and domain.
            react_steps = 0
            if complexity_lvl == "easy":
                if domain in ("math", "coding"):
                    react_steps = 5
            elif complexity_lvl == "medium":
                react_steps = 8
            elif complexity_lvl in ("hard"):
                react_steps = 10
            elif complexity_lvl in ("extremely hard"):
                react_steps = 12

            # Build ReAct input from question and CoT reasoning. If needed it can use tools or think harder.
            react_input = entry["input"]
            if reasoning["ok"] and reasoning.get("text"):
                react_input = (
                    "Question:\n"
                    f"{entry['input']}\n\n"
                    "Initial chain-of-thought draft solution:\n"
                    f"{reasoning['text']}\n\n"
                    "Use the available tools to double-check any computations or logic "
                    "and, if helpful, refine the final answer."
                )

            if react_steps > 0:
                print(
                    f"Running ReAct (steps={react_steps}, domain={domain}, complexity={complexity_lvl})",
                    flush=True,
                )
                print(f"REACT INPUT (truncated): {truncate(react_input, 500)}", flush=True)
                # The ReAct agent loop. Gives the think, act, observe loop.
                react_output = run_react_loop(react_input, max_steps=react_steps, temperature=reasoning_temp)
                if react_output["ok"] and react_output.get("answer"):
                    if domain == "coding":
                        react_answer = react_output["answer"].strip()
                    else:
                        react_answer = normalize_answer(react_output["answer"])
                    print(f"REACT ANSWER ({react_steps} steps): {react_answer}", flush=True)
                elif not react_output["ok"]:
                    print(f"REACT ERROR: {react_output['error']}", flush=True)
                # Print the ReAct trace.
                if react_output.get("trace"):
                    print("REACT TRACE (raw):", flush=True)
                    print(truncate(react_output["trace"], 1200), flush=True)
            else:
                print("Skipping ReAct for this entry (react_steps=0).", flush=True)

            # Log answer for grading. Prefer ReAct answer when available.
            if react_answer is not None:
                final_answer = react_answer
            if answers is not None:
                answers.append({"output": final_answer if final_answer is not None else ""})

            # Dev evaluation when GT output is available.
            if "output" in entry and final_answer is not None:
                total_answered += 1
                is_correct = (final_answer == entry["output"])
                if is_correct:
                    total_correct += 1
                if domain not in domain_stats:
                    domain_stats[domain] = [0, 0]
                domain_stats[domain][1] += 1
                if is_correct:
                    domain_stats[domain][0] += 1

                print(f"EXPECTED ANSWER: {entry['output']}", flush=True)
                status = "CORRECT :)" if is_correct else "INCORRECT :("
                print(f"RESULT: {status}", flush=True)
    except KeyboardInterrupt:
        print("\nInterupt detected, stopping after current entry....", flush=True)
    finally:
        # If requested, write answers in grading format and validate like generate_answer_template.py.
        if answers is not None and args.output:
            try:
                with open(args.output, "w", encoding="utf-8") as fp:
                    json.dump(answers, fp, ensure_ascii=False, indent=2)

                # Re-load and validate against the questions we actually processed.
                with open(args.output, "r", encoding="utf-8") as fp:
                    saved_answers = json.load(fp)
                validate_results(data, saved_answers)

                print(
                    f"\nWrote {len(answers)} answers to {args.output} "
                    "and validated format successfully.",
                    flush=True,
                )
            except Exception as e:
                print(f"\nFailed to write/validate answers to {args.output}: {e}", flush=True)

    # Final correct tallys.
    print("\nFinal Correct Tallys:", flush=True)
    if total_answered > 0:
        print(f"Overall: {total_correct}/{total_answered} correct ({(total_correct / total_answered) * 100:.2f}%)", flush=True)
    if domain_stats:
        print(f"\nPer-Domain Statistics:", flush=True)
        for domain, (correct, total) in sorted(domain_stats.items()):
            domain_pct = (correct / total) * 100 if total > 0 else 0.0
            print(f"  {domain}: {correct}/{total} correct ({domain_pct:.2f}%)", flush=True)
    print(f"\nAll entries processed... Exiting!\n", flush=True)

if __name__ == "__main__":
    main()
