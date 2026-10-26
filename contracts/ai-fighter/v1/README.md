# AI Fighter authoring contract v1

Start with the [authoring guide](../../../docs/AUTHORING.md).

- [Machine-readable specification](spec.json)
- [JSON Schema](fighter.schema.json)
- [Complete synthetic fixture manifest](example.fighter.json)
- [Rejected inputs](invalid-examples.json)

This is the offline authoring contract. A configured beta server reports registration availability through its `/spec` endpoint.

## Optional fields

A package may add the fields below. Each one has a `/spec` `features` entry; submit it only to a server that lists that feature.

| Field | Feature | Meaning |
| --- | --- | --- |
| `profile.lines` | `profile-lines-1` | `challenge` before a bout, `win` and `lose` after it, 40 characters each (`spec.json` `profileLines`). Shown in arena speech bubbles only |
| `combat.style` | `combat-style-1` | How the fighter fights: closed choices and small grades only. See [Fighting style](#fighting-style) |
| `clips.skill`, `clips.entrance`, `clips.victory` | `extra-clips-1` | Optional clips. See [Optional clips](#optional-clips) |

## Optional clips

Beyond the 11 required motions a package may add three clips (`spec.json` `optionalClips`). Format and timing rules are those of the required actions.

| Clip | What to draw | Timing and marks |
| --- | --- | --- |
| `skill` | One signature move: tell, contact (or run, or stance window), recovery | 0–1 contact, `skill.kind` and the marks below |
| `entrance` | An in-place entrance before the bout | No contact. Plays once during READY → FIGHT! of a cup bout |
| `victory` | A looping victory pose after the win | No contact. Loops under the winner's light after the KO |

`skill.kind` is one of seven rules (`spec.json` `combatStyle.skillKinds`). The server takes the rule's numbers from a built-in fighter that uses the same skill.

| `kind` | Skill | Clip condition |
| --- | --- | --- |
| `stretch` | Stretching arm: a long hit that lands only with its tip; too close misses | One contact, starting at 360 ms or later |
| `pincer` | Pincer: one closing arc in front | One contact, starting at 360 ms or later |
| `flight` | Flying charge: passes through the opponent to the end | `windupTo` < `recoverFrom`, `windupTo` starting at 240 ms or later |
| `feint` | Feint charge: may stop at the fork | Same as `flight` |
| `slide` | Slide: glides along a set line and leaves ice | Same as `flight` |
| `counter` | Counter: a frontal melee swing inside the stance window is blocked and struck back at once; an empty window is an opening | One contact, `windowFrom` < `windowTo` ≤ `strikeFrom` ≤ contact < `strikeTo`, `windowFrom` starting at 100 ms or later, window 200–1000 ms |
| `brace` | Brace: blocks during the stance window, then shoves | Same as `counter` |

The marks are sequence step indices, like `hitSequenceIndices`. `windupTo` is the step where the tell ends and `recoverFrom` the step where the recovery starts.
Optional marks: `run` is the pair of steps alternated during the run, `launch` the first step of the run and `struck` the step where the body front meets the opponent.
The two stances (`counter`, `brace`) also use sequence step indices: `windowFrom`..`windowTo` is the stance window and `strikeFrom`..`strikeTo` the strike (shove) segment,
which holds the one contact. The steps before the window are the tell. The window length is bounded by `combatStyle.stanceWindowMs`.
The tell floor (`spec.json` `combatStyle.tellFloorMs`) is the time the opponent needs to see the skill coming.
Errors: `SKILL_CONTACT`, `SKILL_RUN_MARKS`, `SKILL_STANCE_MARKS`, `SKILL_TELL`, `SKILL_WINDOW`.

## Fighting style

`combat.style` sets how the fighter fights. It holds no numbers of its own, only closed choices and small grades (`spec.json` `combatStyle`).
The server maps each value to engine tuning. Grade 3 and an absent value keep the standard kit. A fighter without `combat.style` fights exactly as before.

| Field | Values | Meaning |
| --- | --- | --- |
| `mix` | `slam`, `combo`, `fast`, 0–4 each | How often each swing is chosen. At least one above 0 and `fast` ≤ `slam + combo` (error `STYLE_MIX`). The server counts `fast` at half weight |
| `special` | `slam`, `combo`, `fast` | The swing used to chase an opponent who opens distance and to strike back while getting up |
| `super` | `slam`, `combo`, `fast`, `dash` | The move used as the super |
| `distance` | 1–5 | Fighting distance: 1 swings up close, 5 from afar |
| `shockwave` | `true` | The slam sends a ground shockwave |
| `summon` | `crane`, `bolt`, `sportsCar`, `roadster` | One summon, called with the slam clip |
| `temper` | `guard`, `retreat`, `measure`, `patience`, 1–5 each | Temperament: blocking, backing off, measuring distance and waiting |
| `exchanges` | `cross`, `pinball`, `rush`, 0–3 each | How often each exchange pattern is chosen: 0 never, 1 half, 2 standard, 3 double |

The `skill` clip, `summon` and `shockwave` together count at most two (`extrasBudget`, error `STYLE_EXTRAS`).
In the game's balance test, a fighter with one choice beats the same fighter without a style in 25–75 % of bouts; combinations of choices are not covered.
