# OSRS Graph RAG Model Benchmark

Generated: 2026-05-02T21:17:32

| Model | Runs | Avg generation s | Avg total s | Avg score | Avoid hits |
|---|---:|---:|---:|---:|---:|
| `gpt-oss:20b` | 3 | 5.80 | 6.33 | 6.00 | 0 |
| `gemma3:12b` | 3 | 4.96 | 5.49 | 6.00 | 0 |
| `deepseek-r1:7b` | 3 | 5.98 | 6.51 | 5.67 | 0 |
| `gemma3:4b` | 3 | 5.52 | 6.05 | 6.33 | 0 |

## Per-Run Results

### gpt-oss:20b / domain_model_recipe
- Generation seconds: 6.489
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
          "level": 40
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
          "entity": "Ruby",
       
```

### gpt-oss:20b / planning_feedback_recipe
- Generation seconds: 5.216
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here’s an analysis of the bot’s next action, based on the provided context, structured as requested:

**Entities:**

*   Bot
*   Ruby
*   'Perfect' Gold Bar
*   Ring Mould
*   Anvil

**Actions:**

*   Craft a 'Perfect' Ring

**Preconditions:**

*   Bot has a Ruby. (Evidence: `facts.recipes.‘perfect’ ring` materials: `1 x ‘perfect’ gold bar, 1 x Ruby`)
*   Bot has a 'Perfect' Gold Bar. (Evidence: `facts.recipes.‘perfect’ ring` materials: `1 x ‘perfect’ gold bar, 1 x Ruby`)
*   Bot has a Ring Mould. (Evidence: `facts.recipes.‘perfect’ ring` tools: `Ring mould`)
*   Bot is near an Anvil. (Evidence: `facts.recipes.‘perfect’ ring` facilities: `Anvil`)
*   Bot’s Crafting level is 40. (Evidence: `facts.recipes.‘perfect’ ring` skills: `Crafting level 40`)

**Effects/Rewards:**

*   Bot gains 70 Crafting experience. (Evidence: `facts.recipes.‘perfect’ ring` skills: `Crafting level 40 xp 70`)
*   Bot creates a 'Perfect' Ring. (Evidence: `facts.recipes.‘perfect’ ring` outputs: `1 x ‘perfect’ ring`)

**Resources/Locations:**

*   Anvil (Facility)
*   Workshop (Implied - where the Anvil is located)

**Uncertainty:**

*   None. All preconditions and effects are directly supported by the provided
```

### gpt-oss:20b / npc_variant_banking
- Generation seconds: 5.685
- Score: 5 (5/6 expected hits, 0 avoid hits)

```text
Here’s a domain model for ‘Birds-Eye’ Jack and his banking interaction, based on the provided context.

**Entities:**

*   Birds-Eye Jack (NPC) - A pirate banker located on Lunar Isle.
*   Lunar Isle (Location) - The island where Jack is located.

**Actions:**

*   Talk-to (Birds-Eye Jack) - Initiates dialogue with the NPC.
*   Bank (Birds-Eye Jack) - Allows the player to deposit and withdraw items.
*   Collect (Birds-Eye Jack) - Used during the Dream Mentor quest.

**Preconditions:**

*   Quest: Dream Mentor must be active. (Supported by: ‘Birds-Eye’ Jack --infobox_link, field=quest, weight=5--> Dream Mentor, Traversed Edge)
*   Quest: Lunar Diplomacy must be active. (Supported by: ‘Birds-Eye’ Jack --lead_link, weight=4--> Lunar Diplomacy, Traversed Edge)
*   Location: The player must be on Lunar Isle. (Supported by: ‘Birds-Eye’ Jack --infobox_link, field=location, weight=5--> Lunar Isle, Traversed Edge)

**Effects/Rewards:**

*   None directly from the banking action itself. (Hard Planning Facts From Best Direct Match)
*   Cyrisus’ items are retrieved (Effect of Dream Mentor quest). (Supported by: ‘Birds-Eye’ Jack --lead_link, weight=4--> Dream Mentor, Traversed Edge)

**Resource
```

### gemma3:12b / domain_model_recipe
- Generation seconds: 6.688
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
          "level": 40
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
          "entity": "Ruby",
       
```

### gemma3:12b / planning_feedback_recipe
- Generation seconds: 3.779
- Score: 5 (5/6 expected hits, 0 avoid hits)

```text
Here's a breakdown of the optimal action for the bot, supported by the retrieved facts, structured for an RS-SDK bot:

**Answer:**

*   **Action:** Craft a ‘perfect’ ring.
*   **Entities:** Ruby, ‘perfect’ gold bar, ring mould, anvil.
*   **Actions:** Crafting
*   **Preconditions:**
    *   Crafting level 40 (xp 70)
    *   Anvil is nearby.
    *   Possession of a ‘perfect’ gold bar, a Ruby, and a ring mould.
*   **Effects/Rewards:**
    *   Creation of a ‘perfect’ ring (1x ‘perfect’ ring, 70 Crafting XP).
*   **Resources/Locations:** Anvil (required facility), likely Varrock (due to Family Crest quest association).
*   **Uncertainty:** None. The recipe is explicitly defined.
*   **Supporting Facts:**
    *   `facts.recipes`:  The authoritative recipe for crafting a ‘perfect’ ring is provided, detailing the required skills, tools, materials, ticks, and output. (URL: https://oldschool.runescape.wiki/'perfect'_ring)
    *   `facts.equipment`: The bot’s equipment is irrelevant to this crafting action.
    *   `facts.actions`: The bot can “Wear” and “Drop” items.
    *   `facts.variants`: No relevant variants.

**Summary:** The bot should initiate the ‘perfect’ ring crafting recipe usi
```

### gemma3:12b / npc_variant_banking
- Generation seconds: 4.424
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

*   The player must be able to Talk-to ‘Birds-Eye’ Jack. (Supported by: ‘Birds-Eye’ Jack, Actions)
*   The player must be able to Bank with ‘Birds-Eye’ Jack. (Supported by: ‘Birds-Eye’ Jack, Actions)
*   The player must be at Lunar Isle to interact with ‘Birds-Eye’ Jack. (Supported by: ‘Birds-Eye’ Jack, Lead link to Lunar Isle)

**Effects/Rewards:**

*   None directly stated in the provided context. (However, banking is a core game mechanic)

**Resources/Locations:**

*   Lunar Isle - The location of ‘Birds-Eye’ Jack’s bank.
*   ‘Birds-Eye’ Jack’s Bank (on Lunar Isle) - The specific location for banking actions.

**Uncertainty:**

*   The exact XP rewards for banking with ‘Birds-Eye’ Jack are not specifi
```

### deepseek-r1:7b / domain_model_recipe
- Generation seconds: 6.605
- Score: 5 (5/8 expected hits, 0 avoid hits)

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
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a breakdown of the optimal action for the bot, supported by the retrieved facts, structured for an RS-SDK bot:

**Answer:**

*   **Action:** Craft a 'perfect' ring.
*   **Entities:** Ruby, 'perfect' gold bar, ring mould, anvil.
*   **Actions:** Crafting
*   **Preconditions:**
    *   Crafting level 40 (xp 70)
    *   Anvil is nearby.
    *   Possession of a 'perfect' gold bar, a Ruby, and a ring mould.
*   **Effects/Rewards:**
    *   Creation of a 'perfect' ring (1 x 'perfect' ring, 70 Crafting XP)
*   **Resources/Locations:** Anvil (required facility), likely Varrock (due to Family Crest quest association).
*   **Uncertainty:** None. The recipe is explicitly defined.
*   **Supporting Facts:**
    *   `facts.recipes`:  The authoritative recipe for crafting a 'perfect' ring is provided, detailing the required skill level, tools, materials, ticks, and output. (URL: https://oldschool.runescape.wiki/'perfect'_ring)
    *   `facts.equipment`: The bot's equipment doesn't impact this recipe.
    *   `facts.actions.Crafting`: The action "Crafting" is the primary action to take.
    *   `facts.items.Ruby`: The Ruby is a required material.
    *   `facts.items.perfect_gold_bar`: The 
```

### deepseek-r1:7b / npc_variant_banking
- Generation seconds: 6.801
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
    *   Preconditions: None
    *   Effects: Dialogue with Jack. (Supported by: 'Birds-Eye' Jack (npc, score=298.71) - Actions: Talk-to)
*   **Bank (Birds-Eye Jack):**
    *   Preconditions: None
    *   Effects: Ability to deposit and withdraw items. (Supported by: 'Birds-Eye' Jack (npc, score=298.71) - 
```

### gemma3:4b / domain_model_recipe
- Generation seconds: 6.733
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
          "level": 40
        },
        {
          "entity": "Anvil",
          "type": "facility"
        },
        {
          "entity": "Ruby",
       
```

### gemma3:4b / planning_feedback_recipe
- Generation seconds: 4.667
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here’s an analysis of the bot’s next action, based on the provided context, structured as requested:

**Entities:**

*   Bot
*   Ruby
*   'Perfect' Gold Bar
*   Ring Mould
*   Anvil

**Actions:**

*   Craft a 'Perfect' Ring

**Preconditions:**

*   Bot has a Ruby. (Evidence: `facts.recipes.‘perfect’ ring` materials: `1 x 'perfect' gold bar, 1 x Ruby`)
*   Bot has a 'Perfect' Gold Bar. (Evidence: `facts.recipes.‘perfect’ ring` materials: `1 x 'perfect' gold bar, 1 x Ruby`)
*   Bot has a Ring Mould. (Evidence: `facts.recipes.‘perfect’ ring` tools: `Ring mould`)
*   Bot is near an Anvil. (Evidence: `facts.recipes.‘perfect’ ring` facilities: `Anvil`)
*   Bot’s Crafting level is 40. (Evidence: `facts.recipes.‘perfect’ ring` skills: `Crafting level 40`)

**Effects/Rewards:**

*   Bot gains 70 Crafting experience. (Evidence: `facts.recipes.‘perfect’ ring` skills: `Crafting level 40 xp 70`)
*   Bot creates a 'Perfect' Ring. (Evidence: `facts.recipes.‘perfect’ ring` outputs: `1 x 'perfect' ring`)

**Resources/Locations:**

*   Anvil (Facility)
*   Family Crest (Quest - linked via lead)

**Uncertainty:**

*   None. All preconditions and effects are directly supported by the provided context.
```

### gemma3:4b / npc_variant_banking
- Generation seconds: 5.174
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
*   The player must be in the Dream Mentor quest. (Required for the Banker variant)

**Effects/Rewards:**

*   None directly stated. Banking actions likely involve item storage and potential XP rewards (though not explicitly detailed).

**Resources/Locations:**

*   **Pirates’ Cove:** Location of
```
