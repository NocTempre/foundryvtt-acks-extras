# Treasure — roadmap

What is not built. How it works now is [MODEL.md](MODEL.md).

| Row | Not built | Notes |
| --- | --- | --- |
| Coin and gem toggles | "No coin" and "No gems or jewelry" on the deal toggles panel. | Stored under `deal.toggles` beside the two built. On a by-hand pot they would strike coin or value cards at open, and the plan's canvas wanted them for a rolled hoard; they wait for the hoard rolls (T4) so they gate a roll. |
| Two unruled toggles | "Leave carried gear" and "Hide worth until turned". | The canvas's other two toggles. Never ruled by the owner; a ruling decides whether either exists. |
| Replace planner | A replace card strikes the pool's lots it replaces. | Today a replace card joins the pot as it is and strikes nothing. The planner reads the buckets and the pool's lots (the plan's T3). |
| Drag and drop: other sheets | A card dragged onto the vehicle, item, party and unit sheets. | These override `_onDrop` and never fire `dropActorSheetData`, so the pot's hook does not reach them; each needs its own binding, as the party sheet's member drop is bound. The character, monster and extras' character sheets are reached. |
| Party picker | A Judge's choice of which party a pot answers to. | Nothing writes the pot's `partyId`; the aside reads the flag, else the world's only party, so a world with several parties has none until a control sets it. |
| Quick grab: who may press | Restricting Quick grab to the Judge, or to a seat that owns one member. | Any seat that may Take may press it, and it places goods on members the presser does not own (DECISIONS, "Quick grab: the Judge's client plans and delivers"). The owner decides whether that stands. |
| Letter rolling | A treasure letter dealt into cards, from a fight's fallen and from the monster statblock. | The hoard engine exists (`hoard-logic.mjs`); its adapter and entry points are T4 and T5. **The seam:** `dealLetter(letters, {pile})` in `search.mjs` returns no cards today; T4 fills it, T5 puts the lair warning in front of it. The search card already lists each letter with a note. |
| Search: text results | A drawn table result that is text only (no item) becomes a card. | It is listed on the Judge's card, since no card shape delivers it. |
| Search: containers | A body's container and its contents move as one. | Every goods item on the body is its own card, a container's contents included. |
| XP award | Experience for treasure recovered. | Out of scope for the pot. |
| Carry limits | A warning when a take overloads a character. | A Take does not read capacity. |
| Flippers list | A control for who may turn cards. | The relay honours `flippers`; the window sets none. |
| Reopening a pot | A listing of pots in progress. | A pot is reopened from the Cards directory or its doorway card. |
