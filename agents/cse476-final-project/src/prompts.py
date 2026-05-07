### System prompts for the agent (and helpers to get them).

# Dictionary of system prompts per domain, will expand upon later.
SYSTEM_PROMPTS = {
    "default": "You are a helpful assistant.",
    "math": "You are a math problem solver.",
    "coding": "You are a coding assistant.",
    "future_prediction": "You are a prediction assistant.",
    "planning": "You are a planning assistant.",
    "osrs": "You are an OSRS domain-model and planning assistant for an rs-sdk bot.",
    "common_sense": "You are a common sense reasoning assistant.",
    "general": "You are a helpful assistant that provides accurate answers."
}

EXTRACT_SYSTEM_PROMPT = (
    "You are an answer extraction assistant. Given a problem description and a draft solution, "
    "output only the final answer string in plain text. Do not use markdown headings or bullet lists. "
    "Do not wrap the answer in LaTeX dollar signs or use \\boxed. Do not include any explanation or "
    "extra words such as 'Final answer'. Return just the answer string.\n"
)

# Small, domain-specific example sets to guide the extractor toward the right format.
EXTRACT_EXAMPLES = {
    "math": [
        {
            "input": "Simplify $(-k + 4) + (-2 + 3k)$.",
            "answer": "2k+2",
        },
        {
            "input": "Consider the geometric sequence $\\frac{125}{9}, \\frac{25}{3}, 5, 3, \\ldots$. What is the eighth term of the sequence? Express your answer as a common fraction.",
            "answer": "\\frac{243}{625}",
        },
        {
            "input": "Find the real roots of\n\\[\\frac{( x+ 1)(x - 3)}{5(x + 2)(x - 4)} + \\frac{(x + 3)(x - 5)}{9(x + 4)(x - 6)} - \\frac{2(x + 5)(x - 7)}{13(x + 6)(x - 8)} = \\frac{92}{585}.\\]Enter the real roots, separated by commas.",
            "answer": "1 \\pm \\sqrt{19}",
        },
        {
            "input": "Mrs. Snyder used to spend 40% of her monthly income on rent and utilities. Her salary was recently increased by $600 so now her rent and utilities only amount to 25% of her monthly income. How much was her previous monthly income?",
            "answer": "1000 <Or in words> Let her previous monthly income be p\nThe cost of her rent and utilities was 40% of p which is (40/100)*p = 2p/5\nHer income was increased by $600 so it is now p+$600\nThe cost of her rent and utilities now amount to 25% of (p+$600) which is (25/100)*(p+$600) = (p+$600)/4\nEquating both expressions for cost of rent and utilities: 2p/5 = (p+$600)/4\nMultiplying both sides of the equation by 20 gives 8p = 5p+$3000\nSubtracting 5p from both sides gives: 3p = $3000\nDividing both sides by 3 gives p = $1000\n#### 1000",
        },
        {
            "input": "Ann, Bill, Cate, and Dale each buy personal pan pizzas cut into 4 pieces. If Bill and Dale eat 50% of their pizzas and Ann and Cate eat 75% of the pizzas, how many pizza pieces are left uneaten?",
            "answer": "6 <or in words> In total, there are 4 x 4 = <<4*4=16>>16 pizza pieces.\nBill and Dale eat 2 x 4 x 50% = <<2*4*50*.01=4>>4 pieces.\nAnn and Cate eat 2 x 4 x 75% = <<2*4*75*.01=6>>6 pieces.\nThe four of them eat 4 + 6 = <<4+6=10>>10 pieces.\nThere are 16 - 10 = <<16-10=6>>6 pizza pieces uneaten.\n#### 6",
        },
        {
            "input": "A figure skater is facing north when she begins to spin to her right. She spins 2250 degrees. Which direction (north, south, east or west) is she facing when she finishes her spin?",
            "answer": "\\text{east}",
        },
    ],
    "coding": [
        {
            "input": "Draw and return a subplot of a normal distribution with the given mean and standard deviation, utilizing numpy's linspace to create an array of 100 linearly spaced numbers between mu - 3*sigma and mu + 3*sigma.",
            "answer": "x = np.linspace(mu - 3 * sigma, mu + 3 * sigma, 100)\n    y = norm.pdf(x, mu, sigma)\n\n    fig, ax = plt.subplots()\n    ax.plot(x, y)\n    return ax",
        },
        {
            "input": "Create a histogram from the data in a list of lists. If any sublist is empty, it will be filled with 5 random integers ranging from 0 to 100 (both inclusive). The histogram will then be constructed using the combined data from all sublists.",
            "answer": "random.seed(seed)\n    data = []\n    plt.figure()\n    for list_ in list_of_lists:\n        if list_:\n            data += list_\n        else:\n            data += [random.randint(0, 100) for _ in range(5)]\n\n    plot = sns.histplot(data)\n    return plot",
        },
        {
            "input": "Add a specific path to sys.path and update a configuration file with this path.",
            "answer": "    if isinstance(path_to_append, list):\n        for path in path_to_append:\n            sys.path.append(path)\n    else:\n        sys.path.append(path_to_append)\n\n    config = ConfigParser()\n\n    # Create the file if it doesn't exist\n    if not os.path.exists(config_file):\n        open(config_file, 'a').close()\n\n    config.read(config_file)\n    path_str = ','.join(path_to_append) if isinstance(path_to_append, list) else path_to_append\n    config.set('DEFAULT', 'path_to_append', path_str)\n\n    with open(config_file, 'w') as file:\n        config.write(file)\n\n    return config, config_file",
        },
        {
            "input": "Moves all files that match a particular pattern from one directory to another. The function should return a list of filenames that were moved.",
            "answer": "    moved_files = []\n    for path, dirs, files in os.walk(source_directory):\n        for filename in fnmatch.filter(files, file_pattern):\n            shutil.move(os.path.join(path, filename), os.path.join(destination_directory, filename))\n            moved_files.append(filename)\n    return moved_files",
        },
        {
            "input": "Generate a pandas DataFrame with random values based on lists 'a' and 'b', and plot it as a bar chart. The function should return the Axes object of the plotted bar chart.",
            "answer": "    if not a or not b:\n        fig, ax = plt.subplots()\n        plt.close(fig)\n        return ax\n\n    np.random.seed(0)\n    selected_columns = COLUMNS[:len(b)]\n    df = pd.DataFrame(np.random.randn(len(a), len(b)), index=a, columns=selected_columns)\n    ax = df.plot(kind='bar')\n    return ax",
        },
    ],
    "planning": [
        {
            "input": "I have to plan logistics to transport packages within cities via trucks and between cities via airplanes... [STATEMENT] As initial conditions I have that, location_0_0 is an airport, location_1_0 is an airport, airplane_0 is at location_0_0, airplane_1 is at location_1_0, package_0 is at location_1_1, truck_0 is at location_0_1, truck_1 is at location_1_0, ... My plan is as follows: [PLAN] drive truck_1 from location_1_0 to location_1_1 in city_1; load package_0 into truck_1 at location_1_1; ... [PLAN END] [STATEMENT] ... My goal is to have that package_0 is at location_0_2 and package_1 is at location_0_0. My plan is as follows: [PLAN]",
            "answer": "(drive-truck t0 l0-1 l0-0 c0)\n(drive-truck t1 l1-0 l1-1 c1)\n(load-truck p0 t1 l1-1)\n(drive-truck t1 l1-1 l1-2 c1)\n(load-truck p1 t1 l1-2)\n(drive-truck t1 l1-2 l1-0 c1)\n(unload-truck p1 t1 l1-0)\n(unload-truck p0 t1 l1-0)\n(fly-airplane a0 l0-0 l1-0)\n(load-airplane p1 a0 l1-0)\n(load-airplane p0 a0 l1-0)\n(fly-airplane a0 l1-0 l0-0)\n(unload-airplane p1 a0 l0-0)\n(unload-airplane p0 a0 l0-0)\n(load-truck p0 t0 l0-0)\n(drive-truck t0 l0-0 l0-2 c0)\n(unload-truck p0 t0 l0-2)",
        },
        {
            "input": "I am playing with a set of objects. Actions include paltry, sip, clip, wretched, memory, tightfisted with various preconditions and effects over predicates like hand, cats, texture, vase, next, sneeze, spring, stupendous, collect... [STATEMENT] As initial conditions I have many facts over objects 0–23, including next object_17 object_16, next object_18 object_10, next object_21 object_14, texture object_10–16, texture object_8, texture object_9, etc. My goal is to have that next object_17 object_15, next object_18 object_8, next object_19 object_14, next object_20 object_13, next object_21 object_16, next object_22 object_9 and next object_23 object_16. My plan is as follows: [PLAN] wretched object_5 object_9 object_10 object_2; clip object_18 object_5 object_10; ... [PLAN END] [STATEMENT] ... My goal is to have that next object_17 object_15, next object_18 object_10, next object_19 object_9, next object_20 object_10, next object_21 object_8, next object_22 object_13 and next object_23 object_9. My plan is as follows: [PLAN]",
            "answer": "(wretched o6 o11 o12 o3)\n(clip o22 o6 o12)\n(wretched o6 o12 o13 o3)\n(tightfisted o22 o6 o13)\n(wretched o7 o14 o16 o4)\n(clip o17 o7 o16)\n(wretched o7 o16 o15 o4)\n(clip o23 o7 o15)\n(clip o21 o7 o15)\n(clip o19 o7 o15)\n(clip o18 o7 o15)\n(tightfisted o17 o7 o15)\n(wretched o7 o15 o14 o4)\n(tightfisted o23 o7 o14)\n(tightfisted o21 o7 o14)\n(tightfisted o19 o7 o14)\n(tightfisted o18 o7 o14)\n(sip o23 o1 o14)\n(sip o21 o1 o14)\n(sip o19 o1 o14)\n(sip o18 o1 o14)\n(memory o1 o14 o8)\n(paltry o23 o1 o8)\n(paltry o21 o1 o8)\n(paltry o19 o1 o8)\n(paltry o18 o1 o8)\n(wretched o5 o9 o8 o2)\n(clip o23 o5 o8)\n(clip o20 o5 o8)\n(clip o19 o5 o8)\n(clip o18 o5 o8)\n(wretched o5 o8 o10 o2)\n(tightfisted o20 o5 o10)\n(tightfisted o18 o5 o10)\n(wretched o5 o10 o9 o2)\n(tightfisted o23 o5 o9)\n(tightfisted o19 o5 o9)",
        },
    ],
    "common_sense": [
        {
            "input": "What happens to coaches at midnight?",
            "answer": "Nothing in particular happens to coaches at midnight",
        },
        {
            "input": "Do bears usually sit on chairs?",
            "answer": "No, bears do not use chairs",
        },
        {
            "input": "How is Joan Molinsky better known?",
            "answer": "joan rivers",
        },
    ],
    "future_prediction": [
        {
            "input": "Predict the CoinMarketCap Fear and Greed Index for 2025-07-25. Format the answer as [value].",
            "answer": "[66.0]",
        },
        {
            "input": "Predict the Shanghai Shipping Exchange Far East Dry Bulk Index FDI composite index for 2025-08-06. Format the answer as [value].",
            "answer": "[1295.29]",
        },
        {
            "input": "Predict the CSI 300 index opening level for 2025-08-13. Format the answer as [value].",
            "answer": "[4150.5]",
        },
    ],
}


def get_system_prompt(domain: str = None) -> str:
    if domain and domain in SYSTEM_PROMPTS:
        return SYSTEM_PROMPTS[domain]
    return SYSTEM_PROMPTS["default"]

# For full domain specific CoT reasoning.
def get_reasoning_system_prompt(domain: str = None, complexity: str = None) -> str:
    base = get_system_prompt(domain)

    # Choose a CoT style based on complexity (scale effort).
    lvl = (complexity or "").lower()
    if lvl in ("hard", "extremely hard"):
        cot_style = "Be deliberate and thorough in your reasoning."
    elif lvl == "easy":
        cot_style = "Use brief step-by-step reasoning and avoid unnecessary detail."
    else:
        cot_style = "Use concise step-by-step reasoning."

    # Domain-specific CoT prompts.
    if domain == "math": 
        task = (
            "Solve the math problem step by step. Show intermediate computations and reasoning, "
            "then clearly state the final numeric answer or expression on its own line at the end. "
            "You may trust results from tools (for example, combinatorics or digit-sum helpers) "
            "instead of recomputing everything in your head."
        )
    elif domain == "coding": 
        task = (
            "Reason about the requirements and edge cases, but when you produce your final answer, "
            "output only a self-contained code solution without extra explanation or markdown."
        )
    elif domain == "planning": 
        task = ("Think through the preconditions and effects to construct a valid sequence of actions that achieves the goal, then list the final actions in the notation used in the examples.")
    elif domain == "future_prediction": 
        task = ("Briefly justify your prediction using available knowledge, then clearly state the final predicted numeric value or list.")
    elif domain == "common_sense": 
        task = ("Use everyday knowledge and logic to reason about the question, then state the best answer in a single short sentence.")
    else: 
        task = ("Reason through the question in a few clear steps, then provide a single concise final answer.")

    return f"{base} {cot_style} {task}"

# System prompt for ReAct agent.
def get_react_system_prompt() -> str:
    return (
        "You are a reasoning agent that can think step by step and use tools.\n"
        "You may interleave natural language thoughts with tool calls.\n"
        "When you want to use a tool, write a line of the form:\n"
        "Action: <TOOL_NAME>[ARGUMENT]\n"
        "For example: 'Action: <math>[2*(3+4)]' or 'Action: <python>[def f(x): return x+1]'.\n"
        "After you receive an observation from the tool (it will be shown as a line starting with '[Observation]:'), continue reasoning.\n"
        "When you are ready to answer, write a line starting with 'Final Answer:'.\n\n"
        "Available tools:\n"
        "- math: evaluate arithmetic or use functions from Python's math module.\n"
        "- python: check whether a short Python snippet compiles; returns 'OK' or an error.\n"
        "- wiki_search: search the structured OSRS Wiki dataset and return grounded article, fact, and graph context.\n"
        "- graph_expand: expand one OSRS wiki page title to important graph neighbors and semantic relations.\n"
        "- losthq_search: search LostHQ 2004 NPC + item databases together (good for exists-in-this-version checks).\n"
        "- losthq_npc: look up one NPC by name or internal debugname; includes options and truncated drops when available.\n"
        "- losthq_item: look up one item by name, numeric id, or debugname.\n"
        "- reflect: ask you to think more carefully or check your answer for consistency.\n"
    )

# Get answer extraction prompt with additional exampled depending on domain.
def get_extract_prompt(domain: str = None) -> str:
    prompt = EXTRACT_SYSTEM_PROMPT
    examples = EXTRACT_EXAMPLES.get(domain or "", [])
    if not examples:
        return prompt

    lines = [prompt, "Here are some examples of problems and their ideal final answer strings:"]
    for i, ex in enumerate(examples, 1):
        lines.append(f"\nExample {i}:")
        lines.append("Problem:")
        lines.append(ex["input"])
        lines.append("Ideal final answer string:")
        lines.append(ex["answer"])
    return "\n".join(lines)
