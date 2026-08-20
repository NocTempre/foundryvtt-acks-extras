# Battlemap — roadmap

1. **Formation auto-squeeze.** The face-width seam (`effectiveFrontage()`)
   ships; the wall-probing squeeze that narrows it in tight passages is
   formation work — staged in `docs/formation/ROADMAP.md` §3.
2. **Hex grids.** The mode seam is ruled (DECISIONS 2026-08-19): a hex
   exploration scale set of its own; tokens that resize and auto-arrange to
   fill a hex as its occupancy changes; an optional fixed "slots-per-cell"
   override with a show-all button. The lattice solver already fits arbitrary
   basis vectors, so the fitting half is done — the apply and arrangement
   halves are not.
3. **Gridless scenes.** A choice between the square and hex behaviour modes
   for scale and token sizing; refused by apply in v1.
4. **Multi-segment scale bars.** Several scale-bar drags averaged (weighted
   by length) instead of the single segment v1 keeps.
5. **Gallery row.** The feature area is new, so `docs/GALLERY.md` gains a row
   at the first release that ships a screenshot — the sync fails on a row
   whose PNG does not exist yet, so the row and the shot land together.
