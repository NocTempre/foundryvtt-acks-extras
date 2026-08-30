# Battlemap — roadmap

1. **Formation auto-squeeze.** The face-width seam (`effectiveFrontage()`)
   ships; the wall-probing squeeze that narrows it in tight passages is
   formation work — staged in `docs/formation/ROADMAP.md` §3.
2. **Hex token behaviour.** Hex OUTPUT ships (DECISIONS 2026-08-30): the family
   is chosen, one drawn hex is pitched to one Foundry hex, and the shift lands
   the drawn hex on a real one. What is not built is the token half of the
   2026-08-19 ruling — tokens that resize and auto-arrange to fill a hex as its
   occupancy changes, an optional fixed "slots-per-cell" override, and a
   show-all button. Until then a hex scene sizes tokens by the same quantized
   span a square grid uses, which is approximate on a hex.
3. **Multi-segment scale bars.** Several scale-bar drags averaged (weighted
   by length) instead of the single segment v1 keeps.
4. **Gallery row.** The feature area is new, so `docs/GALLERY.md` gains a row
   at the first release that ships a screenshot — the sync fails on a row
   whose PNG does not exist yet, so the row and the shot land together.
