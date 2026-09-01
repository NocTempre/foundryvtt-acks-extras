/**
 * ACKS module code-hygiene sweep — the Workflow script.
 *
 * DO NOT run this file directly. `plan-sweep.mjs` bakes its plan into a
 * generated copy and prints that copy's path; run THAT:
 *
 *     node plan-sweep.mjs --lens foundry     # prints RUN: <path>
 *     Workflow({ scriptPath: "<that path>" })   // no args needed
 *
 * The plan is baked into the generated file rather than passed as `args`
 * because the payload is ~20 KB of JSON: routing it through a tool argument
 * means transcribing it by hand, and a single mangled character (an em dash, an
 * escaped ampersand, a stringified object) fails in a way that looks like the
 * script is broken. A file path cannot be mistranscribed.
 *
 * Passing `args` still works — the baked plan simply takes precedence — so a
 * caller that already holds the payload programmatically can use either.
 *
 * Shape of the return value:
 *   { rows, triageMarkdown, coverage, summary, vocab, sweptClusterIds,
 *     carriedClusterIds, mode, lens, heads, auditDir }
 */

export const meta = {
  name: 'acks-hygiene-sweep',
  description: 'Audit acks-extras (importer subsystem included) against the standing hygiene checklist',
  whenToUse: 'Invoked by the /acks-hygiene-sweep skill. Run the generated copy that plan-sweep.mjs emits.',
  phases: [
    { title: 'WikiVocab', detail: 'extract canonical ACKS II rules vocabulary' },
    { title: 'Find', detail: 'one agent per cluster' },
    { title: 'Verify', detail: 're-read each cited line' },
    { title: 'Escalate', detail: 'root-model re-verify of cheap-tier Criticals' },
    { title: 'Synthesize', detail: 'normalize, convention gaps, core cross-check, vocab roll-up' },
    { title: 'Triage', detail: 'write the report' },
  ],
}

/* ------------------------------------------------------------------ plan --- */

/* plan-sweep.mjs --emit-run replaces the next line verbatim with the resolved
 * plan as a literal. Leave it exactly as written: the generator matches it as a
 * fixed string. In this ungenerated template it stays null, so `args` is used. */
const BAKED_PLAN = null // ACKS_SWEEP_PLAN_SLOT

const PLAN = BAKED_PLAN ?? args

if (!PLAN || !Array.isArray(PLAN.clusters)) {
  throw new Error(
    'No sweep plan. Run `node plan-sweep.mjs` and pass the generated script it prints (RUN: <path>) as scriptPath — ' +
      'do not run sweep.workflow.mjs directly, and do not hand-copy the JSON. Received: ' +
      JSON.stringify(PLAN)
  )
}
if (!PLAN.clusters.length) {
  return { rows: [], triageMarkdown: '', coverage: [], summary: { total: 0 }, vocab: PLAN.vocab ?? null, sweptClusterIds: [], carriedClusterIds: PLAN.carriedClusterIds ?? [], mode: PLAN.mode, lens: PLAN.lens ?? 'all', heads: PLAN.heads, auditDir: PLAN.auditDir, note: 'no clusters selected — nothing changed since the last sweep' }
}

const MODE = PLAN.mode
const CLUSTERS = PLAN.clusters

/* Sweep agents run on a cheap tier by default (plan-sweep --model; standing
 * owner instruction). 'root' means no override — agents inherit the calling
 * session's model. MODEL_OPT spreads into every agent() opts; the escalation
 * pass below is the one place that deliberately omits it, so a Critical from
 * the cheap tier is re-judged at the root model — the cap is the root model by
 * construction, since omitting `model` inherits it. */
const AGENT_MODEL = PLAN.agentModel === 'root' ? null : (PLAN.agentModel ?? 'sonnet')
const MODEL_OPT = AGENT_MODEL ? { model: AGENT_MODEL } : {}

/* ------------------------------------------------------- the checklist ---- */

/* The taxonomy lives in categories.json and arrives via PLAN.categoryGroups,
 * already filtered to whatever --lens selected. It is PERMANENT: a checked
 * category that finds nothing is reported as "confirmed clean", never dropped,
 * because a pitfall that is fine today is exactly the one that gets missed when
 * it appears later — and a category the lens did NOT check is reported as "not
 * checked", which is a different claim and must never be conflated with clean.
 * The coverage table is computed from these lists, never from what the agents
 * happened to report.
 *
 * FALLBACK_GROUPS is used only if a caller invokes this script without the
 * newer lens fields; it keeps an old-style args payload working rather than
 * silently auditing nothing. */
const FALLBACK_GROUPS = [
  {
    group: 'Correctness & robustness',
    items: [
      ['missing-type-guard', 'a value used before any typeof/instanceof/shape check its use requires'],
      ['missing-null-guard', 'unguarded destructuring or property access; missing ?. / ?? where the value can be null or undefined'],
      ['missing-default', 'an optional param/config field with no default. Family bug class §10b: `now - (anchor ?? 0)` bills from time zero — an absent anchor means "never enrolled", not "since the epoch", and must be adopted explicitly'],
      ['silent-failure', 'empty catch, swallowed rejection, ignored failed return value, or an error logged while the flow proceeds as if it succeeded. Core itself has NO empty catches — that is the baseline to hold'],
      ['dead-code', 'unreachable branch, permanently-false flag, or an exported symbol with zero consumers'],
    ],
  },
  {
    group: 'Typing & data shape',
    items: [
      ['magic-string-typing', 'comparing .type/.subtype/kind against string literals where a frozen enum exists or should. Core defines ITEM_TYPE in constants.mjs and then ignores it in 44 places — do not inherit that habit'],
      ['hardcoded-cardinality', 'a fixed-arity structure or hardcoded count where the domain is open-ended: a tuple/positional array where a named object or a derived list belongs, a literal count of something countable (number of classes, saves, tabs, attributes) instead of deriving it from the collection, a fixed-length destructure that silently drops later elements, or parallel arrays kept in sync by index instead of one array of objects'],
      ['missing-type-annotation', 'an exported function crossing a module boundary with no JSDoc @param/@returns where the shape is not obvious from the name (destructured option bags, non-obvious return shapes)'],
      ['rules-vocabulary-gap', "the code's enum/string set for a rules-defined domain drifts from canonical ACKS II terminology: missing values, wrong count, renamed term. Name the specific terms and cite chapter/section"],
    ],
  },
  {
    group: 'Foundry platform conventions',
    items: [
      ['appv2-v14-compat', 'ANY legacy Application V1 pattern (extends Application/FormApplication/V1 ActorSheet/ItemSheet, activateListeners, getData as a sheet method, html.find/$(html) jQuery in AppV2 code, new Dialog/Dialog.confirm/Dialog.prompt instead of DialogV2, bare mergeObject/duplicate/renderTemplate instead of the foundry.*-namespaced forms, a bare Actors/Items global instead of foundry.documents.collections.* for sheet registration). All deprecated-but-working until v16, so severity is "modernize", not "broken". ALSO: a dynamic base-class resolution (the `return class X extends Base` factory pattern, Base from CONFIG.Item.sheetClasses[...]) that could resolve wrong and fail silently rather than loudly'],
      ['settings-scope', 'game.settings.register scope misuse: shared game state registered scope:"client" (each seat silently gets its own answer to a question the world must agree on) or a personal display preference registered scope:"world" (one seat\'s choice overwrites everyone\'s, and only a GM can change it)'],
      ['async-sync-hook', 'an async callback (or one returning a Promise) on a boolean-returning hook — preCreate*/preUpdate*/preDelete*. Foundry does not await hook callbacks, so `return false` from an async handler blocks NOTHING and the operation proceeds'],
      ['flag-semantics', "setFlag deep-MERGES rather than replaces, so writing a smaller object does not remove absent subkeys — deletion needs `-=key` or unsetFlag. Also: a flag key containing a dot gets expanded into nested structure; getFlag throws when the owning module is inactive; mutating a document/flag object in place without update()/setFlag never persists and looks correct until reload"],
      ['data-prep-side-effect', 'a document write (update/setFlag/create) or an await inside prepareData/prepareBaseData/prepareDerivedData — risks an infinite prepare→update→prepare loop'],
      ['hook-arg-mutation', 'reassigning a hook callback parameter instead of mutating the object it points at — the caller keeps the original and the change is silently lost'],
      ['render-granularity', 'a full this.render() after a single-field or single-row change where AppV2 partial rendering — this.render({parts:[...]}) — is what the framework provides; also manual dragstart/dragover/drop listener wiring instead of the DragDrop helper configured via DEFAULT_OPTIONS.dragDrop'],
      ['library-reinvention', 'reimplementing what a declared library already provides: a raw prototype monkey-patch or hand-rolled reentrancy guard instead of libWrapper.register(), a private socket channel bypassing the declared socketlib transport, hand-rolled deep-clone/deep-merge/debounce/throttle/random-id instead of foundry.utils.*, or hand-rolled keydown/localStorage handling instead of the Keybindings/Settings APIs'],
      ['manifest-hygiene', 'module.json problems: a declared path that does not exist or differs in case from the file on disk (runtime lookups are case-sensitive even where the OS is not), a relationships entry missing its reason, or a dependency relied on transitively — Foundry does not resolve a dependency-of-a-dependency, so every link needs its own entry'],
      ['cross-package-coupling', "a relative ESM import reaching across a package boundary into another module's or the system's internals, instead of consuming a published api surface (game.modules.get(id).api) — the importing package silently breaks when the other reorganizes its files"],
    ],
  },
  {
    group: 'Registration & structure',
    items: [
      ['duplicate-registration', 'the same thing registered twice: two Hooks.once/on for one purpose, two libWrapper registrations against one target, a duplicate settings.register key, a duplicate globalThis exposure. Also a hook registered per-render or in a constructor with no matching Hooks.off, which accumulates a listener on every open'],
      ['missing-registration-gate', 'raw push/set into a shared registry or collection at multiple call sites with no single function gating the insertion — no dedupe, no collision check, no in-flight claim'],
      ['pointless-wrapper', 'a function whose whole body forwards to exactly one other function, adding no validation, transformation, or behavior'],
      ['duplicate-function', 'near-identical logic copy-pasted across files or subsystems instead of shared through lib/'],
      ['inheritance-over-composition', 'a class hierarchy stretched to share unrelated behavior, or a deep chain where the family doctrine (enhance via wrapper/mixin; subclass only where it genuinely is-a) fits better'],
      ['naming-inconsistency', 'inconsistent casing or naming for structurally similar constructs, within a file or across the subsystem'],
    ],
  },
  {
    group: 'Text, style & docs',
    items: [
      ['hardcoded-ui-text', 'user-facing display text as a literal string instead of game.i18n.localize/format against a lang key — template markup, dialog titles/content/button labels, ui.notifications.*, chat card text, sheet labels. validate.mjs only checks that REFERENCED keys exist; it cannot see text that was never made a key'],
      ['theme-inconsistency', 'CSS that renders correctly in one seat theme and wrong in the other: a hardcoded color/font value instead of var(--acks-*), a literal fallback `var(--acks-x, #hex)` (which MASKS a missing token — this shipped as a real bug), SURFACE vs INK confusion (background takes --acks-burgundy; color/border take --acks-spot; they diverge on dark seats), a raw px font-size instead of the --acks-fs-* ladder, or a derived token declared only in :root and not re-declared verbatim inside the dark block (a token containing var() freezes its substitution at <html>, and Foundry puts .theme-dark on <body>)'],
      ['css-cascade-layer', 'specificity fighting that v13+ cascade layers made unnecessary: !important or escalating selector weight to beat core/system styles, when manifest-declared CSS already lands in the `modules` layer above both. Also CSS loaded outside the manifest styles array, which lands unlayered and silently outranks everything'],
      ['stray-comment', 'TODO/FIXME/HACK/XXX in source (an explicit repo ban, not a style preference), or a comment carrying rationale, history, dates, or attribution that belongs in DECISIONS.md'],
      ['missing-docstring', 'an exported function, class, or non-obvious constant with no docstring. In a single-class file the file header IS the class docstring — do not expect both'],
      ['stale-comment', 'a comment or doc claim the current code contradicts — a described-as-pending migration that already ran, a referenced file that does not exist, a resolved problem still described as open'],
      ['stale-reference', 'code or comments naming a pre-merge module (acks-lib, acks-monsters, acks-content, acks-abilities, acks-equipment, acks-formation, acks-henchmen, acks-influence, acks-location) as if it were still a separately installable module. All were merged into acks-extras on 2026-08-01; a guard like "if acks-monsters is installed" is dead, not defensive'],
    ],
  },
  {
    group: 'Project doctrine',
    items: [
      ['core-flaw-inherited', 'this code repeats a flaw pattern confirmed to exist in foundryvtt-acks-core (see CORE FLAW CONTEXT). Core is read-only reference — the finding is about the copy here, never about core'],
      ['ip-leakage', "runtime code or shipped data embedding extended descriptive prose or a complete arranged stat block, rather than the extraction instructions the family's doctrine requires. Individual enum/category names and chapter pointers are FINE and not findings. Also counts: a gap in ip-scan.mjs/lint-register.mjs coverage that would let a real leak through"],
      ['convention-gap', "a finding about the DOCTRINE, not the code, in either of two senses — (a) SILENCE: TOOLCHAIN.md/DECISIONS.md has no rule about a flaw class this sweep keeps hitting; (b) WRONG DIRECTIVE: a documented convention actively prescribes something that runs against best practice. Label which. Use sparingly and only for patterns, not single instances"],
      ['other', 'a clear best-practice failure that fits nothing above'],
    ],
  },
]

const CATEGORY_GROUPS =
  Array.isArray(PLAN.categoryGroups) && PLAN.categoryGroups.length ? PLAN.categoryGroups : FALLBACK_GROUPS
const ALL_CATEGORIES = CATEGORY_GROUPS.flatMap((g) => g.items.map(([id]) => id))
const LENS = PLAN.lens || 'all'
const SKIPPED_CATEGORIES = Array.isArray(PLAN.skippedCategories) ? PLAN.skippedCategories : []

const CATEGORY_DOCS =
  'CATEGORY TAXONOMY — use exactly one per finding, spelled exactly as shown:\n\n' +
  CATEGORY_GROUPS.map(
    (g) => `## ${g.group}\n` + g.items.map(([id, desc]) => `- ${id}: ${desc}`).join('\n')
  ).join('\n\n') +
  '\n\nThe taxonomy is a STANDING checklist, not a list of things known to be wrong. Most categories will find nothing in your cluster — that is the expected outcome and needs no filler. Never invent a weak finding to populate a category, and never skip a category because "this codebase probably does that right".' +
  (LENS === 'all'
    ? ''
    : `\n\nLENS: this run is scoped to "${LENS}", so the list above is the COMPLETE set of categories in scope. Report ONLY these. If you notice something real that falls outside them, leave it — another lens owns it, and a finding filed under a category this run is not tracking would be recorded as if the whole checklist had been applied. The out-of-scope categories are: ${SKIPPED_CATEGORIES.join(', ')}.`)

/* ------------------------------------------------------ shared context ---- */

const DOCTRINE_CONTEXT = `FAMILY DOCTRINE — this family of Foundry VTT modules has its own decided conventions. Judge against these first and generic best practice second; where a convention is silent on a recurring problem, or actively prescribes something wrong, that is a convention-gap finding.
- Reuse -> extend -> enhance -> invent. Reuse core system documents/fields; extend only via flags["<module-id>"]; enhance with alternate sheets/wrappers; invent nothing the system already provides.
- foundryvtt-acks-core is an UNMODIFIABLE reference. Overrides of core logic default to acks-extras/scripts/lib/. ONE OWNER PER WRAPPED CORE METHOD — two callers wrapping one core method in different directions is a known family failure mode already ruled against.
- Namespacing (validate-enforced): globalThis exposures / custom hooks / Handlebars helpers start with the camelCased module id (acksExtras, acksImporter); top-level CSS classes with the kebab module id; lang keys under the declared ACKS-* root(s); pack _ids with the declared idPrefix.
- Comments and docstrings, stated in each repo's own CLAUDE.md: comments explain MECHANICS — present tense, no dates, no attribution, no change history. Rulings and rejected alternatives go to DECISIONS.md, unbuilt work to ROADMAP.md. NO TODO/FIXME IN SOURCE is an explicit ban. Every exported symbol carries a docstring. A constraint stays in code as a present-tense rule; the incident that taught it goes to DECISIONS. Treat every existing comment as UNVERIFIED — they drift.
- Standing rules from shipped field failures (TOOLCHAIN §10), each canon because the family already paid for it:
  10a. Import a shared surface STATICALLY; never feature-detect a nested API path into silence. A probe for a function at the wrong nested path returns false forever and the layer behind it degrades invisibly. Runtime globalThis probing is only for OPTIONAL integrations, and must log once when absent so a wrong path cannot impersonate "not installed".
  10b. A missing timestamp means "never enrolled", not "since the epoch".
  10c. Automation never escalates its own failure into a punitive game consequence. A failed precondition stops and reports; punitive branches run only from an explicit GM action.
  10d. Every module that persists flags or Active Effects ships its uninstall path.
  10e. Cross-repo feature halves land dependency-first; a guarded read makes a missing half invisible rather than acceptable.
  10g. foundry.utils.duplicate() strips getters — a duplicated snapshot has _id but no id, and a lookup on the wrong key must not no-op silently.
- 2026-08-01 merge: eight modules became scripts/<feature>/ subsystems of acks-extras; acks-content became acks-importer. 2026-09-01 merge: acks-importer became the scripts/importer/ subsystem of acks-extras (tools in tools/importer/, cookbook/ and register/ at the root). There is one repo and one flag scope; every former globalThis.acksExtras probe in the importer is now a static import.
- 2026-08-04: a shared check MUST report what it checked. A green run that verified nothing is the failure mode this rule exists to prevent.`

const CORE_FLAW_CONTEXT = `CORE FLAW CONTEXT — foundryvtt-acks-core is read-only reference. Never report a finding against core itself; report only where THIS cluster repeats one of its patterns (category core-flaw-inherited).
1. Core defines a real frozen enum ITEM_TYPE in src/module/constants.mjs (item/weapon/armor/spell/ability/language/money/bundle) and then never imports it in documents/actor.mjs — 26 raw \`.type === "..."\` comparisons in that file, 44 across 13 files. CONFIG.ACKS (keys: statusEffects, scores, roll_type, saves_short, saves_long, armor, colors, proficiencyType, tags, tag_icons, tag_images, hireling_categories, item_subtypes, monster_saves, base_speed) does NOT carry ITEM_TYPE or the other frozen tables, so reaching them would mean importing core internals — itself against doctrine. Does this cluster compare type/subtype fields against raw literals where a local frozen enum belongs?
2. Core's own changelog records recurring bug classes worth re-checking here: an Active Effect applying twice / a value that grows on every re-apply; a migration/type mismatch surviving for versions; dead code left active enough to throw; a registered setting that gates nothing.
3. Core has NO empty catch blocks anywhere in src/module. Any empty or effectively-empty catch here is worse than the reference it builds on.`

const THEMING_CONTEXT = `THEMING CONTEXT — the family's single-publisher rule for light/dark seats.
- vendor/acks-design/tokens.css is the ONLY place --acks-* palette values are declared (:root plus one .theme-dark, [data-acks-theme="dark"] block). Every other stylesheet CONSUMES them.
- Consumers read tokens BARE: var(--acks-spot). A literal fallback — var(--acks-spot, #7b1e3c) — masks a missing token, which is how an undeclared token once shipped unnoticed. Treat any var(--acks-*, <literal>) as a finding.
- SURFACE vs INK: background takes --acks-burgundy; color and border take --acks-spot. They diverge on dark seats, so a mix-up is invisible in light mode and wrong in dark.
- Inherit-as-substituted: a token whose value contains var() freezes its substitution at <html>, and Foundry puts .theme-dark on <body>. So every DERIVED token (banner, rule-color, borders, focus-ring, shapes) is re-declared verbatim inside the dark block. Do NOT report that duplication as a duplicate-function or dead-code finding — it is load-bearing. Report the opposite: a derived token missing from the dark block.
- One font knob: the fontScale client setting pins --acks-fs-base on documentElement; all sizes derive from --acks-fs-*. A raw px font-size is a finding.
- v13+ cascade layers: manifest-declared module CSS already outranks system and core layers, so !important and specificity escalation against core styles are obsolete anti-patterns rather than necessary evils.`

const APPV2_CONTEXT = `APPLICATIONV2 CONTEXT — what this project's own modern shape looks like, taken from core's already-migrated sheets.
- Core's pattern: \`const { HandlebarsApplicationMixin } = foundry.applications.api; class X extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)\`, with static DEFAULT_OPTIONS (including an actions map), static PARTS, static TABS + instance tabGroups, and overrides of _prepareContext / _preparePartContext / _onRender. Never getData, never activateListeners. Raw DOM (querySelector/addEventListener), not jQuery. Registration via foundry.documents.collections.Actors/Items.registerSheet(...).
- Both audited modules were surveyed and currently show ZERO legacy V1 hits. That is exactly why the legacy half of the appv2-v14-compat check stays in force permanently: it is a regression gate, not a discovery exercise. Report legacy patterns if you find them; report nothing if you do not.
- Legacy Application/FormApplication and V1 sheets are deprecated but functional through v15 and removed in v16 — so a legacy hit is "modernize before v16" (Medium), not "broken today" (High), unless something else makes it worse.
- Known live concerns to check rather than rediscover: (a) three files build their sheet class through a factory — \`return class X extends Base\` where Base comes from CONFIG.Item.sheetClasses[...] / CONFIG.Actor.sheetClasses.monster (abilities/ability-sheet.mjs, equipment/item-sheet.mjs, monsters/monster-sheet.mjs). Check that a failed or stale resolution fails LOUDLY rather than silently yielding a wrong base — this is §10a's shape applied to a class instead of a function. (b) AppV2 ships no automatic drag-and-drop; the framework helper is configured as DEFAULT_OPTIONS.dragDrop [{dragSelector, dropSelector}], instantiated in the constructor, bound in _onRender. Manual dragover/drop listener wiring rebuilds that plumbing by hand (render-granularity / library-reinvention). ESTABLISHED FACT (verified against v14 build 365, drag-drop.mjs:82-95): DragDrop#bind assigns handlers by IDL property (element.ondrop = ...), so per-render re-binding or re-instantiation OVERWRITES the previous handler — listeners never stack, drops never duplicate. Off-lifecycle DragDrop use is a convention finding (Medium at most), never a data-corruption Critical; do not re-derive an accumulation theory. (c) Partial rendering — this.render({parts:['x']}) — is the framework answer to a one-field change; a bare this.render() re-renders and re-lays-out everything.
- Context, not a target: core itself has NOT adopted DialogV2 and still uses jQuery in two non-sheet hook files. Do not file findings about core. It is noted so that extras' own consistent DialogV2 use reads as a deliberate improvement rather than an assumption.`

const LIBRARY_CONTEXT = `LIBRARY CONTEXT — extras declares lib-wrapper (>=1.12.0) and socketlib (>=1.1.0) in module.json relationships.requires.
- scripts/lib/sockets.mjs is the module's ONE socketlib transport, and is confirmed to be the only place in either repo touching game.socket. Its two internal game.socket.emit/on calls are a DELIBERATE, documented native fallback for when socketlib never came up, gated behind if (socket) / if (!socket). Do NOT report that dual path as a violation — it is the intended design.
- A confirmed finding already in hand, to CITE rather than re-derive: scripts/henchmen/repair.mjs (installWageGuard, around lines 123-156) raw-monkeypatches CONFIG.Actor.documentClass.prototype.getTotalWages — captures the original, substitutes a wrapper carrying a hand-rolled \`_<moduleId>Guarded\` reentrancy flag — instead of libWrapper.register(), which provides exactly that protection. It is structurally invisible to tools/validate-extra.mjs's "one libWrapper registration per target" gate, because that gate regexes the literal text libWrapper.register(. If your cluster owns that file, report it (library-reinvention, and note the lint blind spot for the convention-gap stage).
- Scope note, not a defect: the importer subsystem gates 20 operations on game.user.isGM and REFUSES for non-GMs rather than routing the write to a GM seat. That is why it declares neither library. Do not report it as a missing integration.`

function vocabContext(vocab) {
  if (!vocab || !Array.isArray(vocab.domains) || !vocab.domains.length) {
    return 'RULES VOCABULARY CONTEXT: not extracted for this run (no cluster in it can carry a rules-vocabulary finding). Do not report rules-vocabulary-gap findings.'
  }
  return (
    'RULES VOCABULARY CONTEXT — canonical ACKS II closed sets, extracted from the local wiki snapshot. Compare any enum/constant/string set in your cluster that models one of these domains, and report drift as rules-vocabulary-gap: a missing value, a wrong count, a renamed or invented term. Naming specific rule terms in a finding is explicitly allowed; only verbatim extended prose or a complete arranged stat block would be an IP concern.\n\n' +
    vocab.domains
      .map((d) => `- ${d.domain} (${d.citation}): ${(d.canonicalTerms ?? []).join(', ')}${d.notes ? ` — ${d.notes}` : ''}`)
      .join('\n')
  )
}

/* ------------------------------------------------------------- schemas ---- */

const FINDING_PROPS = {
  repo: { type: 'string' },
  file: { type: 'string', description: 'path relative to the repo root, e.g. scripts/lib/tables.mjs' },
  line: { type: 'string', description: 'a line number, or a tight range like 120-135' },
  category: { type: 'string', enum: ALL_CATEGORIES },
  severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
  summary: { type: 'string', description: 'one sentence stating the defect' },
  failure_scenario: { type: 'string', description: 'concrete inputs or state leading to a wrong outcome' },
  family_convention_ref: { type: 'string', description: 'the TOOLCHAIN/DECISIONS/CLAUDE.md rule this relates to, or an empty string' },
  recommended_fix: { type: 'string', description: 'brief, concrete' },
}
const FINDING_REQUIRED = ['repo', 'file', 'line', 'category', 'severity', 'summary', 'failure_scenario', 'recommended_fix']
const FINDING_ITEM = { type: 'object', properties: FINDING_PROPS, required: FINDING_REQUIRED }

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: { findings: { type: 'array', items: FINDING_ITEM } },
  required: ['findings'],
}

const VERIFIED_SCHEMA = {
  type: 'object',
  properties: {
    verified: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ...FINDING_PROPS,
          verdict: { type: 'string', enum: ['confirmed', 'adjusted', 'rejected'] },
          verify_note: { type: 'string' },
        },
        required: [...FINDING_REQUIRED, 'verdict'],
      },
    },
    added: { type: 'array', items: FINDING_ITEM },
  },
  required: ['verified', 'added'],
}

const VOCAB_SCHEMA = {
  type: 'object',
  properties: {
    domains: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'e.g. saving-throw-categories, damage-types, monster-types' },
          canonicalTerms: { type: 'array', items: { type: 'string' } },
          citation: { type: 'string', description: 'book/chapter/section, e.g. "RR ch.6 Adventures, Saving Throws"' },
          notes: { type: 'string', description: 'grouping or validation rules, e.g. "physical vs energy split"' },
        },
        required: ['domain', 'canonicalTerms', 'citation'],
      },
    },
  },
  required: ['domains'],
}

const NORMALIZED_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: FINDING_ITEM } }, required: ['rows'] }
const GAP_SCHEMA = {
  type: 'object',
  properties: { narrative: { type: 'string' }, additionalFindings: { type: 'array', items: FINDING_ITEM } },
  required: ['narrative', 'additionalFindings'],
}
const CORE_SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    confirmedAvoided: { type: 'array', items: { type: 'string' } },
    recurringFindings: { type: 'array', items: FINDING_ITEM },
  },
  required: ['narrative', 'confirmedAvoided', 'recurringFindings'],
}

/* -------------------------------------------------------------- prompts --- */

function fileList(c) {
  if (c.partial) {
    return `This cluster covers ONLY lines ${c.partial.startLine}-${c.partial.endLine} of ${c.root}/${c.partial.file} (${c.partial.totalLines} lines total; another cluster owns the rest). Read that range with offset/limit — issue several Read calls if needed — and do not range outside it. Cite findings as "${c.partial.file}" with the file's real absolute line numbers, not offsets into your read window.`
  }
  return (
    `Read every one of these files IN FULL:\n` +
    c.files.map((f) => `- ${c.root}/${f}   (cite as "${f}")`).join('\n')
  )
}

function surfaceHint(c) {
  if (c.surface === 'templates') {
    return `\nSURFACE: Handlebars templates. Weight hardcoded-ui-text heavily — every piece of visible English in markup that is not {{localize}} / {{#if}}-wrapped localized output is a candidate, including button labels, table headers, empty-state text, tooltips and aria-labels. Also look for inline style="" attributes with hardcoded colors (theme-inconsistency), {{#each}} over a fixed-arity structure (hardcoded-cardinality), data-action attributes with no matching AppV2 actions entry (dead-code), and stale-comment in {{! }} comments. Docstring categories do not apply to templates.`
  }
  if (c.surface === 'styles') {
    return `\nSURFACE: CSS. theme-inconsistency and css-cascade-layer are the primary lenses — see THEMING CONTEXT. Also: a top-level class not starting with the module id (naming-inconsistency, validate-enforced), a selector for markup that no longer exists (dead-code — say so only if you can justify it), and duplicated rule blocks (duplicate-function). Remember the dark-block re-declaration of derived tokens is REQUIRED, not duplication. For vendor/acks-design/tokens.css specifically: it is the sanctioned single publisher, so declaring --acks-* values there is correct by design; what matters is whether every derived token also appears in the dark block.`
  }
  if (c.toolingCluster) {
    return `\nSURFACE: dev harness (never shipped to users, so a user-facing severity ceiling of High applies — a broken tool costs developer time, not game state). Two extra duties: (1) some of these files are SYNCED canon from acks-module-template and must not be hand-edited — if you find a defect in validate.mjs, build-packs.mjs or ip-scan.mjs, say so in recommended_fix (fix upstream in the template, then re-sync). (2) Audit the CHECKERS THEMSELVES for coverage gaps: does ip-scan.mjs / lint-register.mjs / validate-extra.mjs actually detect what it claims? A check that can silently pass having examined nothing is a finding in its own right (family canon, DECISIONS 2026-08-04) — report it as convention-gap or silent-failure with the specific blind spot named.`
  }
  return ''
}

function findPrompt(c, vocab) {
  return `You are auditing ONE cluster of a standing code-hygiene sweep over the Foundry VTT module "${c.repo}". This is a READ-ONLY research task: never edit, create, or delete any file in any repo, and never edit foundryvtt-acks-core, which is reference material only.

CLUSTER: ${c.id} — ${c.label}  (repo ${c.repo}, root ${c.root})

${fileList(c)}${surfaceHint(c)}

${CATEGORY_DOCS}

${DOCTRINE_CONTEXT}

${CORE_FLAW_CONTEXT}

${THEMING_CONTEXT}

${APPV2_CONTEXT}

${LIBRARY_CONTEXT}

${vocabContext(vocab)}

HOW TO WORK
1. Read every assigned file (or line range) completely before judging anything. Do not skim, and do not judge a file you only partially read.
2. Emit one finding per real issue, with the exact relative file path, an exact line number or tight range, one category, a severity, a one-sentence summary, a concrete failure_scenario (specific state or input -> specific wrong outcome), the family convention it touches if any, and a brief concrete fix.
3. Severity: Critical = crash, data loss, or silently wrong game state a player or GM would experience (wrong dice result, wrong AC/HP, duplicated grants, money vanishing). High = a broken feature or wrong calculation the offline suite would not catch. Medium = a real robustness or maintainability risk not currently producing wrong behavior. Low = style, naming, or consistency only.
4. Precision beats volume. A finding whose line number is wrong is worse than no finding, because a verify pass has to spend a read to disprove it. Do not report something already correctly guarded, and do not report a two-value string comparison as magic-string-typing when an enum would be genuine overkill.
5. Most categories will legitimately find nothing here. Report only what you can point at.`
}

function verifyPrompt(c, findResult, vocab) {
  const raw = (findResult && findResult.findings) || []
  return `You are the VERIFY pass for one cluster of a code-hygiene sweep. A first agent read these files and proposed the findings below. Re-read the same files yourself and check every claim against what the code actually says. READ-ONLY: never edit anything.

CLUSTER: ${c.id} — ${c.label}  (repo ${c.repo}, root ${c.root})

${fileList(c)}${surfaceHint(c)}

${CATEGORY_DOCS}

${DOCTRINE_CONTEXT}

${THEMING_CONTEXT}

${APPV2_CONTEXT}

${LIBRARY_CONTEXT}

${vocabContext(vocab)}

CANDIDATE FINDINGS (JSON):
${JSON.stringify(raw, null, 2)}

HOW TO WORK
1. Open each cited file at each cited line. Confirm the code there actually supports the claim.
2. verdict "confirmed" — the citation holds; return it (you may tighten wording).
   verdict "adjusted" — the point is real but the line, severity, or category was wrong; return your corrected version and say what you changed in verify_note.
   verdict "rejected" — the citation does not support the claim, or on a closer read it is not a problem (correctly guarded elsewhere, deliberate documented design, a false positive against one of the CONTEXT blocks above); return it with verdict rejected and a verify_note explaining why.
3. Every candidate must appear exactly once in "verified" — never silently drop one.
4. In "added", include up to 6 genuine findings the first pass missed, strictly inside this cluster's files, same shape (no verdict needed). Do not pad this; an empty array is a fine answer.
5. Be a real skeptic. Rejecting a plausible-but-wrong finding is the single most valuable thing you do here.`
}

/* ---------------------------------------------------------------- run ----- */

log(`${MODE} sweep: ${CLUSTERS.length} cluster(s) — ${CLUSTERS.map((c) => c.id).join(', ')}`)

let vocab = PLAN.vocab ?? null

if (PLAN.extractVocab) {
  phase('WikiVocab')
  const WIKI = 'C:/Proj/acks-reference/WIKI-SNAPSHOT'
  const vocabRules = `Extract canonical ACKS II closed-set vocabulary (the rules' own enumerated terms) from the local wiki snapshot, for use as a comparison oracle against module source code. READ-ONLY: never edit anything, and never copy extended prose — you are collecting TERM LISTS and section citations only, which is explicitly permitted.

Read these markdown files (the pre-extracted mirror; tables survive as pipe tables, so prefer these over the html/ siblings):
- ${WIKI}/rules/md/chapter-1-characters.md — alignment values
- ${WIKI}/rules/md/chapter-3-proficiencies.md — proficiency categories (general vs class, ranked vs unranked)
- ${WIKI}/rules/md/chapter-4-equipment.md — weapon types, armor type tiers, weapon special tags, market/standard-of-living classes
- ${WIKI}/rules/md/chapter-5-spells.md — spell types
- ${WIKI}/rules/md/chapter-6-adventures.md — saving throw categories, damage types (note the physical/energy split), terrain speed multipliers
- ${WIKI}/rules/md/appendix-b-conditions.md — the named conditions/status effects

For each closed set, return: a short kebab-case domain name, the complete list of canonical terms exactly as the rules spell them, a citation (book/chapter/section — never a filesystem path), and any grouping or validation rule worth knowing (e.g. "12 total, split physical vs energy"). Be exhaustive within these files; a missing term would make a later comparison wrongly report drift.`

  const vocabMonsters = `Extract the canonical ACKS II MONSTER taxonomy from the local wiki snapshot, for use as a comparison oracle against module source code. READ-ONLY: never edit anything, and never copy extended prose — term lists and citations only, which is explicitly permitted.

Read:
- ${WIKI}/monsters/md/chapter-1-monster-overview.md — the top-level monster type list
- ${WIKI}/monsters/md/chapter-4-monster-creation.md — the monster-type table plus the alignment-by-type rules
- ${WIKI}/monsters/md/chapter-3-monster-rules.md — any further enumerated sets (vision/senses, encounter groupings, size categories)

Return one entry per closed set: kebab-case domain name, complete canonical term list, citation (book/chapter/section, never a path), and notes for validation rules that constrain combinations (for example which types are locked to a single alignment). Include the parenthesised subtype qualifiers that appear on real stat blocks (such as animal's wild/giant/domestic/prehistoric) as notes, since code may model those separately.`

  const [rulesVocab, monsterVocab] = await parallel([
    () => agent(vocabRules, { ...MODEL_OPT, label: 'vocab:rules', phase: 'WikiVocab', schema: VOCAB_SCHEMA, effort: 'high' }),
    () => agent(vocabMonsters, { ...MODEL_OPT, label: 'vocab:monsters', phase: 'WikiVocab', schema: VOCAB_SCHEMA, effort: 'high' }),
  ])
  const domains = [...((rulesVocab && rulesVocab.domains) || []), ...((monsterVocab && monsterVocab.domains) || [])]
  vocab = { domains }
  log(`wiki vocabulary: ${domains.length} domain(s) — ${domains.map((d) => d.domain).join(', ')}`)
} else if (vocab) {
  log(`wiki vocabulary: reusing ${vocab.domains?.length ?? 0} cached domain(s)`)
}

phase('Find')
const clusterResults = await pipeline(
  CLUSTERS,
  (c) => agent(findPrompt(c, vocab), { ...MODEL_OPT, label: `find:${c.id}`, phase: 'Find', schema: FINDINGS_SCHEMA, effort: 'high' }),
  (findResult, c) =>
    agent(verifyPrompt(c, findResult, vocab), { ...MODEL_OPT, label: `verify:${c.id}`, phase: 'Verify', schema: VERIFIED_SCHEMA, effort: 'high' })
)

const collected = []
const clusterStatus = []
for (let i = 0; i < CLUSTERS.length; i++) {
  const c = CLUSTERS[i]
  const r = clusterResults[i]
  if (!r) {
    log(`WARNING cluster ${c.id} (${c.label}) returned nothing — its files are UNVERIFIED this run`)
    clusterStatus.push({ id: c.id, label: c.label, ok: false, kept: 0, rejected: 0 })
    continue
  }
  const verified = Array.isArray(r.verified) ? r.verified : []
  const added = Array.isArray(r.added) ? r.added : []
  let kept = 0
  let rejected = 0
  for (const v of verified) {
    if (!v) continue
    if (v.verdict === 'rejected') { rejected++; continue }
    collected.push({ ...v, sourceCluster: c.id })
    kept++
  }
  for (const a of added) {
    if (!a) continue
    collected.push({ ...a, sourceCluster: c.id, verdict: 'confirmed' })
    kept++
  }
  clusterStatus.push({ id: c.id, label: c.label, ok: true, kept, rejected })
}
log(`survived verification: ${collected.length} finding(s); ${clusterStatus.filter((s) => !s.ok).length} cluster(s) failed`)

const byKey = new Map()
for (const f of collected) {
  const key = `${String(f.file || '').toLowerCase().trim()}|${String(f.line || '').trim()}|${f.category}`
  if (!byKey.has(key)) byKey.set(key, f)
}
let deduped = [...byKey.values()]
log(`deduped: ${deduped.length}`)

/* Escalation path: a Critical found and verified on the cheap tier is
 * re-judged ONCE at the calling session's model before it can drive a release
 * decision — the tier that finds Criticals has produced refuted ones before
 * (the DragDrop accumulation theory, two false Criticals, 2026-08-07). The
 * escalation agent deliberately omits MODEL_OPT: no `model` opt means it
 * inherits the root model, which is also the cap — there is nothing above it
 * to escalate to. Skipped entirely when the sweep already runs at root. */
const criticals = AGENT_MODEL ? deduped.filter((f) => f.severity === 'Critical') : []
if (criticals.length) {
  phase('Escalate')
  log(`escalating ${criticals.length} Critical(s) to the root model`)
  const ESCALATION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'severity', 'reason'],
    properties: {
      verdict: { type: 'string', enum: ['confirmed', 'downgraded', 'rejected'] },
      severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
      reason: { type: 'string' },
    },
  }
  const rootOf = (f) => (CLUSTERS.find((c) => c.id === f.sourceCluster) ?? {}).root ?? ''
  const verdicts = await parallel(
    criticals.map((f) => () =>
      agent(
        `You are the escalation verifier of a code-hygiene sweep. A cheaper-model pass rated the finding below Critical; your job is to independently confirm, downgrade, or reject it. Be adversarial: attempt to REFUTE the claimed mechanism against the actual platform semantics before accepting it — a plausible mechanism that does not exist on this platform is the historical failure mode here. Read the cited file and lines yourself (repo root: ${rootOf(f)}), plus enough surrounding code to judge the failure scenario.

Finding:
- file: ${f.file} line(s): ${f.line}
- category: ${f.category}
- summary: ${f.summary}
- failure scenario: ${f.failure_scenario ?? '(none given)'}

Return verdict (confirmed | downgraded | rejected), the severity you would assign (Critical only if a plausible ordinary user action corrupts data or breaks a feature), and a reason grounded in what you read.`,
        { label: `escalate:${f.sourceCluster}:${f.category}`, phase: 'Escalate', schema: ESCALATION_SCHEMA, effort: 'high' }
      )
    )
  )
  const dropped = []
  for (let i = 0; i < criticals.length; i++) {
    const f = criticals[i]
    const v = verdicts[i]
    if (!v) continue // escalation agent died — keep the finding as-is rather than silently losing it
    if (v.verdict === 'rejected') {
      dropped.push(f)
      f.__escalationRejected = true
      f.verify_note = `${f.verify_note ? f.verify_note + ' ' : ''}ESCALATION REJECTED (root model): ${v.reason}`
    } else if (v.verdict === 'downgraded') {
      f.severity = v.severity === 'Critical' ? 'High' : v.severity
      f.verify_note = `${f.verify_note ? f.verify_note + ' ' : ''}ESCALATION downgraded from Critical (root model): ${v.reason}`
    } else {
      f.verify_note = `${f.verify_note ? f.verify_note + ' ' : ''}ESCALATION confirmed Critical (root model): ${v.reason}`
    }
  }
  deduped = deduped.filter((f) => !f.__escalationRejected)
  log(`escalation: ${criticals.length - dropped.length} kept, ${dropped.length} rejected`)
}

phase('Synthesize')
const [normalized, gaps, coreCheck, vocabRollup] = await parallel([
  () =>
    agent(
      `You are the severity-normalization pass of a code-hygiene sweep whose findings came from ~${CLUSTERS.length} independent cluster agents, each calibrating severity slightly differently. Apply ONE consistent standard across the whole list.

Rubric:
- Critical: crash, data loss, or silently wrong game state a player or GM directly experiences (wrong dice result, wrong AC/HP, duplicated grants, money vanishing).
- High: a broken feature or wrong calculation the offline test suite would not catch.
- Medium: a real robustness/maintainability risk not currently producing wrong behavior — a missing guard, a magic string, a missing docstring on a public surface, a legacy-but-working Foundry pattern.
- Low: style, naming, consistency.

Calibration notes: dev-harness files (tools/) cap at High — they cost developer time, not game state. A deprecated-but-functional Foundry V1 pattern is Medium ("modernize before v16"), not High. A doctrine observation (convention-gap) is Medium unless the gap is actively causing the Critical/High findings around it.

FINDINGS (JSON):
${JSON.stringify(deduped, null, 2)}

Return EXACTLY one row per input finding, in the same order, with file/line/category unchanged. You may rewrite severity, family_convention_ref, and recommended_fix for consistency and concreteness. Do not merge, drop, or add rows — other stages own that.`,
      { ...MODEL_OPT, label: 'normalize-severity', phase: 'Synthesize', schema: NORMALIZED_SCHEMA, effort: 'high' }
    ),
  () =>
    agent(
      `You are the doctrine-review pass of a code-hygiene sweep of two Foundry VTT modules. Your subject is the family's own written conventions, not the code.

${DOCTRINE_CONTEXT}

Read these two canon documents in full before judging:
- C:/Proj/acks-module-template/docs/TOOLCHAIN.md
- C:/Proj/acks-module-template/docs/DECISIONS.md

FINDINGS FROM THE SWEEP (JSON):
${JSON.stringify(deduped, null, 2)}

Report convention gaps in BOTH senses, and label which each one is:
(a) SILENCE — a flaw class these findings keep hitting that canon has no rule about. Cite how many findings support it. Example shape: if magic-string-typing recurs heavily, canon has no rule requiring enum-based type comparison; that absence is the finding.
(b) WRONG DIRECTIVE — canon actively prescribes something that runs against best practice. Look hard for these; they are the more valuable half and easy to miss because canon reads authoritatively. One candidate to evaluate on the merits, not to rubber-stamp: TOOLCHAIN §10a tells code to import a shared surface statically "a junction-safe ../../<repo>/scripts/… across the one family edge", i.e. a relative ESM import reaching into another package's internals — while general Foundry package guidance says never relative-import across packages and to consume a published api surface instead. Decide whether §10a is right for this family's junction-based setup or whether it is entrenching fragile coupling, and say which and why.
Also flag any canon rule that is stated but structurally unenforceable, where the sweep found the gate has a blind spot.

For each gap, propose the concrete rule the family should adopt, written in canon's own terse declarative present tense.

Return: a narrative naming each gap with its evidence, plus additionalFindings rows (category convention-gap) ONLY for meta-patterns worth their own triage line — never duplicating a per-instance row already in the list.`,
      { ...MODEL_OPT, label: 'convention-gap-review', phase: 'Synthesize', schema: GAP_SCHEMA, effort: 'xhigh' }
    ),
  () =>
    agent(
      `You are the core-flaw cross-check pass of a code-hygiene sweep. foundryvtt-acks-core is read-only reference and is never a target; the question is only whether the two audited modules repeat its known flaw patterns or avoid them.

${CORE_FLAW_CONTEXT}

FINDINGS FROM THE SWEEP (JSON):
${JSON.stringify(deduped, null, 2)}

For each of the three numbered core patterns:
- If the findings show no recurrence, add a line to confirmedAvoided naming the pattern AND what was actually examined to conclude that — "no one looked" is not a clean bill, so if the sweep's coverage cannot support the claim, say that instead.
- If it does recur, describe it in the narrative, and add a recurringFindings row ONLY as a genuinely new roll-up (e.g. "pattern 1 recurs across N files in both repos") that is not already a per-instance row.

Then give an overall verdict in the narrative: is the audited modules' discipline on these specific patterns better than, equal to, or worse than the core system they build on? Be concrete about which, and cite finding counts.`,
      { ...MODEL_OPT, label: 'core-cross-check', phase: 'Synthesize', schema: CORE_SCHEMA, effort: 'high' }
    ),
  () =>
    agent(
      `You are the rules-vocabulary roll-up pass of a code-hygiene sweep of two ACKS II Foundry modules.

${vocabContext(vocab)}

FINDINGS FROM THE SWEEP (JSON, may contain zero rules-vocabulary-gap rows — that is a valid outcome):
${JSON.stringify(deduped.filter((f) => f.category === 'rules-vocabulary-gap' || f.category === 'magic-string-typing' || f.category === 'hardcoded-cardinality'), null, 2)}

Where the SAME rules domain drifts in more than one file or subsystem independently, produce ONE cross-cutting roll-up finding instead of leaving scattered duplicates — name the specific canonical terms involved and the files, and pick the file that should own the single shared enum. Naming rule terms is explicitly allowed.

If there is nothing to roll up, return an empty additionalFindings array and say so plainly in the narrative. Do not invent drift to justify the stage.`,
      { ...MODEL_OPT, label: 'rules-vocab-rollup', phase: 'Synthesize', schema: GAP_SCHEMA, effort: 'high' }
    ),
])

let finalCore = deduped
if (normalized && Array.isArray(normalized.rows) && normalized.rows.length === deduped.length) {
  // Carry sourceCluster across: the normalizer never sees it and cannot echo it.
  finalCore = normalized.rows.map((r, i) => ({ ...r, sourceCluster: deduped[i].sourceCluster }))
} else {
  log(`WARNING normalizer returned ${normalized?.rows?.length ?? 'nothing'} rows for ${deduped.length} inputs — keeping unnormalized severities`)
}

const extraRows = [
  ...((gaps && gaps.additionalFindings) || []).map((r) => ({ ...r, category: 'convention-gap', sourceCluster: 'synthesis' })),
  ...((coreCheck && coreCheck.recurringFindings) || []).map((r) => ({ ...r, category: 'core-flaw-inherited', sourceCluster: 'synthesis' })),
  ...((vocabRollup && vocabRollup.additionalFindings) || []).map((r) => ({ ...r, category: 'rules-vocabulary-gap', sourceCluster: 'synthesis' })),
]
const rows = [...finalCore, ...extraRows]

/* Coverage is computed here, never authored by an agent: a checked category with
 * zero hits must still appear in the report as "confirmed clean", and a category
 * this lens did not run must appear as "not checked" — a DIFFERENT claim. A
 * report that omits what it found nothing about, or that lets a skipped category
 * read as a clean one, cannot be distinguished from a check that never ran
 * (DECISIONS 2026-08-04). */
const counts = {}
for (const cat of ALL_CATEGORIES) counts[cat] = 0
for (const r of rows) if (r.category in counts) counts[r.category]++

const checkedSet = new Set(ALL_CATEGORIES)
const groupOf = {}
for (const g of CATEGORY_GROUPS) for (const [id] of g.items) groupOf[id] = g.group

const coverage = [
  ...CATEGORY_GROUPS.flatMap((g) =>
    g.items.map(([id]) => ({
      group: g.group,
      category: id,
      hits: counts[id],
      checked: true,
      clean: counts[id] === 0,
    }))
  ),
  ...SKIPPED_CATEGORIES.map((id) => ({
    group: groupOf[id] ?? 'not checked this run',
    category: id,
    hits: null,
    checked: false,
    clean: false,
  })),
]

const summary = { total: rows.length, bySeverity: {}, byCategory: counts, byRepo: {}, byCluster: {} }
for (const r of rows) {
  summary.bySeverity[r.severity] = (summary.bySeverity[r.severity] || 0) + 1
  summary.byRepo[r.repo] = (summary.byRepo[r.repo] || 0) + 1
  summary.byCluster[r.sourceCluster] = (summary.byCluster[r.sourceCluster] || 0) + 1
}
log(
  `final: ${rows.length} finding(s); ${coverage.filter((c) => c.checked && c.clean).length} of ${ALL_CATEGORIES.length} checked categories confirmed clean` +
    (SKIPPED_CATEGORIES.length ? `; ${SKIPPED_CATEGORIES.length} not checked (lens ${LENS})` : '')
)

phase('Triage')
const triageMarkdown = await agent(
  `Write the triage report for a code-hygiene sweep of one Foundry VTT module (foundryvtt-acks-extras, its importer subsystem included). foundryvtt-acks-core was read-only reference, checked only for inherited flaws. Output GitHub-flavored Markdown, no front matter, starting with a single H1.

Run: mode=${MODE}, lens=${LENS}, clusters swept this run = ${JSON.stringify(PLAN.sweptClusterIds)}, clusters carried forward unchanged from previous runs = ${JSON.stringify(PLAN.carriedClusterIds)}.
${LENS === 'all'
  ? 'This run applied the COMPLETE checklist.'
  : `This run was SCOPED to the "${LENS}" lens: only ${ALL_CATEGORIES.length} of ${(PLAN.allCategories || ALL_CATEGORIES).length} categories were checked. The title and the methodology paragraph must both say so plainly, and the coverage table must show the out-of-scope categories as "not checked this run" — never as clean. Do not describe this run as a full audit.`}
Cluster outcomes (kept vs rejected-at-verify per cluster): ${JSON.stringify(clusterStatus)}
${clusterStatus.some((s) => !s.ok) ? 'IMPORTANT: at least one cluster returned nothing — its files are UNVERIFIED this run and the report must say so explicitly by cluster id.' : ''}

Computed numbers — reproduce these EXACTLY, never recount:
${JSON.stringify(summary, null, 2)}

Category coverage (every category, including zero-hit ones):
${JSON.stringify(coverage, null, 2)}

Doctrine-review narrative:
${(gaps && gaps.narrative) || '(unavailable)'}

Core cross-check narrative:
${(coreCheck && coreCheck.narrative) || '(unavailable)'}
Confirmed-avoided: ${JSON.stringify((coreCheck && coreCheck.confirmedAvoided) || [])}

Rules-vocabulary roll-up narrative:
${(vocabRollup && vocabRollup.narrative) || '(unavailable)'}

All findings (JSON; each row's array index +1 is its id in the companion findings.csv):
${JSON.stringify(rows, null, 2)}

Structure, in this order:
1. H1 title, then a short methodology paragraph: how many clusters, what surfaces (scripts, tools, templates, styles), that judgment was against both the family's written conventions and general best practice, and that core was reference-only.
2. "## Coverage" — a table of every category, grouped, showing its hit count where it was checked. A checked category with zero hits reads "confirmed clean"; a category this lens did not run reads "not checked this run" with no hit count. Keep those two visually distinct — conflating them is the single worst error this report can make. State plainly that the checklist is permanent and that a clean category is a result, not an omission. This section comes BEFORE the findings, because it is what makes the findings' absence meaningful.
3. "## Top fixes" — every Critical, then the highest-impact High findings, capped at 25 total; if more High findings exist, say how many are not shown. Each: id, file:line, severity, summary, failure scenario, recommended fix.
4. "## Detail by repo" — Critical and High only, grouped repo then cluster.
5. "## Medium and Low" — one paragraph per repo naming categories and counts. Do not enumerate rows; point at findings.csv.
6. "## Family convention gaps" — from the doctrine narrative, keeping the SILENCE vs WRONG DIRECTIVE labels distinct.
7. "## Core-flaw cross-check" — what is confirmed clean, what recurs, and the better/equal/worse verdict.
8. "## Rules vocabulary" — from the roll-up narrative; if nothing drifted, say exactly that.
9. "## Tracking" — findings.csv carries a status column, default New; a delta re-run preserves the status of rows in clusters it did not re-audit, and flips a no-longer-reproducing row in a re-audited cluster to Resolved rather than deleting it.

Be direct and specific. No praise, no filler, no "as an AI". Where a finding is uncertain, say so rather than overstating it.`,
  { ...MODEL_OPT, label: 'write-triage', phase: 'Triage', effort: 'xhigh' }
)

return {
  rows,
  triageMarkdown: triageMarkdown || '',
  coverage,
  summary,
  clusterStatus,
  vocab,
  mode: MODE,
  lens: LENS,
  checkedCategories: ALL_CATEGORIES,
  skippedCategories: SKIPPED_CATEGORIES,
  heads: PLAN.heads,
  auditDir: PLAN.auditDir,
  sweptClusterIds: PLAN.sweptClusterIds,
  carriedClusterIds: PLAN.carriedClusterIds,
  unownedFiles: PLAN.unownedFiles ?? [],
}
