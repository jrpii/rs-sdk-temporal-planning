# OSRS Graph RAG Model Benchmark

Generated: 2026-05-02T21:07:06

| Model | Runs | Avg generation s | Avg total s | Avg score | Avoid hits |
|---|---:|---:|---:|---:|---:|
| `gemma3:12b` | 3 | 5.17 | 5.56 | 5.67 | 0 |
| `gemma3:4b` | 3 | 5.49 | 5.89 | 6.00 | 0 |
| `deepseek-r1:7b` | 3 | 5.17 | 5.59 | 6.00 | 0 |
| `deepseek-coder:6.7b` | 3 | 5.57 | 5.97 | 5.33 | 0 |

## Per-Run Results

### gemma3:12b / domain_model_recipe
- Generation seconds: 6.606
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

### gemma3:12b / planning_feedback_recipe
- Generation seconds: 4.236
- Score: 4 (4/6 expected hits, 0 avoid hits)

```text
Here’s an analysis of the bot’s situation and the best action to take, based on the provided context:

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

*   None

**Justification & Supporting Facts:**

The most direct and effective action is to craft a ‘Perfect’ Ring. This is explicitly stated in the ‘perfect’ gold bar’s recipe:

*   `facts.recipes` shows the recipe: skills=[Smithing level 40 xp 22.5]; tools=[none]; facilities=[Furnace]; materials=[1 x 'perfect' gold ore]; outputs=[1 x 'perfect' gold bar]; ticks=4.
*   The ‘perfect’ gold bar recipe requires Smithing level 40. The bot meets this precondition.
*   The bot has a ‘perfect’ gold bar, which is a required material.
*   The bot has a ring mould, which is a requir
```

### gemma3:12b / npc_variant_banking
- Generation seconds: 4.668
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here’s a domain model for ‘Birds-Eye’ Jack and his banking interaction, based on the provided context.

**Entities:**

*   Birds-Eye Jack (NPC) - A pirate banker located on Lunar Isle.
*   Lunar Isle (Location) - The island where Jack is located.

**Actions:**

*   Talk-to (Birds-Eye Jack) - Initiates dialogue with the NPC.
*   Bank (Birds-Eye Jack) - Allows the player to deposit and withdraw items.
*   Collect (Birds-Eye Jack) - Used during Dream Mentor quest.

**Preconditions:**

*   The player must be near ‘Birds-Eye’ Jack. (Supported by multiple lead links and map entries)
*   The player must be in the ‘Dream Mentor’ quest. (Supported by lead links and infobox links)
*   The player must be in the ‘Lunar Diplomacy’ quest. (Supported by lead links and infobox links)

**Effects/Rewards:**

*   None directly from the banking action itself (as defined in the context).
*   Quest progression through interaction with Jack.

**Resources/Locations:**

*   Lunar Isle - The location of the bank.
*   Pirates’ Cove - Location of the ‘Pirate’ variant of Jack.
*   Lunar Isle bank - Location of the ‘Banker’ variant of Jack.

**Uncertainty:**

*   The exact distance the player can talk to Jack f
```

### gemma3:4b / domain_model_recipe
- Generation seconds: 6.578
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
- Generation seconds: 3.887
- Score: 5 (5/6 expected hits, 0 avoid hits)

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
*   Anvil (Nearby - implied location for crafting)

**Effects/Rewards:**

*   Creation of a ‘Perfect’ Ring (Confirmed via ‘perfect’ gold bar recipe)
*   Smithing XP (22.5)

**Resources/Locations:**

*   Furnace (Required facility for the recipe)

**Uncertainty:**

*   None

**Justification & Supporting Facts:**

The most direct and effective action is to craft a ‘Perfect’ Ring. This is explicitly stated in the ‘perfect’ gold bar’s recipe:

*   `facts.recipes` shows the recipe: skills=[Smithing level 40 xp 22.5]; tools=[none]; facilities=[Furnace]; materials=[1 x 'perfect' gold ore]; outputs=[1 x 'perfect' gold bar]; ticks=4.
*   The ‘perfect’ gold bar recipe requires a ring mould as a tool.
*   The bot has a ‘perfect’ gold bar, a ring mould, and a Smithing level 40.

**Source:**

*   `facts.recipes` for the ‘perfect’ gold bar re
```

### gemma3:4b / npc_variant_banking
- Generation seconds: 6.009
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a domain model for 'Birds-Eye' Jack and his banking interaction, based on the provided context:

**Entities:**

*   **Birds-Eye Jack** (NPC) - A pirate banker located on Lunar Isle.
    *   **Variants:** Pirate (2006), Banker (2007)
    *   **Location:** Pirates’ Cove (Pirate variant), Lunar Isle Bank (Banker variant)
    *   **Quest Associations:** Lunar Diplomacy, Dream Mentor
*   **Lunar Isle** (Location) - An island where Jack operates as a banker.
*   **Human** (Race) - Jack’s race.

**Actions:**

*   **Talk-to:** Interact with Jack to initiate dialogue.
*   **Bank:** Deposit or withdraw items from Jack’s bank.
*   **Collect:** (Primarily associated with the Pirate variant) Collect items from Jack.

**Preconditions:**

*   The player must be near ‘Birds-Eye’ Jack. (Supported by multiple lead links and map entries)
*   The player must be in the correct variant of Jack’s location (Pirates’ Cove or Lunar Isle Bank).
*   The player must be in the ‘Dream Mentor’ quest. (Required for the Banker variant)

**Effects/Rewards:**

*   None directly stated. Banking actions will likely involve item storage and potentially XP gains (unspecified).

**Resources/Locations:**

*   **Pira
```

### deepseek-r1:7b / domain_model_recipe
- Generation seconds: 6.205
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
      "name": "craft ring",
      "description": "Craft a perfect ring.",
      "preconditions": [
        {
          "entity": "Crafting",
          "skill_level": 40,
          "xp": 70
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
         
```

### deepseek-r1:7b / planning_feedback_recipe
- Generation seconds: 4.532
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
*   `facts.equipment`: The bot needs a ring mould to perform this action. (URL: https://oldschool.runescape.wiki/w/'perfect'_gold_bar)
*   `facts.actions`: The bot can craft a ‘perfect’ ring. (URL: https://oldschool.runescape.wiki
```

### deepseek-r1:7b / npc_variant_banking
- Generation seconds: 4.784
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here’s a domain model for ‘Birds-Eye’ Jack and his banking interaction, based on the provided context.

**Entities:**

*   Birds-Eye Jack (NPC) - A pirate banker located on Lunar Isle.
*   Lunar Isle (Location) - The island where Jack is located.

**Actions:**

*   Talk-to (Birds-Eye Jack) - Initiates a dialogue with the NPC.
*   Bank (Birds-Eye Jack) - Allows the player to deposit and withdraw items at his bank.
*   Collect (Birds-Eye Jack) - Used during the Dream Mentor quest.

**Preconditions:**

*   The player must be near ‘Birds-Eye’ Jack. (Supported by multiple lead links and infobox links)
*   The player must be in the ‘Dream Mentor’ quest. (Supported by infobox links)
*   The player must be in the ‘Lunar Diplomacy’ quest. (Supported by infobox links)

**Effects/Rewards:**

*   None directly from the banking action itself (as defined in the context).
*   Quest progression through interaction with Jack.

**Resources/Locations:**

*   Lunar Isle - The location of Jack’s bank.
*   Pirates’ Cove - Location of the ‘Pirate’ variant of Jack.
*   Lunar Isle Bank - Specific location of Jack’s bank.

**Uncertainty:**

*   The exact XP rewards for banking are not specified. (Only quest
```

### deepseek-coder:6.7b / domain_model_recipe
- Generation seconds: 6.646
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

### deepseek-coder:6.7b / planning_feedback_recipe
- Generation seconds: 3.303
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
*   Anvil (Nearby - assumed to be accessible)

**Effects/Rewards:**

*   Creation of a ‘Perfect’ Ring (Confirmed via ‘perfect’ gold bar recipe)
*   Smithing XP (22.5)

**Resources/Locations:**

*   Furnace (Required facility for the recipe)

**Uncertainty:**

*   None. All requirements are explicitly stated in the ‘perfect’ gold bar recipe.

**Supporting Facts:**

*   The ‘perfect’ gold bar recipe (https://oldschool.runescape.wiki/w/'perfect'_gold_bar) requires Smithing level 40 to produce a ‘perfect’ ring.
*   The recipe uses a ring mould as a tool.
*   The recipe is performed at a furnace.

**Recommendation:** The bot should attempt to craft a ‘perfect’ ring using the ‘perfect’ gold bar, the ring mould, and the furnace. This is the only action supported by the available facts.
```

### deepseek-coder:6.7b / npc_variant_banking
- Generation seconds: 6.764
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a domain model for 'Birds-Eye' Jack and his banking interaction, based on the provided context:

**Entities:**

*   **Birds-Eye Jack:** (NPC) - A pirate banker located on Lunar Isle. (URL: https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)
    *   **Variants:**
        *   Pirate (Released 24 July 2006, Lunar Diplomacy quest) - Located in Pirates' Cove.
        *   Banker (Released 15 May 2007, Dream Mentor quest) - Located at the Lunar Isle bank.
*   **Lunar Isle:** (Location) - An island where Jack is located. (URL: https://oldschool.runescape.wiki/w/Lunar_Isle)
*   **Dream Mentor:** (Quest) - The quest that leads to interacting with Jack as a banker. (URL: https://oldschool.runescape.wiki/w/Dream_Mentor)
*   **Lunar Diplomacy:** (Quest) - The quest that initially involves Jack. (URL: https://oldschool.runescape.wiki/w/Lunar_Diplomacy)

**Actions:**

*   **Talk-to:** Interact with Jack to initiate dialogue.
*   **Bank:** Deposit or withdraw items at Jack’s bank.
*   **Collect:** (Implied - likely related to collecting items for the Dream Mentor quest)

**Preconditions:**

*   The player must be in the ‘Dream Mentor’ quest. (Traversed Edge: 'Birds-Eye' Jack --infobox_link
```
