# UI layout contract (canonical)

Every window a module opens is **editable, resizable, and able to reflow and
scroll**, at the type size its user chose. A user whose display is smaller than
the one it was built on must still be able to reach every control on it, and a
user who raises the type size must have it reach every surface. Reaching a
control also means reaching it from the keyboard and hearing it named, and
means the window behaves when a second copy of it is open beside the first.

This is a field rule, not a preference: the failure is silent. Core caps an
application frame at the viewport height and gives `.window-content`
`overflow: hidden`, so a window taller than the cap is **amputated** — trailing
footer first — with no scrollbar to say anything is missing. Nothing offline
sees it, because nothing offline has a viewport.

## What the gate enforces

`tools/validate.mjs` §8 fails the build on the six halves that are decidable
from source. Read that section for the mechanics; they are not restated here.

- **Scroll-contract membership** — a window whose `classes` array omits
  `<module-id>-scroll`. The contract is opt-in per repo: a module that never
  defines the class has none, and the check stays silent.
- **Dead scroll retention** — a part whose `scrollable` names its own root
  element. `querySelector` searches descendants only, so the retention is
  written, correct in intent, and never fires.
- **A type size the knob cannot reach** — a bare `px` or `rem` font-size in
  `styles/`. Both look right on the machine they were written on and ignore the
  size setting everywhere else, which leaves an accessibility control present
  and inert.
- **Interactive content inside a `<summary>`** — the summary IS the disclosure
  toggle, so a control placed in it either loses its click to the toggle or
  swallows the toggle's, and assistive technology reaches it inconsistently. An
  `<a>` with no `href` there is diagnosed separately: it is not focusable at
  all, so its only route is the click it is already losing.
- **A `<label>` that can never name anything** — a caption with no `for`, no
  wrapped control, and nothing left to name because every control before its
  parent's close is already claimed by a label of its own. A bare `<label>` is
  NOT the defect and never fails: those are bound at runtime, per window.
- **A literal `id=` in a `.hbs`** — a template renders once per open window, so
  a literal id is a duplicate the moment a second copy of that sheet is open,
  and every `for=`/`list=` naming it then resolves to the FIRST window's
  element. `{{@root.partId}}` is the per-window seed for the cases that
  genuinely need an explicit id, such as a `<datalist>`.

Each escape is declared on the spot, and they are deliberate and cheap: a
window outside the scroll contract writes `// no-scroll: <reason>` on or just
above its `classes:` line, a size that must not move writes
`/* px-ok: <reason> */` beside itself, and the three template checks answer to
`{{!-- summary-ok: <reason> --}}`, `{{!-- label-ok: <reason> --}}` and
`{{!-- id-ok: <reason> --}}` on or just above the offending line. An undeclared
omission is the bug.

## Type answers to one knob

`--acks-fs-base` is the size a player sets; every type size in a module is an
expression of it. Three conformant forms, and nothing else:

- **A ramp step** — `var(--acks-fs-body)`, `var(--acks-fs-fine)`. The default,
  and what a surface built on the design system uses throughout.
- **An `em`** off a parent that already rides one. It resolves against whatever
  the parent computed, so the knob arrives through the chain. Never `rem`:
  that reads the BROWSER's root size, which `--acks-fs-base` does not set.
- **A base-derived ratio** — `calc(<n>px * var(--<module-id>-k))`, where the
  ratio is `calc(var(--acks-fs-base, 14px) / 14px)`. This is for a surface
  transcribed from a **px design canvas**, whose measured figures cannot be
  snapped to a ten-step book ramp without redrawing the design. Multiply the
  whole drawing — type, boxes, rails, gaps, and the space ramp re-declared at
  the surface's root — never the type alone, or glyphs burst boxes that stayed
  put. The divisor **carries its unit**: `calc(<length> / 14)` is a length, and
  a px times a px is an area, which is invalid at computed-value time and falls
  back to the inherited size — a failure that reads as a rule that never
  matched.

Two things core will fight for, on every window: it pins a font-size on
`.window-content` **and** on `.window-header`, and those are what a sheet's body
and its header-hosted parts inherit from. A size set on the frame alone reaches
neither. Re-take both explicitly.

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
