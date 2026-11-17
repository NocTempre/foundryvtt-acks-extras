# Treasure — roadmap

What is not built. How it works now is [MODEL.md](MODEL.md).

| Row | Not built | Notes |
| --- | --- | --- |
| Deal toggles | The side panel of Judge toggles (no magic, force cursed, no coin, no gems). | Stored shape is `deal.toggles` on the pile. A toggle shapes a deal, and a pot built by hand has none, so no control is rendered until the hoard rolls exist. |
| Two unruled toggles | "Leave carried gear" and "Hide worth until turned". | Never ruled by the owner; a ruling decides whether either exists. |
| Replace planner | A replace card strikes the pool's lots it replaces. | Today a replace card joins the pot as it is and strikes nothing. The planner reads the buckets and the pool's lots (the plan's T3). |
| Bands | Value bands computed from apparent worth. | Every card is band 0 behind `bandOf`; icon and colour polish with it. |
| Cursed | `cursed` / `curseKnown` and the cursed face colour. | The plan's R3. |
| Drag and drop | A card dragged out of the pot onto an actor sheet. | Sheets that override `_onDrop` (vehicle, item, party, unit) need a row each. |
| Quick grab | The party panel and the pace-keeping split. | Needs the roster contract's `pace`. |
| Search the fallen | A pot staged from a defeated group. | The plan's R6; carried goods are moved off the bodies, not copied. |
| Letter rolling | A treasure letter dealt into cards. | The hoard engine exists (`hoard-logic.mjs`); its adapter and entry points are T4 and T5. |
| XP award | Experience for treasure recovered. | Out of scope for the pot. |
| Carry limits | A warning when a take overloads a character. | A Take does not read capacity. |
| Flippers list | A control for who may turn cards. | The relay honours `flippers`; the window sets none. |
| Reopening a pot | A listing of pots in progress. | A pot is reopened from the Cards directory or its doorway card. |
