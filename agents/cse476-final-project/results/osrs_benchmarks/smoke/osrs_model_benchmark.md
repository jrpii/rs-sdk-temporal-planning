# OSRS Graph RAG Model Benchmark

Generated: 2026-05-02T21:19:46

| Model | Runs | Avg generation s | Avg total s | Avg score | Avoid hits |
|---|---:|---:|---:|---:|---:|
| `gemma3:12b` | 3 | 7.19 | 7.74 | 4.33 | 0 |

## Per-Run Results

### gemma3:12b / domain_model_recipe
- Generation seconds: 11.667
- Score: 4 (4/8 expected hits, 0 avoid hits)

```text
## Domain Model: Crafting a Perfect Ring

Here's a domain model for crafting a perfect ring, based on the provided OSRS Wiki context.

**Entities:**

*   **Perfect Ring:** An untradeable, members-only item, a quest item for the Family Crest quest. It can be worn or dropped. It has no combat bonuses.
*   **Perfect Gold Bar:** A material required for crafting the perfect ring.
*   **Ruby:** A material required for crafting the perfect ring.
*   **Ring Mould:** A tool required for crafting the perfect ring.
*   **Anvil:** A facility required for crafting the perfect ring.

**Actions:**

*   **Craft:** The primary action to create a perfect ring.
*   **Wear:**  The player can equip the perfect ring.
*   **Drop:** The player can discard the perfect ring.

**Preconditions:**

*   **Crafting Level:** Craft
```

### gemma3:12b / planning_feedback_recipe
- Generation seconds: 5.324
- Score: 5 (5/6 expected hits, 0 avoid hits)

```text
Okay, here's an analysis of the situation and the recommended action, based on the provided context.

**Entities:**

*   Ruby
*   'perfect' gold bar
*   Ring mould
*   Anvil
*   'perfect' ring (desired output)
*   Crafting level 40

**Actions:**

*   Crafting ('perfect' ring)

**Preconditions:**

*   **Crafting Level:** The bot must have a Crafting level of 40. (Direct Match 1, Traversed Edge from 'perfect' ring)
*   **Tools:** A Ring mould is required. (Direct Match 1, Recipe 1)
*   **Facilities:** An Anvil is required. (Direct Match 1, Recipe 1)
*   **Materials:** The bot needs a 'perfect' gold bar and a Ruby. (Direct Match 1, Recipe 1)
*   **Location
```

### gemma3:12b / npc_variant_banking
- Generation seconds: 4.591
- Score: 4 (4/6 expected hits, 0 avoid hits)

```text
## Domain Model: 'Birds-Eye' Jack

Here's a domain model for 'Birds-Eye' Jack, based on the provided context.

**Entities:**

*   **'Birds-Eye' Jack (NPC):** A character who exists in two versions: a Pirate (during Lunar Diplomacy) and a Banker (during Dream Mentor).
    *   **Pirate Version:** Located at Pirates' Cove (2224, 3796).
    *   **Banker Version:** Located at the Lunar Isle bank (2100, 3921).  Can be interacted with from further away than most NPCs.
    *   *Wiki Page:* [https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack](https://oldschool.runescape.wiki/w/'Birds-Eye'_Jack)

**Actions:**

*   **Talk-to:** Available for both versions.
```
