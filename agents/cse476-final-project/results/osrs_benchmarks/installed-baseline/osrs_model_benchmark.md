# OSRS Graph RAG Model Benchmark

Generated: 2026-05-02T21:01:40

| Model | Runs | Avg generation s | Avg total s | Avg score | Avoid hits |
|---|---:|---:|---:|---:|---:|
| `gemma3:4b` | 3 | 6.29 | 6.70 | 5.00 | 0 |
| `llama3.2:3b-instruct-q8_0` | 3 | 6.04 | 6.45 | 5.67 | 0 |
| `deepseek-r1:7b` | 3 | 5.52 | 5.92 | 6.00 | 0 |
| `deepseek-coder:6.7b` | 3 | 5.84 | 6.24 | 6.00 | 0 |

## Per-Run Results

### gemma3:4b / domain_model_recipe
- Generation seconds: 6.454
- Score: 7 (7/8 expected hits, 0 avoid hits)

```text
```json
{
  "entities": [
    {
      "name": "perfect ring",
      "type": "item",
      "description": "A quest item made with a perfect gold bar, ruby, and ring mould at a furnace, requiring 40 Crafting and yielding 70 Crafting experience.",
      "wiki_url": "https://oldschool.runescape.wiki/w/'perfect'_ring"
    },
    {
      "name": "Crafting",
      "type": "skill",
      "level_required": 40,
      "xp_reward": 70,
      "wiki_url": "https://oldschool.runescape.wiki/w/Crafting"
    },
    {
      "name": "Anvil",
      "type": "facility",
      "wiki_url": "https://oldschool.runescape.wiki/w/Anvil"
    },
    {
      "name": "Ruby",
      "type": "material",
      "wiki_url": "https://oldschool.runescape.wiki/w/Ruby"
    },
    {
      "name": "Family Crest",
      "type": "quest",
      "wiki_url": "https://oldschool.runescape.wiki/w/Family_Crest"
    }
  ],
  "actions": [
    {
      "name": "craft ring",
      "description": "Craft a perfect ring.",
      "preconditions": [
        {
          "entity": "Crafting",
          "skill_level": 40
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
          "entity": "Ruby",
 
```

### gemma3:4b / planning_feedback_recipe
- Generation seconds: 3.504
- Score: 3 (3/6 expected hits, 0 avoid hits)

```text
Here’s an analysis of the situation and the best action for the bot, based on the provided context:

**Entities:**

*   Bot
*   Ruby
*   ‘Perfect’ Gold Bar
*   Ring Mould
*   Anvil

**Action:** Craft a ‘Perfect’ Ring

**Preconditions:**

*   Smithing level 40 (Confirmed via ‘perfect’ gold bar recipe)
*   ‘Perfect’ Gold Bar (Present)
*   Ring Mould (Present)
*   Anvil (Nearby – assumed to be accessible)

**Effects/Rewards:**

*   Creation of a ‘Perfect’ Ring (Confirmed via ‘perfect’ gold bar recipe)
*   Smithing XP (22.5)

**Resources/Locations:**

*   Furnace (Required facility for the recipe)

**Uncertainty:**

*   None. All requirements are explicitly stated in the ‘perfect’ gold bar recipe.

**Supporting Facts:**

*   The ‘perfect’ gold bar recipe (https://oldschool.runescape.wiki/w/'perfect'_gold_bar) requires Smithing level 40 to produce a ‘perfect’ ring.
*   The ‘perfect’ gold bar can be created at a Furnace.
*   The bot has a ‘perfect’ gold bar, a ring mould, and a Smithing level 40.

**Recommendation:** The bot should initiate the ‘perfect’ gold bar recipe at the Furnace, using the ‘perfect’ gold bar and the ring mould. (https://oldschool.runescape.wiki/w/'perfect'_gold_bar
```

### gemma3:4b / npc_variant_banking
- Generation seconds: 8.918
- Score: 5 (5/6 expected hits, 0 avoid hits)

```text
Here's a domain model for ‘Birds-Eye’ Jack and his banking interaction, based on the provided context:

**Entities:**

*   Birds-Eye Jack (NPC) -  A pirate banker located on Lunar Isle. (URL: https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)
*   Lunar Isle (Location) - Where Jack is located. (URL: https://oldschool.runescape.wiki/w/Lunar_Isle)

**Actions:**

*   Talk-to (Birds-Eye Jack) - Initiates dialogue with the NPC.
*   Bank (Birds-Eye Jack) - Allows the player to deposit and withdraw items at his bank.
*   Collect (Birds-Eye Jack) -  (Implied action related to the ‘Collect’ action available on the NPC)

**Preconditions:**

*   Player must be near Birds-Eye Jack on Lunar Isle. (Supported by: ‘Birds-Eye’ Jack --lead_link, weight=4--> Lunar Isle)
*   Player must be in the Dream Mentor quest. (Supported by: ‘Birds-Eye’ Jack --infobox_link, field=quest, weight=5--> Dream Mentor)
*   Player must be in the Lunar Diplomacy quest. (Supported by: ‘Birds-Eye’ Jack --lead_link, weight=4--> Lunar Diplomacy)

**Effects/Rewards:**

*   None directly stated in the provided context. (However, banking actions will have standard OSRS banking effects – deposit/withdraw items).

**Resources/Lo
```

### llama3.2:3b-instruct-q8_0 / domain_model_recipe
- Generation seconds: 7.04
- Score: 7 (7/8 expected hits, 0 avoid hits)

```text
```json
{
  "entities": [
    {
      "name": "perfect ring",
      "type": "item",
      "description": "A quest item made with a perfect gold bar, ruby, and ring mould at a furnace, requiring 40 Crafting and yielding 70 Crafting experience.",
      "wiki_url": "https://oldschool.runescape.wiki/w/'perfect'_ring"
    },
    {
      "name": "Crafting",
      "type": "skill",
      "level_required": 40,
      "xp_reward": 70,
      "wiki_url": "https://oldschool.runescape.wiki/w/Crafting"
    },
    {
      "name": "Anvil",
      "type": "facility",
      "wiki_url": "https://oldschool.runescape.wiki/w/Anvil"
    },
    {
      "name": "Ruby",
      "type": "material",
      "wiki_url": "https://oldschool.runescape.wiki/w/Ruby"
    },
    {
      "name": "Family Crest",
      "type": "quest",
      "wiki_url": "https://oldschool.runescape.wiki/w/Family_Crest"
    }
  ],
  "actions": [
    {
      "name": "craft ring",
      "description": "Craft a perfect ring.",
      "preconditions": [
        {
          "entity": "Crafting",
          "skill_level": 40
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
          "entity": "Ruby",
 
```

### llama3.2:3b-instruct-q8_0 / planning_feedback_recipe
- Generation seconds: 4.528
- Score: 4 (4/6 expected hits, 0 avoid hits)

```text
Here’s an analysis of the situation and the best action for the bot, based on the provided context:

**Entities:**

*   Bot
*   Ruby
*   ‘Perfect’ Gold Bar
*   Ring Mould
*   Anvil

**Action:** Craft a ‘Perfect’ Ring

**Preconditions:**

*   Smithing level 40 (Confirmed via ‘perfect’ gold bar recipe)
*   ‘Perfect’ Gold Bar (Present)
*   Ring Mould (Present)
*   Anvil (Nearby - assumed to be accessible)

**Effects/Rewards:**

*   Creation of a ‘Perfect’ Ring (Confirmed via ‘perfect’ gold bar recipe)
*   Smithing XP (22.5)

**Resources/Locations:**

*   Furnace (Required facility for the recipe)

**Uncertainty:**

*   None

**Justification & Supporting Facts:**

The primary source of information is the `facts.recipes` entry for the ‘perfect’ gold bar. This explicitly states:

*   **Recipe 1:** skills=[Smithing level 40 xp 22.5]; tools=[none]; facilities=[Furnace]; materials=[1 x 'perfect' gold ore]; outputs=[1 x 'perfect' gold bar]; ticks=4.

This recipe requires a Smithing level of 40 and the use of a Furnace to create a ‘perfect’ gold bar. The bot possesses a ‘perfect’ gold bar and a ring mould, and has a Smithing level of 40. Therefore, the bot should use the ‘perfect’ gold bar an
```

### llama3.2:3b-instruct-q8_0 / npc_variant_banking
- Generation seconds: 6.553
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a domain model for 'Birds-Eye' Jack and his banking interaction, based on the provided context:

**Entities:**

*   **Birds-Eye Jack:** (NPC) – A pirate banker located on Lunar Isle. (URL: https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)
    *   **Variants:** Pirate (24 July 2006), Banker (15 May 2007)
    *   **Location:** Pirates’ Cove (Pirate variant), Lunar Isle bank (Banker variant)
    *   **Actions:** Talk-to, Bank, Collect
*   **Lunar Isle:** (Location) – An island where Jack operates as a banker. (URL: https://oldschool.runescape.wiki/w/Lunar_Isle)
*   **Lunar Diplomacy:** (Quest) – A quest involving Jack’s misaccusation. (URL: https://oldschool.runescape.wiki/w/Lunar_Diplomacy)
*   **Dream Mentor:** (Quest) – A quest where Jack is the banker. (URL: https://oldschool.runescape.wiki/w/Dream_Mentor)

**Actions & Preconditions:**

*   **Talk-to (Birds-Eye Jack):**
    *   Preconditions: None. (URL: https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)
    *   Effects: Dialogue with Jack.
*   **Bank (Birds-Eye Jack):**
    *   Preconditions: None. (URL: https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)
    *   Effects: Ability to deposit and withdraw items from Ja
```

### deepseek-r1:7b / domain_model_recipe
- Generation seconds: 6.505
- Score: 7 (7/8 expected hits, 0 avoid hits)

```text
```json
{
  "entities": [
    {
      "name": "perfect ring",
      "type": "item",
      "description": "A quest item made with a perfect gold bar, ruby, and ring mould at a furnace, requiring 40 Crafting and yielding 70 Crafting experience.",
      "wiki_url": "https://oldschool.runescape.wiki/w/'perfect'_ring"
    },
    {
      "name": "Crafting",
      "type": "skill",
      "level_required": 40,
      "xp_reward": 70,
      "wiki_url": "https://oldschool.runescape.wiki/w/Crafting"
    },
    {
      "name": "Anvil",
      "type": "facility",
      "wiki_url": "https://oldschool.runescape.wiki/w/Anvil"
    },
    {
      "name": "Ruby",
      "type": "material",
      "wiki_url": "https://oldschool.runescape.wiki/w/Ruby"
    },
    {
      "name": "Family Crest",
      "type": "quest",
      "wiki_url": "https://oldschool.runescape.wiki/w/Family_Crest"
    }
  ],
  "actions": [
    {
      "name": "craft ring",
      "description": "Craft a perfect ring.",
      "preconditions": [
        {
          "entity": "Crafting",
          "skill_level": 40
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
          "entity": "Ruby",
 
```

### deepseek-r1:7b / planning_feedback_recipe
- Generation seconds: 5.397
- Score: 5 (5/6 expected hits, 0 avoid hits)

```text
Here's an analysis of the situation and the bot’s next action, based on the provided context:

**Entities:**

*   Bot
*   Ruby
*   ‘Perfect’ Gold Bar
*   Ring Mould
*   Anvil

**Action:**

The bot should attempt to craft a ‘perfect’ ring.

**Preconditions:**

*   Smithing skill level 40 (as confirmed by the ‘perfect’ gold bar recipe).
*   Possession of a ‘perfect’ gold bar.
*   Possession of a ring mould.
*   Proximity to an anvil (implied by the need to use it for crafting).

**Effects/Rewards:**

*   Creation of a ‘perfect’ ring. (This is implied by the ‘perfect’ gold bar recipe and the ring mould).

**Resources/Locations:**

*   Furnace (required for smelting ‘perfect’ gold ore into a ‘perfect’ gold bar – though the bot already has one).
*   Anvil (required for crafting).

**Uncertainty:**

*   None. The context provides a clear recipe for crafting a ‘perfect’ ring using a ‘perfect’ gold bar and a ring mould.

**Supporting Facts:**

*   `facts.recipes`:
    ```json
    [{"skills": [{"name": "Smithing", "level": 40, "xp": 22.5, "boostable": true}], "tools": [], "facilities": ["Furnace"], "materials": [{"item": "'perfect' gold bar", "cost": "No"}], "outputs": [{"item": "'perfect' 
```

### deepseek-r1:7b / npc_variant_banking
- Generation seconds: 4.654
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a domain model for 'Birds-Eye' Jack and his banking interaction, based on the provided context:

**Entities:**

*   **Birds-Eye Jack** (NPC) - A pirate banker located on Lunar Isle.
    *   **Variants:** Pirate (2006), Banker (2007)
    *   **Location:** Pirates’ Cove (Pirate variant), Lunar Isle Bank (Banker variant)
    *   **Quest Associations:** Lunar Diplomacy, Dream Mentor
*   **Lunar Isle** (Location) - An island where Jack operates as a banker.

**Actions:**

*   **Talk-to:** Interact with Jack to initiate dialogue.
*   **Bank:** Deposit or withdraw items from Jack’s bank.
*   **Collect:** (Primarily associated with the Pirate variant) Collect items from Jack.

**Preconditions:**

*   The player must be near 'Birds-Eye' Jack. (Supported by multiple lead links and map entries)
*   The player must be in the correct variant of Jack’s location (Pirates’ Cove or Lunar Isle Bank).

**Effects/Rewards:**

*   None directly stated. Banking actions would likely involve item storage and potential XP gains (though this isn’t explicitly documented).

**Resources/Locations:**

*   **Pirates’ Cove:** Location of the Pirate variant of Jack.
*   **Lunar Isle Bank:** Location of the B
```

### deepseek-coder:6.7b / domain_model_recipe
- Generation seconds: 7.214
- Score: 8 (8/8 expected hits, 0 avoid hits)

```text
```json
{
  "entities": [
    {
      "name": "perfect ring",
      "type": "item",
      "description": "A quest item made with a perfect gold bar, ruby, and ring mould at a furnace, requiring 40 Crafting and yielding 70 Crafting experience.",
      "wiki_url": "https://oldschool.runescape.wiki/w/'perfect'_ring"
    },
    {
      "name": "Crafting",
      "type": "skill",
      "level_required": 40,
      "xp_reward": 70,
      "wiki_url": "https://oldschool.runescape.wiki/w/Crafting"
    },
    {
      "name": "Anvil",
      "type": "facility",
      "wiki_url": "https://oldschool.runescape.wiki/w/Anvil"
    },
    {
      "name": "Ruby",
      "type": "material",
      "wiki_url": "https://oldschool.runescape.wiki/w/Ruby"
    },
    {
      "name": "Family Crest",
      "type": "quest",
      "wiki_url": "https://oldschool.runescape.wiki/w/Family_Crest"
    }
  ],
  "actions": [
    {
      "name": "craft perfect ring",
      "description": "Craft a perfect ring using the specified materials and tools.",
      "requirements": [
        {
          "skill": "Crafting",
          "level": 40,
          "xp": 70
        },
        {
          "tool": "Ring mould"
        },
      
```

### deepseek-coder:6.7b / planning_feedback_recipe
- Generation seconds: 4.295
- Score: 4 (4/6 expected hits, 0 avoid hits)

```text
Here’s an analysis of the situation and the bot’s next action, based on the provided context:

**Entities:**

*   Bot
*   Ruby
*   ‘Perfect’ Gold Bar
*   Ring Mould
*   Anvil

**Action:**

The bot should attempt to craft a ‘perfect’ ring.

**Preconditions:**

*   Smithing skill level 40 (as confirmed by the ‘perfect’ gold bar recipe).
*   Possession of a ‘perfect’ gold bar.
*   Possession of a ring mould.
*   Proximity to an anvil (implied by the crafting action).

**Effects/Rewards:**

*   Creation of a ‘perfect’ ring. (Details of the ring’s stats are not provided in this context).

**Resources/Locations:**

*   Anvil (required for crafting)

**Uncertainty:**

*   The exact stats of the ‘perfect’ ring are not defined in this context.

**Supporting Facts:**

*   `facts.recipes`: The ‘perfect’ gold bar recipe explicitly states that it can be used to craft a ‘perfect’ ring when using a ring mould. (URL: https://oldschool.runescape.wiki/w/'perfect'_gold_bar)
*   `facts.equipment`: The bot needs a ring mould to craft the ‘perfect’ ring. (URL: https://oldschool.runescape.wiki/w/'perfect'_gold_bar)
*   `facts.actions`: The bot can craft a ‘perfect’ ring using the ‘perfect’ gold bar and a
```

### deepseek-coder:6.7b / npc_variant_banking
- Generation seconds: 6.026
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a domain model for 'Birds-Eye' Jack and his banking interaction, based on the provided context:

**Entities:**

*   **Birds-Eye Jack** (NPC) - A pirate banker located on Lunar Isle. (URL: https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)
*   **Lunar Isle** (Location) - Where Jack is located. (URL: https://oldschool.runescape.wiki/w/Lunar_Isle)
*   **Human** (Race) - Jack's race. (URL: https://oldschool.runescape.wiki/w/Human)

**Actions:**

*   **Talk-to:** Interact with Jack to initiate dialogue.
*   **Bank:** Deposit or withdraw items from Jack’s bank.

**Preconditions:**

*   The player must be located on Lunar Isle. (Supported by: 'Birds-Eye' Jack --lead_link, weight=4--> Lunar Isle)
*   The player must be able to interact with NPCs. (Implied by the available actions)

**Effects:**

*   **Dialogue:** Jack provides information related to Lunar Diplomacy and Dream Mentor quests. (Supported by: 'Birds-Eye' Jack --lead_link, weight=4--> Lunar Diplomacy, 'Birds-Eye' Jack --lead_link, weight=4--> Dream Mentor)
*   **Banking:** The player can deposit and withdraw items at Jack’s bank. (Supported by: 'Birds-Eye' Jack --Actions: Talk-to, Bank, Collect)

**Resources/Locations:*
```
