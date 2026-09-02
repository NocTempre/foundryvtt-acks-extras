# UI layout contract (canonical)

Every window a module opens is **editable, resizable, and able to reflow and
scroll**. A user whose display is smaller than the one it was built on must
still be able to reach every control on it.

This is a field rule, not a preference: the failure is silent. Core caps an
application frame at the viewport height and gives `.window-content`
`overflow: hidden`, so a window taller than the cap is **amputated** — trailing
footer first — with no scrollbar to say anything is missing. Nothing offline
sees it, because nothing offline has a viewport.

## What the gate enforces

`tools/validate.mjs` §8 fails the build on the two halves that are decidable
from source. Read that section for the mechanics; they are not restated here.

- **Scroll-contract membership** — a window whose `classes` array omits
  `<module-id>-scroll`. The contract is opt-in per repo: a module that never
  defines the class has none, and the check stays silent.
- **Dead scroll retention** — a part whose `scrollable` names its own root
  element. `querySelector` searches descendants only, so the retention is
  written, correct in intent, and never fires.

A window that genuinely belongs outside the contract declares it on the spot:
`// no-scroll: <reason>` on or just above its `classes:` line. The escape is
deliberate and cheap; an undeclared omission is the bug.

## What the gate cannot see

These need eyes, and they are part of the live-test pass for any window a
change touches (`.claude/rules/live-testing.md`):

- **`min-width` / `min-height` floors.** A window inside the scroll contract
  still cannot be used if it refuses to shrink to the display. Floors are
  justified per window, not inherited by habit.
- **`overflow-x: hidden` clipping.** The scroll contract pairs vertical scroll
  with horizontal hiding, so a window that relied on horizontal bleed clips
  instead of scrolling the moment it joins. Check narrow palettes and any list
  of imported names.
- **`min-height: 0` on a flex scroller.** `overflow-y: auto` alone leaves the
  frame clipped exactly as before — a flex child will not shrink below its
  content without it.
- **Controls rendered outside the tab body.** A control that belongs to one tab
  but sits outside the tab sections persists on every tab, which reads as a
  navigation fault rather than a layout one.
- **A footer inside the scrolling body.** It scrolls away with the content
  instead of staying pinned, and the primary action goes below the fold.

## Where a window's scroll actually lives

Two ways to make a window scroll, and they are mutually exclusive — choosing
one forecloses the other, which is the trap:

- **The frame scrolls** (`<module-id>-scroll` makes `.window-content` the
  scroller). Cheapest, and correct for a dialog. But `.window-content` is not a
  part, so the window can never retain scroll position across a re-render.
- **A part root scrolls** (the part root carries `flex: 1 1 auto; min-height: 0;
  overflow-y: auto`, declared `scrollable: [""]`). More work, and the only shape
  that survives a re-render — which is what a sheet whose fields submit on
  change needs.

A sheet that re-renders on every keystroke wants the second. A dialog the user
fills once wants the first.
