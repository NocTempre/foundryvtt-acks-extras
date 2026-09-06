# Bridge — roadmap

What is designed and not built. Everything here is deliberately absent from
the code, not missing from it; the rulings behind the built half are
[DECISIONS.md](DECISIONS.md).

---

## The phases after v1

v1 is `link`, `character`, `sheet`, `roll`, `say`, `party`, `map`, the relay
of public chat into one channel, and the seat. In order:

2. **The character's numbers.** `hp` over core `applyDamage`; `coin` over
   `lib/money.mjs` `transferCoin` (always gated from a player; `gate: false`
   never reachable from a member); `xp` over `formation`'s shares and core
   `getExperience`; **level-up** once `classes/levelup.mjs` splits into
   `planLevelUp(actor)` → `{hpRoll, awards, choices}` and `applyLevelUp(actor,
   plan, picks)` with the wizard as one caller; **`character new`** once a
   `rollScores(method)` exists beside `classes/stat-page.mjs` `METHODS`, then
   `applyChargen` (already headless).
3. **The table in Discord.** Character webhooks (per-message name and
   avatar; a portrait uploaded once and its CDN URL cached per actor); a
   forum channel per party with a thread per scene; the status board — one
   pinned message per party, edited on `actor` and `time` events; whispers
   to the recipient's DM and blind rolls to the Judge.
4. **The procedures** (below), `hire` over `henchmen.hire`, `travel` over
   `formation.travel`, `turn` over `advanceTurns`, `declare` + `resolve`,
   the shot clock, standing orders.
5. **Step two: one-to-one time.** Per-formation expedition clocks reconciled
   against a world calendar that advances with real time — a formation
   ruling (DECISIONS), not a bridge one.

## Playing without a tactical map

Owner direction (2026-09-05): plan the interaction set around the RAW
procedures a table needs when no battlemap is running. The procedures are
the book's — RR chapter 6 (Adventures: delves, expeditions, encounters,
combat) and the Judge's abstract resolutions (JJ chapters 10 and 11) — and
most already exist here as engines. What follows is the map from each
procedure to what it would run over, and what is missing. **Engine** means a
headless function exists; **app** means only a window drives it today;
**gap** means nothing is built.

### Delves (RR ch. 6 §VI.1)

| procedure | today | bridge verb |
|---|---|---|
| Turns and rounds; rest | engine — `formation.advanceTurns` / `advanceRounds({resting})` | `turn`, `rest` (Judge) |
| Marching order | engine — `formation.marchingOrder`, the record's members | `order show`; editing stays the party sheet's until a text form is designed |
| Light | engine — `formation.addLight` / `toggleLight` / `removeLight` | `light` |
| Searching, listening | engine — `formation.rollPartyCheck(formation, key)` (`PARTY_CHECKS`) | `search`, `listen` |
| Doors and dungeonbashing | engine — `formation.doors` | `door` |
| Traps and trapbreaking | engine for the arithmetic (`trap-rules.mjs`), but placement is a region or a wall | **gap**: an abstract placement — a trap the party has met, with no geometry — so `attemptDisarm` can run without a scene |
| Caving, climbing, swimming, jumping | engine — `formation.obstacles` / `swimming` / `jumping` (pure) | `climb`, `swim`, `jump` |

### Expeditions (RR ch. 6 §VI.2)

| procedure | today | bridge verb |
|---|---|---|
| Hours and days; the day board | engine — `formation.travel.setDayKind` / `setAncillary`; `closeDay` | `travel` (player declares an ancillary; the Judge ends the day) |
| The hex trace without a token | engine — `travel.enterHex(formationId, label)` takes a label | `travel move <hex>` — the abstract journey needs no token drag |
| Searching the wild | engine — `searching.mjs` | `search` (wilderness) |
| Navigation; being lost | engine — `travel.rollLandNavigation`; `setLost` is the Judge's | `navigate` (Judge sees the lie) |
| Wandering monsters | engine — the journey's encounter chain (`encounter-card.mjs`), Judge-whispered | fires from `travel`; the Judge's card routes to the Judge |
| Survival, foraging, provisions | engine — `lib/survival`, `foraging.mjs`, `provisions.mjs` | `camp` |
| Weather | engine — `sky.mjs`, `weather.mjs` | read on `travel status` |

### Encounters (RR ch. 6 §VI.3)

| procedure | today | bridge verb |
|---|---|---|
| Encounter distance | engine — `encounters.encounterDistance` (pure) | part of `encounter` (Judge) |
| Surprise | **app** — core's Surprise Matrix owns the matrix and the evade permission; lib's card consolidates its output | **gap**: a headless surprise run, or the matrix's `_prepareContext` driven from the seat |
| Evasion | engine for the numbers (`evasionTarget`, `evasionModifiers`, `aftermath`), no runner applies them | **gap**: an evasion runner; then `evade` |
| Reactions | **app** — the influence window; core `rollReaction` per actor | `react` over core's roll first; the modifier stack later |

### Combat without a map (RR ch. 6 §VI.4)

| procedure | today | bridge verb |
|---|---|---|
| Initiative | core's tracker, consolidated by lib's card | **verify**: a Combat with actor-only combatants and no scene; then `init` |
| Round sequence: declare, then act | **gap** — no engine; this is the play-by-post layer | `declare` (one line per member, pending list on the board) and the Judge's `resolve` |
| Attacks, damage | engine — `rollById` `atk:*` / `wpn:*`; core `applyDamage` | `roll`, `hp` |
| Morale | engine — `rollById` `morale` | `roll` |
| Engagement, ranges, cleaves | core's attack flow; no abstract range band | **gap**: a range band per side for the abstract fight, if the table wants it |

### The Judge's abstractions (JJ ch. 10 and 11)

The abstract dungeon foray and the abstract wilderness encounter resolve a
whole delve or encounter in one throw against a resolution table — the
wargame-speed option a distributed campaign may prefer. **Nothing is built,
and the tables are content**: an importer recipe for each resolution table
and its modifiers, then an engine that performs the procedure (party
strength, the number of encounters, the throw, the aftermath, treasure and
XP), then `foray` and `encounter abstract` verbs. Listed here so the
importer's roadmap and this one name the same work.

### The campaign month (RR ch. 8, JJ ch. 3)

Downtime activities and the month sequence are `acks-domains`' domain; the
bridge would call its api when one exists. Not this repo's to build.

## The look in Discord

Discord renders none of Foundry's HTML: no sheet template, no theme, no
fonts. Two routes get close, and v1 takes the plainer one (embeds with the
sheet's readings, text for cards, a PNG for the map):

- **Capture the real thing.** The seat holds a full Foundry client, so it
  can render an actor's sheet or a chat card off-screen and answer a PNG of
  it — the exact look, the world's theme, at the cost of a still image:
  nothing in it is a button and Discord's search cannot read it. Wanted as
  `/sheet look:` and as the roll card's picture beside its text.
- **Discord's own layout components** (Components V2: containers with an
  accent colour, sections with a thumbnail, media galleries, separators,
  buttons and selects) can arrange the sheet's readings in a shape that
  echoes the sheet and stays interactive — a roll button under each save.
  Discord's look, Foundry's structure.

Both fit under the same commands; which surface takes which is a ruling for
DECISIONS when built.

## The map in Discord

v1 posts the Judge's view. Wanted: a **player-vision map** — the seat
controls the party token (or the member's own) so the canvas draws that
token's sight, captures, and releases — verified live before it is promised,
because GM vision from a controlled token depends on the scene's token-vision
setting. Also wanted: a crop around the party at a chosen radius rather than
the whole board, and a legend line naming what is in frame.

## Seat hygiene

- A scheduled seat restart (daily, at the table's quietest hour) as insurance
  against a client that was designed for a session and runs for a month.
- Metrics a Judge can ask for: `status` — seat uptime, lives, last event,
  queue depth.
- The seat as the only GM online: it is then `game.users.activeGM`, so the
  module's primary-GM hooks run on a headless client. Walk them there (party
  actor adoption, the journey's encounter chain) before a table relies on
  the Judge being away.

## Accounts and dice

- **Self-service enrolment** — a window toggle letting any member of the
  chosen server mint their own Player user with `/account create`. The verb
  and the guard exist (DECISIONS); the toggle is a ruling the Judge opts
  into, with the world's user list then gated by guild membership alone.
- **Inline dice** — `!roll 2d6` or `[[2d6]]` in an ordinary message. Needs
  the privileged Message Content intent; lands with the proxy prefix.
- **A Judge's `/roll` for the table** — `private:` for a blind throw whose
  result goes to the Judge alone, and a whisper route for the reply.
