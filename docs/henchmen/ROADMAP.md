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
