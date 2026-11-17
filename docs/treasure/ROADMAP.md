# Treasure — roadmap

What is not built. How it works now is [MODEL.md](MODEL.md).

| Row | Not built | Notes |
| --- | --- | --- |
| Coin and gem toggles | "No coin" and "No gems or jewelry" on the deal toggles panel. | Stored under `deal.toggles` beside the two built. On a by-hand pot they would strike coin or value cards at open, and the plan's canvas wanted them for a rolled hoard; they wait for the hoard rolls (T4) so they gate a roll. |
| Two unruled toggles | "Leave carried gear" and "Hide worth until turned". | The canvas's other two toggles. Never ruled by the owner; a ruling decides whether either exists. |
| Replace planner | A replace card strikes the pool's lots it replaces. | Today a replace card joins the pot as it is and strikes nothing. The planner reads the buckets and the pool's lots (the plan's T3). |
| Drag and drop | A card dragged out of the pot onto an actor sheet. | Sheets that override `_onDrop` (vehicle, item, party, unit) need a row each. |
| Quick grab | The party panel, the button and the relay act that plans again on the GM client. | `planGrab` and the roster's `pace` are built (R5 core); the window wiring is the next R5 step, which passes each member's `capacity6`, `load6` and the roster's `pace(...).rank`. |
| Letter rolling | A treasure letter dealt into cards, from a fight's fallen and from the monster statblock. | The hoard engine exists (`hoard-logic.mjs`); its adapter and entry points are T4 and T5. **The seam:** `dealLetter(letters, {pile})` in `search.mjs` returns no cards today; T4 fills it, T5 puts the lair warning in front of it. The search card already lists each letter with a note. |
| Search: text results | A drawn table result that is text only (no item) becomes a card. | It is listed on the Judge's card, since no card shape delivers it. |
| Search: containers | A body's container and its contents move as one. | Every goods item on the body is its own card, a container's contents included. |
| XP award | Experience for treasure recovered. | Out of scope for the pot. |
| Carry limits | A warning when a take overloads a character. | A Take does not read capacity. |
| Flippers list | A control for who may turn cards. | The relay honours `flippers`; the window sets none. |
| Reopening a pot | A listing of pots in progress. | A pot is reopened from the Cards directory or its doorway card. |
