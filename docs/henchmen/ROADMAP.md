# Henchmen — Roadmap

What is not built. How it behaves now is [MODEL.md](MODEL.md); why is
[DECISIONS.md](DECISIONS.md).

- **A relationship map / graph view** over attitude (character → character)
  and slander (party/character → location), rendered as one navigable web.
  **Integration first**: adopt or feed a maintained community graph module
  (Foundry Graph was the leading v14-verified candidate as of 2026-07-23)
  before building a bespoke viewer, and treat it as a **projection** of the
  existing stores, never a second source of truth — a bespoke D3/SVG viewer
  in this feature is the last resort, only if no candidate grows a
  data-driven write API.

- **22 `ACKS-HENCHMEN` strings still print a magnitude in the label** — the
  outcome hints (`outcomeHint.hesitate`, `.grudging`, `.fanatic`,
  `.begrudging`, `.acceptElan`, `.refuses`, `.refuseSlander`), the modifier
  labels (`mod.oppositeAlignment`, `.customaryTask`, `.recentCasualties`,
  `.mercenaryAdventuring`), `cond.threats`' HD threshold,
  `posting.commissioned`, `posting.classLevelHint`, `followers.loyaltyDefault`,
  `followers.loyaltyFanatic`, `card.insist`, and
  `monster.feigned.escape`'s band. The 2026-09-03 pass retired printed figures
  from 21 sibling strings in this root and deliberately left these; the reason
  and the order the fix has to take are one ruling, in
  [../influence/DECISIONS.md](../influence/DECISIONS.md). Unlike those 21 these
  carry no page reference at all, so once a magnitude goes the reader has
  nowhere to look it up — retiring one here means leaving a reference behind
  it. `posting.created`,
  `card.downedNote` and `roster.calamityPlaceholder` are not in the set —
  their figures are world-computed interpolations or the zero point.
