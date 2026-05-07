# OSRS Graph RAG Model Benchmark

Generated: 2026-05-02T21:13:39

| Model | Runs | Avg generation s | Avg total s | Avg score | Avoid hits |
|---|---:|---:|---:|---:|---:|
| `gpt-oss:20b` | 3 | 6.84 | 7.61 | 5.33 | 0 |
| `gemma3:12b` | 3 | 5.15 | 5.91 | 6.00 | 0 |
| `deepseek-r1:7b` | 3 | 5.04 | 5.82 | 6.33 | 0 |

## Per-Run Results

### gpt-oss:20b / domain_model_recipe
- Generation seconds: 10.706
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

### gpt-oss:20b / planning_feedback_recipe
- Generation seconds: 3.502
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
*   The ‘perfect’ gold bar can be created at a furnace.
*   The bot has a ‘perfect’ gold bar and a ring mould.

**Recommendation:** The bot should initiate the ‘perfect’ gold bar recipe at the furnace, using the ring mould as the tool. This will result in the creation of a ‘perfect’ ring. (https://oldschool.runescape.wiki/w/'
```

### gpt-oss:20b / npc_variant_banking
- Generation seconds: 6.317
- Score: 6 (6/6 expected hits, 0 avoid hits)

```text
Here's a domain model for 'Birds-Eye' Jack and his banking interaction, based on the provided context:

**Entities:**

*   **Birds-Eye Jack:** (NPC) - A pirate banker located on Lunar Isle. (Supports: `facts.npcs.birds-eye-jack`)
    *   **Variants:** Pirate (2006), Banker (2007) (Supports: `facts.npcs.birds-eye-jack.variants`)
    *   **Location:** Lunar Isle bank (Supports: `facts.npcs.birds-eye-jack.location`)
*   **Lunar Isle:** (Location) - An island where Jack is located. (Supports: `facts.locations.lunar-isle`)
*   **Dream Mentor:** (Quest) - The quest in which Jack is a banker. (Supports: `facts.quests.dream-mentor`)
*   **Lunar Diplomacy:** (Quest) - The quest in which Jack is a navigator. (Supports: `facts.quests.lunar-diplomacy`)

**Actions:**

*   **Talk-to:** (Action) - Interacting with Jack to initiate dialogue. (Supports: `facts.actions.talk-to`)
*   **Bank:** (Action) - Depositing or withdrawing items from Jack’s bank. (Supports: `facts.actions.bank`)
*   **Collect:** (Action) - Collecting items from Jack. (Supports: `facts.actions.collect`)

**Preconditions:**

*   The player must be near 'Birds-Eye' Jack. (Supports: `facts.npcs.birds-eye-jack.location`)
*   The pl
```

### gemma3:12b / domain_model_recipe
- Generation seconds: 6.332
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
- Generation seconds: 3.863
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

The most direct and effective action is to craft a ‘Perfect’ Ring using the ‘Perfect’ Gold Bar. This is explicitly stated in the ‘perfect’ gold bar’s recipe:

*   `Recipe 1: skills=[Smithing level 40 xp 22.5]; tools=[none]; facilities=[Furnace]; materials=[1 x 'perfect' gold ore]; outputs=[1 x 'perfect' gold bar]; ticks=4.`
*   The ‘perfect’ gold bar recipe requires Smithing level 40 and uses a Furnace. The bot possesses the necessary level and the ‘perfect’ gold bar. The ring mould is also present.

**Source:**

*   `fa
```

### gemma3:12b / npc_variant_banking
- Generation seconds: 5.249
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
*   Dialogue with Jack provides narrative context for the quests. (Supported by: Direct Match - ‘Lead: ‘Bird’s-Eye’ Jack is a quest NPC that plays a minor role in 
```

### deepseek-r1:7b / domain_model_recipe
- Generation seconds: 6.054
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
- Generation seconds: 3.797
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
*   The ‘perfect’ gold bar recipe requires Smithing level 40 to execute.

**Source:**

*   `facts.recipes` for the ‘perfect’ gold bar recipe
```

### deepseek-r1:7b / npc_variant_banking
- Generation seconds: 5.282
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

*   Lunar Isle – Location of the Banker.
*   Pirates’ Cove – Location of the ‘Pirate’ variant of Jack.
*   Lunar Isle Bank – Location of the Banker.

**Uncertainty:**

*   The exact distance the player can talk to Jack from is stated as “as
```
