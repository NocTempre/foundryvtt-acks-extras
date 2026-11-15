# Lib: the feedback window and its intake (wip plan)

**Status:** plan, written 2026-11-15 by a planning session that has ended.
Nothing below is built. Each session named here is a clean session that
reads this file, runs its own agents, appends its results under "Results",
corrects the next start prompt and reports to the owner. This file is the
only hand-over. It is deleted when the last slice has moved its substance
into `docs/lib/{MODEL,DECISIONS,ROADMAP,TESTING}.md` and
`docs/importer/{MODEL,TESTING}.md`.

No printed figure, name or sentence of a book appears in this file, and
none may enter a test, a fixture or a lang string built from it.

## The owner's words

Each is quoted whole. A brief to an agent quotes them in these words, and
the agent's report restates each with one example before building on it.

1. "I'd like a better intake for corrections and bug reports that can auto
   include anonymous console logs if necessary, as well as examples if they
   manually fixed something when they reject a repair overwrite. Unsure how
   to best implement but I want to crowdsource testing and corrections and
   it needs to be as easy as sending me a PM on discord (but better
   organized with log data/correction etc)."
2. "Not to mention automating snapshot images of UI issues. A
   feedback/suggestions intake would be good too."

The readings the plan proceeds on (the planning session's, tested against
source by the architect):

- **One window inside Foundry builds one structured report.** It already
  holds the session's console failures with identifying text replaced, and
  sending it costs one paste or one file dropped into a message. Example: a
  player whose sheet footer is cut off opens the window from that sheet's
  header menu, types one line, presses Copy and pastes into a Discord DM.
- **A Judge who kept their own value over a repair can say so in the same
  window.** Example: a repair of a shelf holds one edit, the Judge keeps
  it and ticks the report box; the window lists one correction naming the
  shipped entry, the field, the page reference and how the two values
  relate, and neither value.
- **The report shows a broken window without a hand screenshot.** Example:
  the window opened from a clipped sheet reports that sheet's content
  height against its frame and that it is cut off; a later slice adds the
  picture of that window alone.
- **The same window takes a suggestion.** Example: a GM types an idea; the
  bundle carries versions and the text and no console ring.

## Open owner questions

Each has a default the plan proceeds on. None blocks slice 1a or 1b.

| # | Question | Default | Blocks |
|---|---|---|---|
| Q1 | Name a Discord destination (a handle, or a server channel) that the window and the site page show? | None is named; the window offers Copy, Save and GitHub, and the changelog and site claim only the GitHub route. | The "as easy as a PM" claim. No file names a Discord destination today. |
| Q2 | Run a receiver on your side (a Discord intake bot or an HTTP relay) so reports arrive already filed? | No. | Slice 3. |
| Q3 | May a bundle sent privately (not to GitHub) carry a held edit's two values, and may a correction's picture show them? | No: locators only, everywhere. | Slice 4. |
| Q4 | May the session edit `acks-bug-triage/SKILL.md` in `acks-module-template` and sync it? | Slice 1c waits for this. | Slice 1c. |
| Q5 | May a player report, or only the GM? | Any seat sends a problem or a suggestion; a correction is GM only. | Nothing; it is the build default. |

## Constraints (rulings of the planning session and the architect)

1. **No write credential ships.** A Discord webhook or a token in module
   JS is a public write key. A one-press send needs a receiver the owner
   runs (Q2). The window makes no network call: `tools/test-feedback.mjs`
   fails when a feedback file holds `fetch(`, `XMLHttpRequest`,
   `WebSocket`, `sendBeacon`, `game.socket`, `socketlib` or
   `clipboard.read`.
2. **The preview is the consent step.** The window renders the whole
   bundle as one string; Copy, Save and the GitHub press all act on that
   stored string. Nothing leaves the client without a press.
3. **A correction carries locators, never values.** A held edit's
   `current` and `page` are page content
   (`.claude/rules/ip-doctrine.md`). No checksum of either rides: a short
   figure's hash is the figure. The owner reproduces the read from their
   own copy.
4. **A correction is opt-in per edit.** A kept edit may be a house rule or
   play state, and an unstamped one may be the page's own change.
5. **The recorder installs at entry-module evaluation.** One attached
   after `ready` saw none of `init`, `setup` and `ready`.
6. **`console.*` is not wrapped**, since a wrap moves every package's
   devtools attribution to this module, and handled failures are not
   routed through `Hooks.onError`, which broadcasts them to every module's
   `error` listener and rewrites the message. The module's own handled
   failures reach the ring through a helper its call sites use.
7. **Home is `scripts/lib/`**, lang root `ACKS-LIB`, slug `feedback`. The
   corrections half lives in `scripts/importer/` and contributes through a
   lib registry, since lib does not import the importer. The window joins
   the scroll contract. No setting is added.

## Design

### The bundle (`acks-feedback/1`)

Built by a pure `buildFeedback`, rendered by `renderFeedback` to: a header
line, the user's fields, environment lines, probe verdicts, one line per
log entry with its top three frames, correction lines, then the machine
block between `-----BEGIN ACKS FEEDBACK acks-feedback/1-----` and
`-----END ACKS FEEDBACK-----`. One container for every route: the text
itself, saved as `acks-feedback-<kind>-<yyyymmdd-hhmm>-<id>.txt`. The same
parser (`parseBlocks`) reads a file, a paste and an issue body.

| Field | Holds | Read from |
|---|---|---|
| `schema` | `"acks-feedback/1"` | constant |
| `id` | 8 base32 characters; the dedupe key across routes | `crypto.getRandomValues` |
| `kind` | `problem`, `correction`, `suggestion` | the form |
| `created` | UTC to the minute | clock |
| `user` | `title`, `what`, `expected`, `steps`, `idea`, `notes`; the user's own words, shown in the preview, not scrubbed | the form |
| `seat` | `{role}` | `CONST.USER_ROLE_NAMES[game.user.role]` |
| `env` | `core`, `system {id, version}`, `module {id, version}`, `modules [{id, version}]` sorted | `game.release`, `game.system`, `game.modules` |
| `env.client` (problem) | `os`, `client`, `gpu`, `maxTextureSize`, `screen`, `viewport`, `performanceMode`, `dpr`, `secure` | a whitelist over core's `SupportDetails.generateSupportReport()`, in try/catch with a versions-only fallback |
| `env.world` (problem) | collection counts, invalid-document counts per type | `game.issues.validationFailures` |
| `env.ui` | core `fontScale`, `uiScale`, `colorScheme`; this module's look, theme and preset ids; computed `--acks-fs-base` | settings and computed style |
| `window` | the probe, below | `measureWindow` |
| `log` | `{since, dropped, entries[]}`; an entry is `{src, phase, t, last, n, pkg, where, type, msg, cause[], stack[]}` | the ring |
| `sections` | contributions from the lib registry: `books`, `corrections` | `registerFeedbackSection` |
| `picture` | slice 2 | |
| `scrub` | `{rules: "acks-feedback-scrub/1", counts}` | the scrub |

What each kind carries:

| Field | problem | correction | suggestion |
|---|---|---|---|
| title | required | automatic | required |
| what / idea | what, required | a reason per item, required | idea, required |
| expected, steps | optional | none | none |
| log | on, untick to leave out | off, tick to include | off, tick to include |
| env | full | versions and ui | versions only |
| window probe | when a window is chosen | off | optional |
| books | when any is open | on | off |
| corrections | none | at least one item | none |
| picture (slice 2) | optional | none | optional |

A docs gap arrives as a problem; the triage's own disposition sorts it.

### "Anonymous", mechanically

The scrub runs when a bundle is built, over every free-text string of the
log, since no name is loaded at `init`. In order:

1. URL origins and `file://` are removed; `location` is never read.
2. `/modules|systems/<id>/…` and core `/scripts/…` paths stay;
   `/worlds/<x>/` becomes `/worlds/<world>/`; an OS-absolute path becomes
   `<path>`.
3. Foundry ids and uuids become `id1`, `id2`, …, stable within one bundle.
4. A dictionary pass, longest first, case-insensitive, whole-word, three
   characters or more: every user name becomes `<user>`; the world id and
   title become `<world>`; every document name this client can read (world
   collections, folders, embedded items of world actors, journal pages,
   every loaded pack index) becomes `<name>`.
5. A quoted span of three characters or more becomes `"<n chars>"`, which
   takes text read off a page that a message quotes.

Never present: user names or ids, world id or title, host, a PDF's
metadata title, a PDF's file name or shelf path, any setting outside the
`ui` whitelist.

**Open design point, settled in 1a before the scrub is built: the
dictionary's reach.** Steps 4 and 5 as written can leave a log useless.
Many imported documents are named with common words, so a whole-word pass
over every pack index replaces those words wherever an engine message uses
them; and an engine error quotes the property or type name it failed on,
which step 5 blanks. Session 1a measures both on the test world before it
fixes the rule: build a bundle from stock engine errors (an undefined
property read, a failed validation, a missing type) with the world's real
dictionary loaded, and count what was replaced. The candidates to choose
among, with the count beside each: names of two words or more only; world
documents only, not pack indexes; no replacement inside a stack frame or an
engine-authored message (`src` of `hook` with a core `where`); quoted
spans kept when they are an identifier (`[\w.$-]+`). The offline suite
then pins the choice with common-word names against stock engine error
text, where invented names alone cannot fail.

**Residual:** text a message interpolates unquoted that equals no document
name gets through. Three mitigations: a per-entry exclude tick in the
preview, a "GitHub issues are public" line on that route, and slice 1d's
helper contract (a fixed sentence as the message, names in unrecorded
`refs`).

### The recorder

- `scripts/lib/feedback-logic.mjs`, pure: `createLogRing`,
  `entryFromError`, `reduceFrame`, `scrubText`, `buildFeedback`,
  `renderFeedback`, `encodeBlock`, `parseBlocks`, `issueUrl`,
  `probeVerdict`.
- `scripts/lib/feedback-recorder.mjs` imports only `constants.mjs` and the
  logic file, and is the FIRST import of `scripts/module.mjs`, above
  `./lib/module.mjs`.
- Sources: the Foundry `error` hook (every package's hook-callback throws
  and core's own `Hooks.onError` sites), `window` `error` in the bubble
  phase, `unhandledrejection`, and `logFailure(where, msg, err)`, which
  writes the ring and then calls `console.error` with the same
  `${MODULE_ID} | ${msg}` text.
- A listener body never throws. `Hooks.once` on `init`, `setup` and
  `ready` moves `phase`.
- An entry keeps `msg` to 500 characters, three causes of 200, ten frames
  cut to `pkg/relative/path.mjs:line:col fn`, `location`, and `data.hook`.
  Dedupe key `src|where|type|msg[0..200]|top frame`; a repeat raises `n`.
- Bound: 20 `boot` entries (before `ready` plus two seconds) never
  evicted, 80 `play` entries first-in first-out, a `dropped` counter.
- A debounced write to `sessionStorage["acks-extras.feedback.ring"]`
  carries the ring across F5; the previous load's entries are offered as
  "previous" and cleared after one load or one built bundle.
- Not covered: a link failure of the module's own graph (slice 6), and a
  handled failure whose site still calls `console.error` directly (slice
  1d migrates about 311 sites; 107 are in the importer).

### The window probe

`measureWindow(app)` records a chosen window's classes, document type,
tokenized id, position, viewport, active tabs, part ids, font sizes,
`.window-content` scroll height against client height and its
`overflow-y`, up to 20 clipped descendants, the count of content outside
the frame, and `detached`. `probeVerdict` names the measurable
`ui-layout.md` failures: cut off, clipped, fits. It is realm-safe
(`nodeType` and `matches`, never `instanceof`), and tells a foreign window
by `options.classes`, since the system build is minified.

### Corrections

- Every `heldEdit` producer's document carries
  `flags[MODULE_ID].cookbook`, so `heldEdit` grows no field. The locator
  is resolved from the edit's uuid in a new
  `scripts/importer/corrections.mjs`.
- Three producers pass `uuid: doc.uuid ?? ""` (`target.mjs`'s `heldRoster`
  and `keepsJudgeFigure`, `adventure-places.mjs`'s `marketTakes`). An edit
  whose uuid is empty or resolves to no document is an unlocated item,
  never a thrown error; slice 1b's locator test covers both.
- An item: `entry` (the shipped cookbook entry the document's claim
  resolves to, through `rebuild.mjs`'s `entryUnder` exported as
  `shippedEntryOf`; null when it resolves to none, shown as unlocated),
  `rowed` (the claim differs from the entry; the suffix never rides, since
  it is a slug of a label read off the page), `kind`, `book` (a registry
  id, else `"registered"`), `path`, `cite`, `unstamped`, `docType`,
  `shape` per side (`{kind: empty|rows|text|number|object, n?, chars?}`),
  `relation`, `reason`, `note`.
- `relation` comes from a new pure `editRelation(current, page)` in
  `held-edits.mjs`: `appended`, `prepended`, `whitespace`, `markup`,
  `emptied`, `filled`, `replaced`, `rowsAdded`, `rowsRemoved`,
  `rowsChanged` (up to 20 row indices), `higher`, `lower`, `changed`.
- `reason` is picked per item and required: `misread` rides by default;
  `house` and `play` ride only when ticked.
- Never in an item: `current`, `page`, a checksum of either, the
  document's name, or the flag's `printed`, `bookLabel`, `sum`, `sums` or
  `read`. The flag is never copied whole.
- `books` section: each open book as `{book, pages, titleFits,
  identified}` from a new `openBookPrints()` in `importer/module.mjs`. The
  raw metadata title never rides.
- **Seam.** `chooseHeldEditsDialog` gains one unticked checkbox,
  `name="report"`, shown when there are edits; `decisionFrom` returns
  `{take, pregens, report}`. `mergedRepair` adds `offer: chosen?.report
  === true` to its result and stays Foundry-free. `rebuild.mjs`'s
  `runMerged`, on the human branch only (no tally, no decision, no
  `choose` passed), stashes the standing edits for the session and, when
  `offer`, opens the window on kind `correction` without awaiting it. An
  API call, an unattended run and a walk meet no prompt. The window's
  correction kind also lists the stash.

### Entry points and seats

1. `registerMenu(MODULE_ID, "feedback", {restricted: false, type:
   FeedbackMenu})` beside `repairTool`: Settings tab → Game Settings →
   ACKS II — Extras → Send feedback.
2. A header control through `getHeaderControlsApplicationV2` on a module
   window, not on a `DialogV2` and not on the feedback window; it
   preselects that window.
3. A "Send Feedback" macro in `tools/pack-data/lib.mjs`.
4. The held-edits checkbox.
5. `acksExtras.lib.feedback.open({kind, appId, edits})`.

Problem and suggestion on any seat; correction when `game.user.isGM`.

### The receiving half

- Module-owned, in the same release as the window: `bug_report.yml` gains
  a textarea `id: feedback-bundle`; a new
  `.github/ISSUE_TEMPLATE/suggestion.yml` (label `suggestion`);
  `tools/feedback-read.mjs`, which prints a ledger-ready summary and never
  writes the ledger; the site page
  `docs/site/src/content/docs/start/report-a-bug.md` opens with "From
  inside Foundry" and gains a Suggestions section.
- Synced canon, edited in `acks-module-template` and synced (Q4):
  `acks-bug-triage/SKILL.md` gains the bundle as a third intake source
  (source label `fb:<id>`; one row per problem or suggestion and one per
  correction item; a correction is disposed by re-reading its entry on the
  owner's own copy), widens `style-feedback` to "a preference or a
  suggestion", and names the window and the new form.

### Pictures (slice 2)

Slice 1 ships the probe. The picture is a vendored DOM-to-image library
run on the chosen window's element alone, with the scrub applied to the
clone. `getDisplayMedia` is rejected: Foundry's desktop shell registers no
display-media handler, it prompts every time, and it grabs whatever
overlaps the window. Only the chosen window is captured, so the players
list, chat and world title are absent by construction; user names and the
world title in the clone's text are replaced; `.acks-extras-held-value`
cells and `[data-feedback-mask]` elements are blanked. Imported content
may appear (`ip-doctrine.md`, "app-licensed in-app content"). A correction
takes no picture. A detached window is refused with a reason. Any failure
records `picture: {error}` and the bundle still builds. The PNG rides as
base64 inside the machine block. Slice 2 opens with a proof in the desktop
app and in a browser before anything more is specified.

## Slices

Tree: `topic/feedback`, in the sibling worktree
`foundryvtt-acks-extras.feedback`, opened with `acks-branch`. The release
kind is the owner's to declare; the new surface is a minor's tripwire.

| Slice | What | Agent | Blocked on |
|---|---|---|---|
| 1a | The lib window, problem and suggestion kinds, recorder, scrub, probe, `.txt` container, reader tool, both issue forms, site page | `implementer` (sonnet): fully specified here | none |
| 1b | Corrections: the held-edits checkbox, `corrections.mjs`, `editRelation`, `openBookPrints`, the rebuild path's failure sites moved to `logFailure` | `implementer` | 1a |
| 1c | The triage skill in the template, then a sync | `implementer`, in the template repo | Q4 |
| 1d | The remaining `console.error` sites moved to `logFailure`, a file at a time | `scout` (haiku) enumerates, skipping files an open topic touches; `implementer` applies | 1a |
| 2p | The picture proof: each candidate library run by hand from the console on one module sheet, in the desktop app and in a browser, the PNG looked at; fonts, icons, form values and a cross-origin image each noted as drawn or lost. Nothing is vendored or committed | the session that walks 1a, after its walk | 1a |
| 2 | The picture | `architect` (opus) rules on the library from 2p's result; `implementer` builds | 2p |
| 3 | A Discord intake bot or a relay on the owner's side | `architect` first | Q2 |
| 4 | Value-carrying private bundles | `architect` first | Q3 |
| 5 | A player's report gains the GM's sections over `lib/sockets.mjs` | `architect` first | none; low priority |
| 6 | A load-failure recorder: a second `esmodules` entry with no imports | `architect` first; it supersedes the single-entry claim in `scripts/module.mjs` | none |
| 7 | A scene picture through the renderer's extract | later | 2 |

### Slice 1a, files

Add: `scripts/lib/feedback-logic.mjs`, `feedback-recorder.mjs`,
`feedback.mjs` (`collectEnvironment`, `scrubDictionary`, `measureWindow`,
`registerFeedbackSection({id, kinds, gmOnly, collect})`,
`installFeedbackControl`, `openFeedback`),
`scripts/lib/apps/feedback-app.mjs` (`FeedbackApp`, `FeedbackMenu`;
classes `acks-ui acks-extras acks-extras-scroll acks-extras-feedback`;
parts `form`, `preview`, `footer`, the footer pinned as in
`repair-app.mjs`), `templates/lib/feedback{,-preview,-footer}.hbs`, CSS in
`styles/lib.css` on ramp variables, `tools/test-feedback.mjs`,
`tools/feedback-read.mjs`, `.github/ISSUE_TEMPLATE/suggestion.yml`, a
`changelog.d` fragment.

Change: `scripts/module.mjs` (the first import and its header comment),
`scripts/lib/module.mjs` (menu, header control, API),
`scripts/lib/README.md`, `lang/en.json` (`ACKS-LIB.feedback.*`),
`tools/pack-data/lib.mjs` (the macro), `bug_report.yml`, the site page,
`docs/lib/{MODEL,DECISIONS,TESTING}.md`.

Offline tests, on invented names only: the scrub; the ring (dedupe, boot
pin, caps, cause chain); the frame reducer on Chrome, Firefox and minified
frames; the block round trip; machine fields appear only inside the block;
`issueUrl` uses only ids parsed from both forms and stays under its cap;
the no-network grep; required fields per kind.

### Slice 1a, the walk (for `docs/lib/TESTING.md`)

Fixture: `feedback/named-actor`, an actor with an invented name, kept.

1. Boot capture: a script registered before the document loads throws in
   `setup`, then reload. One entry with phase `setup`.
2. A hook that throws twice. One entry with `n` of 2.
3. An Error naming the fixture actor, the world title, a uuid and the
   origin. None of the four is in the preview.
4. A module sheet opened, its header control pressed, the sheet shrunk.
   The probe line says cut off.
5. Copy, then read the clipboard: it equals the preview. Save, then the
   reader tool: the same id and kind.
6. The GitHub press: the query keys are the form's field ids and the
   fields fill. This step proves the prefill, which is inferred today.
7. A player seat: the menu shows, correction is absent, the role is the
   player's.
8. F5: the previous load's entries are offered.

### Not verified, and where it gets checked

- The source claims in "Design" marked by no file path of the planning
  session's own reading are the architect's report: the 296 and 166
  call-site counts, the `flags[MODULE_ID].cookbook` stamp on every
  producer's document, core's `SupportDetails` and settings-menu
  behaviour, and the absence of a zip writer in core. The session that
  builds on one reads it first.
- GitHub prefills an issue-form field from a query key equal to its `id`
  (walk step 6), and a textarea takes a dropped `.txt` (the same step).
- Discord turns a long paste into a text attachment (by hand, once Q1 is
  answered).
- `getDisplayMedia` fails in the desktop app; the candidate libraries
  offer a per-node clone hook (slice 2's proof).
- The probe answers most layout reports: no corpus of past reports was
  read.

## The strongest objection

**"Still not as easy as a PM, and not organized." Strong.** Nothing names
a Discord destination, so the DM route has no address, and a text file in
a DM is one more attachment the owner carries to a session by hand; slice
1 organizes each bundle and no queue. Q1 answers the first half. Q2
answers the second: a bot on the owner's side that watches one channel,
parses each dropped file with `parseBlocks` and files a tagged thread,
with no credential in the module and no module change.

A second, moderate: a locator-only correction cannot be reproduced when
the owner's printing differs from the reporter's. The `books` section
flags the mismatch; Q3 answers it for private bundles.

## Start prompt, session 1a

The session runs on the planning session's own model, the strongest
available: it settles the scrub's reach from a measurement, judges what
its walk shows and reviews two agents' work against the IP line, none of
which is `implementer` work. Its agents are the synced ones, started with
no override. It shares `main`'s checkout and opens the topic's worktree
with `acks-branch`; the app's own worktrees are refused by the branch
guard.

> You are the orchestrator for slices 1a and 1b of
> `docs/lib/wip/20261115-feedback-intake-plan.md` in
> `C:\Proj\foundryvtt-acks-extras`. Read that file whole, then `CLAUDE.md`,
> `.claude/rules/{shared-tree,ip-doctrine,ui-layout,ui-tooltips,live-testing,docs-doctrine}.md`
> and `scripts/lib/README.md`. The owner's two messages are quoted in the
> plan; every brief you write quotes them in those words, and each agent
> restates them with one example before it builds.
>
> Open `topic/feedback` with `acks-branch`. Before any agent writes under
> `scripts/lib/` or `scripts/importer/`, list the running sessions, read
> their latest turns and `main`'s dirty paths, and say in one line what you
> found. Settle the scrub's reach first, by the measurement the plan's
> "Open design point" names, and write the rule you chose into the plan.
> Build 1a with one `implementer` (no model override), to the
> plan's file list and offline tests, to an offline green on the branch.
> Land it with `branch.mjs land`, then drive the plan's eight-step walk
> yourself on `main` through `tools/live` (the `live-tester` agent is not
> used), and commit what the walk finds on `main` with `acks-commit`. Run
> slice 2p, the picture proof, after that walk and record what each
> candidate drew and lost. Then
> build 1b with a fresh `implementer`, land and walk it the same way. The
> defaults in the plan's question table hold unless the owner has answered
> since; check the plan's "Owner answers" section first. Nothing is
> pushed, and no release is cut, without the owner's word.
>
> Finish by appending "Results, 1a and 1b" to the plan (built, exercised
> live, offline only, not checked, each by sha), correcting the start
> prompt for the next slice, and reporting to the owner. You start no
> session.

## Owner answers

None yet.

## Results

None yet.
