# Shared library — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

- **2026-07-18 — v0.1 scope is effect/ability primitives only.** Created ahead
  of the full family-refactor Phase 1 to unblock the abilities program (see the
  program memory + template REFACTOR_PLAN.md status note). The plumbing/interop
  contracts stay pending; this lib is additive to that plan, not a divergence.
- **The shared vocabulary has one definition here** (DAMAGE / MOVEMENT / VISION
  / SENSE / NATURAL_WEAPONS / ALIGNMENTS). These began as a value-identical
  mirror of the monster feature's own enums while it was a separate published
  module; that mirror is **resolved** — `monsters/config.mjs` now re-exports
  from `lib/vocab.mjs`, so its consumers keep one import path and no second copy
  exists. `NATURAL_WEAPONS` here is the superset, carrying the monster sheet's
  sting / feeler / envelopment.
- **Foundry-free split:** `vocab.mjs` (enums + resolver) imports in Node so the
  acks-content cookbook compiler/executor share one definition; `fields.mjs`
  (Foundry field-builders) is lazy so the module still evaluates under Node.

- **Storage lands in the library, keyed on a flag rather than a type**
  (2026-08-01): "goods kept somewhere other than on you" is the primitive under
  markets, banks, base camps and wagons, and the standing promotion rule names
  stash handling as shared machinery. Two consequences were chosen deliberately.
  (1) **Stored goods are real embedded items on the holding actor**, not a
  ledger: an item that has left the character genuinely weighs nothing on them,
  and every existing reader of `actor.items` sees a location's stock without
  being taught anything. (2) **A provider is any actor with
  `flags.acks-extras.storage.provider`** — the library never names a location
  type, so a settlement, a market actor and a future cart are the same
  machinery, and enabling storage on one is a flag write. The UI, the actor type
  and the lifecycle around it belong to the location feature; only the
  primitives are here. Attribution (`ownerUuid`) is a UI convention, not a
  security boundary — the same ruling the equipment feature makes for containers.
- **The template actor is a generator, never a bulk import** (2026-07-24):
  the book statting a creature as tables (dragon: 11 ages x 9 types x 4 body
  forms) is the book saying "make one when you need one". Materializing the
  cross product would be hundreds of near-duplicate actors; the template +
  builder honors the book procedure instead, and a dropped base actor makes
  the same document a modifier (vampire thrall).
- **One token publisher** (2026-08-01): the vendored design-system token file
  (`vendor/acks-design/tokens.css`, `:root` + one `.theme-dark` block) is the
  ONLY place `--acks-*` palette values are declared, and it loads
  unconditionally — inert values style nothing by themselves, and every
  dependent module `requires` acks-lib, so consumers read tokens BARE
  (`var(--acks-spot)`, no literal fallback; a fallback masks a missing token,
  which is exactly how `--acks-field` shipped undeclared and rendered white
  boxes on dark seats). Before this, sheet-theme.css pinned ~18 token copies at
  body-class specificity, out-specifying the token file's dark block; the
  vendor layer and the follower card each grew counter-shims, and one card
  rendered FOUR ways across sheet-theme x seat combinations (worst pair
  1.1:1). sheet-theme.css now owns only override RULES for system-rendered
  markup, gated by `body.acks-lib-sheet-theme`; the setting stays the
  whole-client escape hatch. Corollaries: SURFACE vs INK discipline everywhere
  (`background:` takes `--acks-burgundy`, `color:`/`border:` take
  `--acks-spot` — they diverge on dark seats); type sizes come off the
  `--acks-fs-*` scale so the `fontScale` client setting (writes
  `--acks-fs-base` inline on the root element, where the scale steps
  substitute) resizes every ACKS surface with one knob.
