# Decision record — repo level

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force

- undated — [The merge (0.1.0, 2026-07)](DECISIONS-through-v11.14.5.md#the-merge-010-2026-07)
- undated — [1. Flag key collisions — RESOLVED (flat namespace)](DECISIONS-through-v11.14.5.md#1-flag-key-collisions--resolved-flat-namespace)
- undated — [2. `EFFECT_PREFIX` collapse — RESOLVED](DECISIONS-through-v11.14.5.md#2-effect_prefix-collapse--resolved)
- undated — [3. `stackSignature` — NOT NEEDED (namespace stayed flat)](DECISIONS-through-v11.14.5.md#3-stacksignature--not-needed-namespace-stayed-flat)
- undated — [4. `Actor.location` declared twice — RESOLVED](DECISIONS-through-v11.14.5.md#4-actorlocation-declared-twice--resolved) — superseded in part by "The merge (0.1.0, 2026-07)", its 2026-08-02 addendum
- undated — [4b. Import cycles — pre-existing, not merge-caused](DECISIONS-through-v11.14.5.md#4b-import-cycles--pre-existing-not-merge-caused)
- undated — [5. `Item.attitude` had no type label — FIXED](DECISIONS-through-v11.14.5.md#5-itemattitude-had-no-type-label--fixed)
- undated — [6. The importer references a lang key it does not own — CORRECT AS IS](DECISIONS-through-v11.14.5.md#6-the-importer-references-a-lang-key-it-does-not-own--correct-as-is)
- undated — [7. `TYPES` labels lost a disambiguator — intentional](DECISIONS-through-v11.14.5.md#7-types-labels-lost-a-disambiguator--intentional)
- undated — [8. formation and influence had no `tools/pack-data.mjs` — RESOLVED](DECISIONS-through-v11.14.5.md#8-formation-and-influence-had-no-toolspack-datamjs--resolved)
- undated — [10. `npm run validate` — RESOLVED, and now carries merge guards](DECISIONS-through-v11.14.5.md#10-npm-run-validate--resolved-and-now-carries-merge-guards) — superseded in part by "The merge (0.1.0, 2026-07)", its 2026-08-02 addendum
- undated — [9. Macros — RESOLVED](DECISIONS-through-v11.14.5.md#9-macros--resolved)
- undated — [12. Single-branch development — RESOLVED (isolation off, guard on)](DECISIONS-through-v11.14.5.md#12-single-branch-development--resolved-isolation-off-guard-on) — superseded in part by "2026-11-12 — Topic and parked branches return, opened and landed by one tool" (acks-module-template docs/DECISIONS.md)
- undated — [13. The Patreon link — header icon and one footer line](DECISIONS-through-v11.14.5.md#13-the-patreon-link--header-icon-and-one-footer-line)
- undated — [14. The site's stale sections, and the two guards that end them](DECISIONS-through-v11.14.5.md#14-the-sites-stale-sections-and-the-two-guards-that-end-them)
- undated — [15. Domains at War: Battles is out of scope — interop, not resolution](DECISIONS-through-v11.14.5.md#15-domains-at-war-battles-is-out-of-scope--interop-not-resolution)
- undated — [16. The importer joins — RESOLVED (2026-09-01)](DECISIONS-through-v11.14.5.md#16-the-importer-joins--resolved-2026-09-01) — superseded in part by "2026-11-13 — Only what the module and the current system write is served"
- undated — [17. A free variable fails validate (2026-09-17)](DECISIONS-through-v11.14.5.md#17-a-free-variable-fails-validate-2026-09-17)
- undated — [18. A guide links another by its file, and the site re-points the link (2026-10-01)](DECISIONS-through-v11.14.5.md#18-a-guide-links-another-by-its-file-and-the-site-re-points-the-link-2026-10-01)
- undated — [19. The settings reference names every feature that registers a setting (2026-10-01)](DECISIONS-through-v11.14.5.md#19-the-settings-reference-names-every-feature-that-registers-a-setting-2026-10-01)
- undated — [20. Prose names a compendium pack only while the manifest declares it (2026-10-01)](DECISIONS-through-v11.14.5.md#20-prose-names-a-compendium-pack-only-while-the-manifest-declares-it-2026-10-01)
- undated — [21. The compendia reference lists what an import leaves (2026-10-01)](DECISIONS-through-v11.14.5.md#21-the-compendia-reference-lists-what-an-import-leaves-2026-10-01)
- undated — [22. Prose names a macro only while the pack holds it (2026-10-06)](DECISIONS-through-v11.14.5.md#22-prose-names-a-macro-only-while-the-pack-holds-it-2026-10-06)
- undated — [23. Interface text and comments name a macro only while the pack holds it (2026-10-06)](DECISIONS-through-v11.14.5.md#23-interface-text-and-comments-name-a-macro-only-while-the-pack-holds-it-2026-10-06)
- undated — [24. The suites and the child checks run side by side (2026-10-08)](DECISIONS-through-v11.14.5.md#24-the-suites-and-the-child-checks-run-side-by-side-2026-10-08)
- undated — [25. The macro pack is launchers (2026-10-28)](DECISIONS-through-v11.14.5.md#25-the-macro-pack-is-launchers-2026-10-28)
- undated — [26. The module map and the API reference are generated, published and shipped (2026-11-10)](DECISIONS-through-v11.14.5.md#26-the-module-map-and-the-api-reference-are-generated-published-and-shipped-2026-11-10) — superseded in part by "2026-11-10 — The developer reference is on the site only"
- undated — [27. The developer reference is on the site only (2026-11-10)](DECISIONS-through-v11.14.5.md#27-the-developer-reference-is-on-the-site-only-2026-11-10)

Toolchain rulings made in `acks-module-template` before it was folded into this repo (2026-11-18), as its `docs/DECISIONS.md` held them at `a85dd50`:

- 2026-08-04 — [A shared check must report what it checked](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-08-04--a-shared-check-must-report-what-it-checked--in-force)
- 2026-08-01 — [Eight modules become one](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-08-01--eight-modules-become-one--in-force)
- 2026-07-19 — [No value read from a book ships in any repo](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-07-19--no-value-read-from-a-book-ships-in-any-repo--in-force)
- 2026-07-16 — [Rules extracts never enter a repo](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-07-16--rules-extracts-never-enter-a-repo--in-force)
- 2026-07-19 — [Compiled packs are build output, not source](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-07-19--compiled-packs-are-build-output-not-source--in-force)
- 2026-08-05 — [The worktree that renamed a repo, and the sync that ran ahead of the push](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-08-05--the-worktree-that-renamed-a-repo-and-the-sync-that-ran-ahead-of-the-push--in-force-except-the-single-branch-guards-scope-superseded-in-part-2026-11-12) — except the single-branch guard's scope (superseded in part 2026-11-12); its sync half superseded 2026-11-18 (the template is folded in)
- 2026-09-01 — [Two modules become one](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-01--two-modules-become-one--in-force)
- 2026-08-15 — [Math may ship; the book's words may not](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-08-15--math-may-ship-the-books-words-may-not--in-force-except-its-citation-clause-superseded-2026-09-03) — except its citation clause (superseded 2026-09-03)
- 2026-08-19 — [The soak rules are removed; the recipe walk is the whole gate](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-08-19--the-soak-rules-are-removed-the-recipe-walk-is-the-whole-gate--in-force) — except the gate itself, which is the smoke walk (superseded in part 2026-11-26)
- 2026-09-03 — [The page reference ships; removing it protected nothing](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-03--the-page-reference-ships-removing-it-protected-nothing--in-force)
- 2026-09-05 — [Teardown is by the run's own ids; the prose that said so did not hold](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-05--teardown-is-by-the-runs-own-ids-the-prose-that-said-so-did-not-hold--in-force-except-a-sweep-at-the-end-of-every-run-superseded-2026-10-26) — except a sweep at the end of every run (superseded 2026-10-26)
- 2026-09-07 — [The window contract gates what a caption can reach, not only what a window can scroll](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-07--the-window-contract-gates-what-a-caption-can-reach-not-only-what-a-window-can-scroll--in-force)
- 2026-09-23 — [A template calls only helpers something registers](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-23--a-template-calls-only-helpers-something-registers--in-force)
- 2026-09-23 — [The namespace check reads helpers through §2b's reader](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-23--the-namespace-check-reads-helpers-through-2bs-reader--in-force)
- 2026-09-23 — [The namespace check reads globals and hooks where they are written](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-23--the-namespace-check-reads-globals-and-hooks-where-they-are-written--in-force)
- 2026-09-24 — [The long-literal warning measures literals](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-24--the-long-literal-warning-measures-literals--in-force)
- 2026-09-24 — [`tokenizeJs` tells a regex from a division by the scanner's rules](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-09-24--tokenizejs-tells-a-regex-from-a-division-by-the-scanners-rules--in-force)
- 2026-10-01 — [The capture driver keeps its page in front and its tray out of frame](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-01--the-capture-driver-keeps-its-page-in-front-and-its-tray-out-of-frame--in-force)
- 2026-10-01 — [A DOM node is not told by `instanceof`](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-01--a-dom-node-is-not-told-by-instanceof--in-force)
- 2026-10-07 — [A commit on a shared tree is one session's hunks, gated as the tree it commits](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-07--a-commit-on-a-shared-tree-is-one-sessions-hunks-gated-as-the-tree-it-commits--in-force)
- 2026-10-07 — [A worktree or a branch per session is rejected, and what is left lands as tools](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-07--a-worktree-or-a-branch-per-session-is-rejected-and-what-is-left-lands-as-tools--in-force-except-the-rejected-trial-for-sessions-that-walk-nothing-live-superseded-in-part-2026-11-12) — except the rejected trial for sessions that walk nothing live (superseded in part 2026-11-12)
- 2026-10-07 — [A retired update key fails where it is written and passes where it is read](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-07--a-retired-update-key-fails-where-it-is-written-and-passes-where-it-is-read--in-force)
- 2026-10-07 — [A release push the remote rejects is repeated whole, inside a bound](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-07--a-release-push-the-remote-rejects-is-repeated-whole-inside-a-bound--in-force)
- 2026-10-07 — [The edit ledger and the shared-tree guard](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-07--the-edit-ledger-and-the-shared-tree-guard--in-force-except-a-line-changed-and-changed-back-and-a-division-that-keeps-no-added-line-superseded-2026-10-13-a-tie-of-added-lines-the-ledger-can-place-superseded-2026-10-14-and-a-tie-each-of-whose-places-names-this-change-superseded-2026-10-17) — except a line changed and changed back, and a division that keeps no added line (superseded 2026-10-13), a tie of added lines the ledger can place (superseded 2026-10-14), and a tie each of whose places names this change (superseded 2026-10-17)
- 2026-10-08 — [The landing lease, and a gate whose serial work runs side by side](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-08--the-landing-lease-and-a-gate-whose-serial-work-runs-side-by-side--in-force)
- 2026-10-10 — [The commit-time gate judges what the commit would hold, and the quarantine has a suite](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-10--the-commit-time-gate-judges-what-the-commit-would-hold-and-the-quarantine-has-a-suite--in-force)
- 2026-10-10 — [The pre-commit hook is committed as an executable file, and the commit tool, the sync and the scaffolder each hold it there](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-10--the-pre-commit-hook-is-committed-as-an-executable-file-and-the-commit-tool-the-sync-and-the-scaffolder-each-hold-it-there--in-force) — the sync's and the scaffolder's halves superseded 2026-11-18 (the template is folded in)
- 2026-10-13 — [A session that changed a line and changed it back has no claim on it, and a line a peer wrote over is not carved into a removal](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-13--a-session-that-changed-a-line-and-changed-it-back-has-no-claim-on-it-and-a-line-a-peer-wrote-over-is-not-carved-into-a-removal--in-force-except-a-line-its-own-writer-took-out-before-it-landed-superseded-2026-10-14) — except a line its own writer took out before it landed (superseded 2026-10-14)
- 2026-10-13 — [A commit the hook is not asked about is read by nothing, and no reader is built for it](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-13--a-commit-the-hook-is-not-asked-about-is-read-by-nothing-and-no-reader-is-built-for-it--in-force)
- 2026-10-14 — [A ledger record names the commit HEAD was at, and a line withdrawn before it landed has no claim on one that landed](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-14--a-ledger-record-names-the-commit-head-was-at-and-a-line-withdrawn-before-it-landed-has-no-claim-on-one-that-landed--in-force)
- 2026-10-14 — [A hunk of added lines that ties across another writer's line is one session's where the ledger shows its lines unlanded and the rest HEAD's](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-14--a-hunk-of-added-lines-that-ties-across-another-writers-line-is-one-sessions-where-the-ledger-shows-its-lines-unlanded-and-the-rest-heads--in-force-except-its-cost-line-on-a-tie-it-cannot-settle-superseded-2026-10-17) — except its cost line on a tie it cannot settle (superseded 2026-10-17)
- 2026-10-14 — [The commit tooling is frozen, a landing is one command, and a release reads git](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-14--the-commit-tooling-is-frozen-a-landing-is-one-command-and-a-release-reads-git--in-force-except-ruling-2s-push-superseded-2026-10-17) — except ruling 2's push (superseded 2026-10-17)
- 2026-10-17 — [A session commits finished work unasked, and a commit stays local until the owner says push](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-17--a-session-commits-finished-work-unasked-and-a-commit-stays-local-until-the-owner-says-push--in-force)
- 2026-10-17 — [A tie the ledger cannot place is this change's where every place is, and refused where every place holds a line of it beside another's](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-17--a-tie-the-ledger-cannot-place-is-this-changes-where-every-place-is-and-refused-where-every-place-holds-a-line-of-it-beside-anothers--in-force)
- 2026-10-17 — [The commit tool lists a removed path under its own name, whatever git would pair it with](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-17--the-commit-tool-lists-a-removed-path-under-its-own-name-whatever-git-would-pair-it-with--in-force)
- 2026-10-24 — [Every figure carries a tooltip that says where it came from](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-24--every-figure-carries-a-tooltip-that-says-where-it-came-from--in-force)
- 2026-10-26 — [A fixture, once built, stays; only a check of setup deletes one](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-26--a-fixture-once-built-stays-only-a-check-of-setup-deletes-one--in-force)
- 2026-10-28 — [The driver finds a kept fixture by its marker; a session's own is the recipe's marker with `@<tag>`, and a marker on two documents stops the run](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-28--the-driver-finds-a-kept-fixture-by-its-marker-a-sessions-own-is-the-recipes-marker-with-tag-and-a-marker-on-two-documents-stops-the-run--in-force)
- 2026-10-29 — [A run's own leavings are its own to remove; the 2026-10-26 ruling relaxed the asking and preserved nothing](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-10-29--a-runs-own-leavings-are-its-own-to-remove-the-2026-10-26-ruling-relaxed-the-asking-and-preserved-nothing--in-force)
- 2026-11-06 — [The disclaimer carries no registration number](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-06--the-disclaimer-carries-no-registration-number--in-force)
- 2026-11-10 — [The developer reference is published, not shipped](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-10--the-developer-reference-is-published-not-shipped--in-force)
- 2026-11-12 — [One slice per agent, about ten ledger rows per session](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--one-slice-per-agent-about-ten-ledger-rows-per-session--in-force)
- 2026-11-12 — [Unpushed commits are named at the end of a turn](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--unpushed-commits-are-named-at-the-end-of-a-turn--in-force) — the template beside the checkout superseded 2026-11-18 (the template is folded in)
- 2026-11-12 — [The release workflow scans the tree once](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--the-release-workflow-scans-the-tree-once--in-force)
- 2026-11-12 — [A release is versioned by its day](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--a-release-is-versioned-by-its-day--in-force)
- 2026-11-12 — [Changelog fragments, and a major rolls the logs](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--changelog-fragments-and-a-major-rolls-the-logs--in-force) — except that a roll is run on the owner's ask and no release waits on it (superseded in part 2026-11-26)
- 2026-11-12 — [A later roll carries the live index forward](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--a-later-roll-carries-the-live-index-forward--in-force)
- 2026-11-12 — [A tag needs a recorded walk result for every required walk](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--a-tag-needs-a-recorded-walk-result-for-every-required-walk--in-force) — except that the smoke walk is the only required walk, and it alone is held to the runtime tree (superseded in part 2026-11-26)
- 2026-11-12 — [A release commits before its live session and tags its docs commit](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--a-release-commits-before-its-live-session-and-tags-its-docs-commit--in-force-r15s-by-procedure-qualified-2026-11-15-a-topics-landing-is-guarded) — R15's "by procedure" qualified 2026-11-15 (a topic's landing is guarded); there is no docs commit, and the tag is on the release commit (superseded in part 2026-11-26)
- 2026-11-12 — [Topic and parked branches return, opened and landed by one tool](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--topic-and-parked-branches-return-opened-and-landed-by-one-tool--in-force-except-which-work-takes-a-branch-superseded-in-part-2026-11-15) — except which work takes a branch (superseded in part 2026-11-15)
- 2026-11-12 — [A new phase is a clean session, its own orchestrator](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-12--a-new-phase-is-a-clean-session-its-own-orchestrator--in-force)
- 2026-11-14 — [A field with nothing imported stays blank](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-14--a-field-with-nothing-imported-stays-blank--in-force)
- 2026-11-15 — [Every agent and session starts on a model chosen for its work](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-15--every-agent-and-session-starts-on-a-model-chosen-for-its-work--in-force)
- 2026-11-15 — [A new feature is built on a topic branch](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-15--a-new-feature-is-built-on-a-topic-branch--in-force)
- 2026-11-15 — [A topic is synced between landings, and `land` keeps its lease and the release window](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-15--a-topic-is-synced-between-landings-and-land-keeps-its-lease-and-the-release-window--in-force)
- 2026-11-16 — [A UI element is designed and approved before it is built](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-16--a-ui-element-is-designed-and-approved-before-it-is-built--in-force)
- 2026-11-18 — [Work is checked twice: its unit suites, and the land's gate](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-18--work-is-checked-twice-its-unit-suites-and-the-lands-gate--in-force-its-measured-paragraph-superseded-in-part-2026-11-18) — its "Measured" paragraph SUPERSEDED IN PART 2026-11-18
- 2026-11-18 — [A change.json key the tool ignores, or a file it leaves, is refused](https://github.com/NocTempre/acks-module-template/blob/a85dd503534ec040653930309ad6a2860944c23d/docs/DECISIONS.md#2026-11-18--a-changejson-key-the-tool-ignores-or-a-file-it-leaves-is-refused--in-force)

## 2026-11-13 — 28. The walk runner records every walk; suites are discovered

**Problem.** The template's release preflight now refuses a tag while a
required walk has no current result in `aia-tmp/live/walk-results.json`
(template DECISIONS, 2026-11-12, "A tag needs a recorded walk result for every
required walk"). This repo's runner kept no verdict past the console, 52 of
its 65 walks set their exit status as `passed === checks.length ? 0 : 1`, so a
walk that ran no check exited 0, and `run-tests.mjs` named its 205 suites by
hand.

**Ruled.** The module's half, built to that entry's contract:

- `tools/live/run.mjs` records each attempt through the synced
  `tools/walk-results.mjs`, and exits 0 only when every walk it ran reduced to
  `passed`. Before, a walk that exited 0 with no FAIL read green whether or
  not it reached its end. `--list` shows each record and whether it is still
  current; `--classify` puts a ledger row on a non-pass, reading the ledger
  from `ACKS_BUG_LEDGER`, a machine variable, so no ledger path enters the
  repo.
- `partial` is set for every walk of a run whose environment carries a
  variable that narrows a walk (`PARTIAL_VARS` in `run.mjs`), even a walk that
  ignores it: a subset recorded as the whole costs more than a whole recorded
  as a subset.
- Each walk prints `WALK END` through `tools/live/_walk.mjs` `walkDone()` as
  the last statement of its `try`, and `WALK BLOCKED:` through `blocked()`
  where a seat is not its own. Only that condition was converted: a missing
  seat user, an unimported book and a fixture in the wrong shape stay errors,
  because each can also be the code's fault. `validate-extra.mjs` §4b fails a
  walk that does not call `walkDone()` exactly once.
- `run-tests.mjs` finds its suites by glob (`tools/test-*.mjs`,
  `tools/importer/test-*.mjs`, `discord/test/*.test.mjs`) beside an exclude
  list whose entries must name files that exist. Discovery added three
  discord suites nobody had listed. The eight OSE importer suites are
  excluded, since `tools/importer/validate-extra.mjs` already runs them.
- The owner's R17, "The local-only rules tests run once on the working tree
  after step 5's precheck, by a `run-tests` flag P2 adds": `--rules`, as
  `npm run test:tree`, fails when `tools/rules-tests/` is absent or empty.
- `audit-imports.mjs` runs as validate-extra §11 and fails validation.
  `audit-styles.mjs` runs as §12 and reports its count without failing. It
  carries 54 open findings, and its header had claimed a validate run that
  never existed.

**Cost.** A run with `STAGE` set reads partial, and three walks cover less
than the whole by default: henchmen's second stage and monsters-leaders'
stages 4–7 run only with `STAGE` set, and markets with `STAGE` set prints no
`WALK END`. That is ledger row T-0523. Exit 4 is new: the runtime tree could
not be read or a result could not be recorded. A peer's runtime edit during
a walk marks it as changed during its run.

## 2026-11-13 — 29. Only what the module and the current system write is served

**Ruled** (owner, 2026-11-12, for the Public Beta release): "Legacy support
out." It follows the owner's 2026-11-11 words for the close-out, "cancel any
new time on tools designed to repair previous versions" and "Repair broken
imports is not the same as fix previous versions of imports. The former is
still approved." Amended the same day, after the `acks` 14.1.0 migration
runner was found to write only its stamp: `lib/patches/legacy-source.mjs`
and the `lib.stampedRecords` repair check stay, because worlds on the current
system still hold the old record shape. **Superseded 2026-11-24** (this
amendment only): both are deleted, since `acks` 14.2.0's migration repairs the
record itself; the lib ruling of that date, in `docs/lib/DECISIONS.md`, names
the evidence.

**The test.** Each item was read, not judged by its comment: who calls it,
and whether anything the current module or the current `acks` system still
writes the shape it handles. What only an earlier version of this module (or
one of the standalone modules merged into it) wrote is removed, with no
migration in its place. What the current system or the current module still
produces stays, under whatever name it carries.

**Removed:**

- The carry-over from the retired standalone importer (`migrate.mjs`,
  `legacy.mjs`, the `importerScopeMigrated` and `shelf` settings and the
  guard that kept the built-in importer off while the old module was
  enabled); `module.json` still declares the conflict, since the two would
  write one library.
- The `@PdfText` placeholder repair (`legacy-text.mjs`, its step in Import
  Everything and its api key): no current writer makes the tag. Ledger row
  T-0368, a placeholder that step left, closes with it.
- The `effectsFrom` stamp's repair check; `effectsOriginOf`, which every
  current writer calls, stays.
- The retirement of per-map Adventures (`retireMapAdventures`,
  `kind.settlementAdventure`): nothing has written one since the book
  Adventure replaced them.
- The location data model's fold of the standalone module's loose market
  fields into `market` (`location-migrate.mjs`), and the henchmen ready-time
  sweep that cleared market postings on a location below schema version 2,
  with its `schemaVersion` setting, which nothing read.
- The two previous-version tools built on 2026-11-11, which the owner had
  asked to see walked: the class builder's correction of a saved racial value
  of 0 with no race to -1 at load, and the `henchmen.monsterEmployers` repair
  check. Asked on 2026-11-13 whether they go, the owner answered "Remove both
  (Recommended)". That is the new evidence the classes entry of 2026-11-11,
  under seven days old, is superseded on.
- The ability flag migration (`thiefSkill`, `levelFactor` onto the throw) and
  the language migration (ability-typed `def.language.*` items, carrier entry
  names); the formation entry of 2026-11-11 that names the first is
  superseded in part on the owner's 2026-11-12 ruling.
- The battlemap's hand-declared routes (`hexRoutes`) and the scene control
  that converted them to road walls; roads are walls.
- Markets' `hubShift` ordinal and `dmKnowledge` with its move into report
  items; a location's string argument to `slanderCountFor`; the table
  documents' lookup of a table or folder by name from before it was stamped.
- `passengerCost`'s unread vehicle argument, `travelMultiplier`'s `road: true`
  and a settlement board's pre-`hour` night flag, read from a stored board
  and accepted by `patchSettlement`.
- Equipment: `isLegacyImport` (an offline run of the importer's weapon path
  over the printed grid bound 25 melee weapons, every one with a size and none
  with a tag), the `thrown`, `handy` and `hands` item flags nothing writes, a
  named item's stored `max`, and the `equipment.railClothing` repair check for
  garments written before the clothing hooks.
- The importer's repairs of what an earlier importer wrote wrong: the four
  equipment sweeps (`repairEquipmentAbilities`, `repairAnimalItems`,
  `repairShieldVariations`, `repairPricedSubtypes`), `repairAmmoWeapons` and
  `repairClassLadderKeys`; the language import's retype of an ability-typed
  language; the location store's read of a bare handle; and an ability with
  no `effectsFrom` stamp read as unverified for its `unaudited` tick. The
  current importer writes none of these shapes, so each was a fix of a
  previous version's import, which the owner's 2026-11-11 words set apart from
  the repair of a broken one. Prune (`danglingAbilities`) stays: it reads the
  world against the cookbook as it stands.
- Lib: the `lib.mountPairs` check and the read of the rider and mount pair
  from before mounts were attachments, with the cleanup that converged it;
  the `lib.mergeResidue` check and its macro, Clean Up After the Merge (GM),
  which §11 ruled for the separate modules' leavings; the `embeddedBundles`
  check's market purchase from before purchases unpacked; the group data
  model's fold of a single-stack group into `stacks`; this module's earlier
  status id for Hidden; and the two ready-time sheet sweeps, the monster
  landing-sheet pin and the one-time release of hirelings from the Follower
  Card, with its `retainerCardsReleased` setting.
- Formation: `mergeFogCopies` with its macro, Merge Fog Copies on This Scene
  (GM), and the complete-snapshot flag a lost party's fog restore read for
  snapshots taken before it; the `hexStock` check's ids for stocked points
  written without one; and the `partyActors` check's report and fix of a member
  held by two parties, which the current membership writers refuse. The
  formation api is version 23.

**Kept, as current-version paths:**

- `migrateDefenseBands` (monsters): the importer still writes a monster's
  defence-band effects as a joined string, and this sweep is what turns them
  into the set the data model stores.
- `lib.legacyEffectKeys`: Active Effects authored under `acks` 14.0.x still
  carry the old field names, in the worlds `legacy-source.mjs` is kept for.
  Asked, the owner answered "Keep it (Recommended)".
- The chargen "legacy row path" (`grantRowEntries`), the whole grant for a
  template row with no bundle; the equipment setters on the Construction tab;
  the base-type guess every item depends on; `WALL_DOOR_TYPES`, core 14's
  plain constant; `canEnter`'s boolean `road`, which its one caller still
  passes from the country reader.

**Cost.** A world built on an earlier version and never repaired or
re-imported keeps whatever shape that version left; the release notes say so
once, and a repair or a re-import is how such a world catches up.

## 2026-11-13 — 30. A major's gate is 47 walks, and the rest are suites — SUPERSEDED IN PART 2026-11-26

**Problem.** A major requires every walk in `tools/live/` (§28), and the set
had grown to 69 walks, about 265 seat-minutes of one world, with no recorded
reason for most of them to be walks. The owner, on seeing the audit: "I am
skeptical these test walks are necessary or doing more than proving import
value = import value." Most of what the retired walks asserted was a value
read back from a document the same code had just written.

**Ruled.** The owner took the audit in two steps, "B in prep for A" and then
"A: full apply". A check stays a walk only where a real server, a real seat or
a real browser is the thing under test. Everything else runs offline on
invented values, and a check that needs the Judge's own copy of a book lives in
the local-only `tools/rules-tests/` and never in a repo.

- **Retired with nothing carried:** `importer-bookless`,
  `importer-item-repair`, `location-judge-owner`, `formation-live-findings`.
- **Retired after a fold into a kept walk:** `classes-hit-points` into
  `classes-level-cap`; `location-house-spoil` into `location-storage-intent`;
  `importer-adventure` and the AX1 table roll into `importer-ax1` §3;
  `lib-cast-seam` into `magic-cast-summon`; `lib-missing-images` into
  `window-contract`.
- **Merged:** `formation-mapper-vulnerable` into `formation-mapper-mapping`;
  `henchmen-search-steps` into `henchmen-blocked-classes`;
  `classes-levelup-roll` into `classes-hp-record`; `importer-everything` into
  `importer-force-repair`.
- **Moved offline onto invented values:** the equipment layer and weapon-row
  walks, `importer-ax1-markets`, `henchmen-cultures`, `formation-party-skills`
  (`tools/test-party-skills.mjs`), `importer-class-rows`
  (`tools/test-class-sheet.mjs`), `monsters-leaders` (the generated-repertoire
  and leader suites; the Player's pin without a write folded into
  `monsters-encounter`), and the bindings of `importer-characters` and
  `importer-ax1-text`.
- **The smoke walk grew.** `window-contract` re-reads its recorder after the
  windows open, fails on a logged error, lists warnings, and opens every
  registered settings menu, the storage manager and one compendium.

**Rejected.** Keeping a walk for each recipe section: a section whose steps no
check drives stays a by-hand pass in its recipe, which says so, since a walk
that only repeats an offline suite costs a seat-minute per run and proves
nothing the suite does not. Trimming the kept walks' redundant checks in the
same change: each trim is a live-surface edit nobody can verify without a
world, so it waits for whoever next touches that walk.

**Cost.** Coverage the audit judged redundant is no longer checked by any
walk or suite: a Player seat's hand-out and shelf visibility of imported
characters, the Books-tab census row, a deleted carried item coming back under
its id, and the system's own cast with no claimant. Every edited walk is a
live-surface edit that nothing offline ran; the first major's gate walks them,
and a red result there is a finding, not a regression of the retirement.
`equipment-weapon-nulls` and `location-notes-tab` are red and stay on the
ledger (T-0531, T-0532), unfixed here; T-0533 and T-0534 carry two IP notes
the audit found in walks.

## 2026-11-14 — 31. A call meant for callers is published from its own file, and the docs are held to the namespace

**Problem.** The formation guide documented seven saved-marching-order calls
for macros, and none had ever been on `acksExtras.formation`: each feature
hangs a hand-written object on the namespace, the reference (§26) mirrors
those objects, and nothing collects a function from the file that defines it.
A front-door rewrite found the gap and deleted the guide section. Asked "The
formation saved-order calls (saveTemplate, applyTemplate, getTemplate,
deleteTemplate, reconcile) were documented as a macro API but are not on the
public acksExtras.formation api; the guide section was deleted. Keep them
internal or publish them?", the owner answered: "These should get grabbed by
the api publisher, if not that needs fixed, not this canary case".

**Ruled.**

- **A file publishes its own calls.** A file holding calls meant for a macro or
  another module ends with `export const publicApi = { … }`, identifiers only
  (a `key: identifier` entry renames on the way out), with a docstring naming
  the namespace that holds it. The feature's entry imports it and places it,
  as a group (`marchingOrders: marchingOrdersApi`) or spread at the top. The
  extractor reads it like any other literal, so the API page prints each
  call's own docstring.
- **Five checks, in the reference's problems.** R1: a `publicApi` no namespace
  reaches. R2: a file with a `publicApi` reached any other way (a hand key, a
  namespace import), so the manifest is the whole of what its file publishes.
  R3: a call in a manifest with no docstring. R4: a key reached twice where one
  route is a manifest. R5: an `acksExtras.<namespace>.<path>` in the README or
  `docs/` (the logs, `wip/`, `releases/`, `site/` aside) that the namespace
  does not hold; a first segment that is no namespace is a hook name and is
  skipped. They fail `tools/test-reference.mjs` in `npm test`, the site sync
  in `validate`, and the pages build.
- **The 18 hand-written objects stay.** A file converts whole or not at all,
  and R2 fails a conversion that leaves a hand line behind.
- **Where the formation calls live.** Asked where the seven live, with A
  grouped under their source names (recommended), B at formation's top level,
  or C grouped and renamed, the owner answered "C: grouped and renamed":
  `acksExtras.formation.marchingOrders` holds save, apply, get, list, delete,
  formUp and reconcile, and the guards name the call a macro typed.

**What the checks cannot see.** An unmarked function written in a doc by its
bare name: the canary was written exactly so, and no rule can tell
`saveTemplate(formation, name)` from prose. The convention closes it: a doc
names a call by its full `acksExtras.` path, which R5 then holds to the
namespace. A function nobody marks and nobody documents stays internal, which
is the intent: 3,210 exports under `scripts/` reach no key.

**Rejected.**

- *A docstring tag (`@api`) read at runtime.* A function's source text at
  runtime excludes its leading comment, so collecting tags needs generated
  code in `scripts/`, which the shared tree's edit ledger never attributes.
- *Hand assembly plus a gate on documented-public exports.* Doc mentions alone
  cannot define the set (bare names), and adding a tag states "public" twice.
- *A runtime `publish(fn)` registry.* It depends on import order and turns
  declarations into values the extractor cannot follow.
- *A whole-file namespace import.* Right for a file whose every export is
  public; for the saved orders it would also publish six exports nothing
  documents as calls.

**Cost.** The ten formation keys the entry hand-published from
`formation-model.mjs` moved into that file's manifest under the same keys (R2).
Two repeats with no manifest involved, `henchmen.rules.arrivalSplit` and
`vehicles.OFFICER_STATIONS`, are still settled by last-wins and not gated;
generalising R4 waits on their owners. A recipe that reached an unpublished
function through an `acksExtras` path now imports the function's file in page
context instead.

## 2026-11-14 — 32. Four one-time conversions go, one slice per feature

**Ruled** (owner, 2026-11-13, plan §31.11, on the four readers left after
entry 29): "Delete, slice per feature (Recommended)". Each went in its own
commit on 2026-11-13, under entry 29's test: nothing the current module or
the current `acks` system writes still holds the shape it handled.

- battlemap: `foldPaintedClimate` (with `paintedClimateOf` and
  `PAINTED_CLIMATE`) and `settleRegionsOnly`. The brush paints no climate
  regions, and `paintHexAt` makes every region on a regions-only layer already
  settled. This supersedes in part "The climate is the map's" and "The map
  shows one mode at a time".
- location: `storage-intent.mjs` whole, with `clearDefaultStorageOnce` and the
  `storageByIntent` world setting. Storage on a place is only what a GM
  switched on. This supersedes in part "Storage is switched on by intent".
- equipment: `resolveWeaponGroupPick`'s branch that read a bare category key.
  No current path stores one. This supersedes in part "A Martial Training pick
  grants its option's own weapons".
- vehicles: `normalizeTeamRows` and the sheet's `_onRender` that called it.
  This supersedes in part "The team has two halves: abstract rows, real
  attachments".

**Cost.** A world that still holds one of those shapes is not converted: it
starts new, or deletes its imports and imports again (the Beta's upgrading
note).

## 2026-11-14 — The Discord bridge leaves `main` for a parked branch

**Ruled by the owner** (2026-11-14): "Can you park the discord bot as well,
similar to the OSE imports? I'm not ready to release that beyond personal
testing".

**Ruled.** The whole bridge line leaves `main`: `scripts/bridge/`, its
templates and stylesheet, the `discord/` service and its `discord.js`
dependency, its suite and walk, the `ACKS-BRIDGE` lang keys, and `docs/bridge/`
and its guide, with the rows and links in the docs and the docs site that
named them. What stays is what a world already wrote: its settings and flags
remain in that world as stored data nothing reads, and the module ships
nothing for them. The line lives on `parked/bridge`, which holds `main` as it
stood with the feature whole; restoring it is a merge of that branch.

**Rejected:** keeping the module half on `main` behind a switch, because its
two settings menus would show with no client behind them.

*Cost:* a dev install junctioned to `main` has no bridge, so the owner's own
testing runs from a checkout of the parked branch.

## 2026-11-18 — The template is folded into this repo

**Owner ruling.** "the release gates (full workflow toolchain really) need a
full audit. They are hold-over from when the repo was very different in scope
and structure. For example, module template seems redundant now." On the
audit's cut C1, fold the template into this repo: "Yes, plan it", then
"Implement".

**Evidence.** The template's `manifest.mjs` listed this repo as its only sync
target. A toolchain change was a template commit and push, a sync, a land here
under a full gate, and a push; this repo took 21 sync commits in the month to
2026-11-18. The live walks loaded their capture driver from the template's
checkout, and a tag was built by the template's workflow as its `main` stood
that day.

**Ruled.** The toolchain is this repo's own, and is edited here: `.claude/`
(skills, rules, hooks, agents, settings), `tools/validate.mjs`,
`build-packs.mjs`, `ip-scan.mjs`, `ip-quarantine.mjs`, `release-preflight.mjs`,
`logs.mjs`, `walk-results.mjs` and `.githooks/pre-commit`. The capture driver
is `tools/live/_capture.mjs`. The 14 suites that test those tools are
`tools/toolchain-tests/test-*.mjs`. They stay out of `npm test` and the land's
gate, as they were: one sequential run took 1,648 s. A change to a tool runs
the suite that covers it, and `.github/workflows/toolchain-tests.yml` runs
them on a push that touches what they cover. The release procedure is
`.github/workflows/release.yml`, whole. `docs/TOOLCHAIN.md` and
`docs/LICENSING.md` live here, TOOLCHAIN with its section numbers kept. The
sync tool, the scaffolder, the skeleton, the manifest, the drift workflow, the
nightly script and the skills `acks-sync-toolchain` and `acks-new-module` are
gone. No gate changed what it checks.

The template's `docs/DECISIONS.md` is not copied. The `## In force` index
above names each of its rulings that still governs, at the commit the fold
copied from. A new toolchain ruling is an entry in this file.

**Superseded**, among the template's rulings. Whole, so they take no index
row: "The template's own tree was outside every gate it publishes"
(2026-09-09), "The sync reads canon from a commit, holds what git cannot give
back, and fails a target it did not read" (2026-10-08), "`blank-template/` is
retired, and the scaffolder says whether the module it built is level with
canon" (2026-10-09), "This repo's hook runs the quarantine in `skeleton/`, and
no copy of it sits at the root" (2026-10-10). In part, as their rows say: the
sync's half of "The worktree that renamed a repo, and the sync that ran ahead
of the push" (2026-08-05), the sync's and the scaffolder's halves of "The
pre-commit hook is committed as an executable file" (2026-10-10), and the
template's checkout in "Unpushed commits are named at the end of a turn"
(2026-11-12). That last ruling is under seven days old; what it did not know
is the single consumer above.

**Cost.** No one-command scaffold for a second module. Toolchain commits enter
this repo's history. Nothing compares `LICENSE` or a toolchain file with a
second copy, so a hand edit to one is caught by review and by its suite.

## 2026-11-24 — A release is asked about when it is called, and at no other time

A plan for the `acks` 14.2.0 repair listed "The release. Its kind, and whether
it waits for every break slice" among its owner decisions. The owner: "Doesn't
matter for defining work package, asking this is a project bug that needs
squashed." The same ask had been stopped once before, on 2026-11-11: "Stop
asking about a release type." That ruling was kept as one campaign's, in a
session's memory, so the next plan asked again.

**Ruled.** The kind is asked when the owner calls a release without naming it
(`/acks-release`), and nowhere before. A plan, a brief, a report and a wrap-up
carry no question about a release's kind, its timing or what it waits for. A
work package is its slices; which release carries them is the owner's, said
when they want one. The rule is TOOLCHAIN §4, "Release kinds", and `CLAUDE.md`
points at it.

**Rejected.** A gate, which `CLAUDE.md` asks for when a written lesson recurs.
The question is asked in a session's own messages and in a plan's prose. A
Stop hook is handed the first and a docs check could read the second, and in
neither does a pattern tell a question about a release from a mention of one.
The rejection is the session's that wrote the rule, not the owner's.

**Cost.** A slice that carries a migration, a setting or a new surface is no
longer flagged for the owner's eye while it is built. The release that ships
it names them in one line when it is cut (`acks-minor` §1).

## 2026-11-25 — A minor's walk is run once, and again after a fix — SUPERSEDED 2026-11-26

**Problem.** A walk's result was bound to the whole runtime tree, so one byte
anywhere in the module made every recorded walk stale. A minor with a dozen
landings walked each surface after its own landing and then all of them again
after the last one. The owner: "A walk result goes stale on any runtime byte
changing, anywhere in the module = bad rule for anything non audit", then "one
walk for bug detection and a repeat post-fixes is enough" and "This is hobby
grade, does not need byte hardened".

**Ruled.** For a minor and a hotfix, a required walk's result is current when
its attempt started after the last release's tag. A walk that did not pass is
run again after its fix, and the latest attempt wins, as before. A major keeps
the whole-tree binding: it is the audit. In every kind a result is still
refused where the runtime changed during the run, where the walk's own file
changed since, where the run was partial, and where a non-pass is not
classified. `evaluate` in `tools/walk-results.mjs` takes the tag's time as
`since`; the preflight passes it for a minor and a hotfix, and the runner's
`--list` judges the same way.

**Rejected.** Binding each walk to the paths its feature can reach, by folder
or by import graph. It is the general answer, and the nine topics open on the
day all wrote `lang/en.json` and most wrote `scripts/lib/`, so a scope that
includes those two stales nearly as much as the whole tree, and one that
traces imports is a tool to build and keep. The owner's rule needs neither.

**Cost.** In a minor, a landing can break a surface that was walked before
it, and nothing marks that walk as owed again. A release's landings therefore
come before its walks where that is possible, and a session that knows a
landing reached a walked surface runs that walk again without being told to.

## 2026-11-25 — Each walk runs under the landing lease

**Problem.** Walks and landings shared one tree and one world, and kept off
each other by messages through the hub session: a landing waited for a word
that the walks were between runs, and a walk waited for a word that the landing
was done. A landing that moved the runtime tree in the middle of a walk made
the walk's result refused, and the word could be late or wrong.

**Ruled.** `tools/live/run.mjs` takes the landing lease of
`.claude/skills/acks-commit/lease.mjs`, the one `acks-commit` and
`acks-branch land` hold from their gate to their commit, around each walk: before
the walk's runtime tree id, given up after the closing id, on a pass, a failure,
a throw and a signal. The holder is named `walk:<name>` with the session. It is
one lease for each walk and never one for a batch, and the runner stands aside
for a moment between two walks, so a landing that waits (it looks again every two
seconds) goes in between them. A lease another run holds is waited for, the
holder named, for an hour at most; past that the walk and those after it are not
started, nothing is recorded and the runner exits 5. Nothing skips the lease;
`--list` and `--classify` take none. The runner already took several walks and
went on after one that was not a pass, so that stays. The owner: "Yes do the
workflow as you describe, implement the recommendations etc".

**Rejected.** A hub message as the hand-over between a landing and a walk
(the practice until now), and a lease held for a whole batch, which would keep
every landing out for the hour a batch takes.

**Cost.** A landing waits for the walk that holds the lease, a walk's length at
most, and a walk waits for a landing's gate, about six minutes. A session that
runs `acks-commit` while it runs a batch waits for its own batch's walk.

## 2026-11-26 — Tools follow Foundry's permissions; what is built ships, and the rest is on the roadmaps

**Ruled.** The owner, 2026-11-25: "Tool permissions are hardcoded (e.g. summons) by server role instead of
object ownership, only judge secrets are supposed to be an exception to this rule." The owner, 2026-11-26:
"role permission is out except the completed batches and the first wave that was scheduled for this release",
and "clean up what's built, roadmap rest". Standing: "follow foundry permissions, don't invent new ones"; where
the automation would refuse, a player is blocked and a Judge is warned ([lib](lib/DECISIONS.md), 2026-11-14,
"Where the automation would refuse, a player is blocked and a Judge is warned").

- **What ships.** Summons and spells, the party sheet, places and storage, hirelings and service, and the legacy
  ledger follow ownership. Each feature's 2026-11-25 entries say how.
- **What every later row follows**, as those entries applied it:
  - a press follows ownership of every document it writes;
  - a press from a seat that is not a Judge's runs on the Judge's client, through a relay that reads the
    sender's ownership there;
  - creating a document reads Foundry's own permission (`game.user.can`), never the role;
  - a Judge's secret stays the Judge's, and a control that hides something keeps hiding it when its seat changes;
  - a step the page gives the Judge by name stays the Judge's press, recorded as printed procedure;
  - a seat that can do nothing with a control is not shown it.
- **The owner's selection of 2026-11-25** (the session's wording, selected): all thirteen of the listed "the Judge's"
  rulings are reversed. Built, each in its feature's 2026-11-25 entry: sacrifice facts and the power ledger
  ([magic](magic/DECISIONS.md), "The sacrifice window follows ownership of the caster"; "The power line opens
  from a tag, and its controls are the character's owner's"); a trap on a place ([formation](formation/DECISIONS.md),
  "A member-owner presses the mode's own clock and day, and drops onto a place they own"); the water penalty and
  the crossing presses (formation, "The crossing, a member's landing and the Trapbreaking modifier follow
  ownership"); the dungeon haul's Search here ([scene-search](scene-search/DECISIONS.md), "A member-owner's
  Search here opens the session"). Not built, on the roadmaps: the treasure deal panel, deal toggles, roll mode
  per pot and arms select; the scene search screen; the Books tab's Remove; class choice at level-up. Class
  choice at level-up was selected while the owner answered "follow raw" twice in the same send, so the work
  that builds it puts it to the owner first.
- **Rejected.** Finishing a half-converted window in this release: the owner's words put it out.
- **Cost.** Some windows mix ownership and role controls until their rows are built. Each is a row in its
  feature's ROADMAP; the role reads that stand in for a permission Foundry lets a world grant are one row in
  [ROADMAP.md](ROADMAP.md).

## 2026-11-26 — One release path: kinds are retired, the smoke walk is the live gate, and no release waits on a document

**Problem.** One day after "A minor's walk is run once, and again after a
fix", a release session ordered every walk run again as a "release batch" on
a frozen tree before the cut, and told the owner the release waited on it.
The earlier ruling had changed one clause of the gate and none of what a
session reads first. The preflight still built a required list from every
walk a recipe names, so a walk written for a landing joined the gate by
itself: `tools/live` held 135 walks, 48 of them written in two days. A major
or a minor still owed a shot for every Added and Changed bullet, and 95
bullets carried none. Each session was still told to establish a release
kind, which chose among three tables of those obligations.

**New evidence.** The owner, 2026-11-26, on that order: "Why is release batch
reruning checks at all?", "THIS WAS ALREADY CALLED OUT AS A CRITICAL MISS",
"Only what changed needs checked, and that's part of the implement land", "A
rewalk is only needed when requested (bug hunt or audit) or fails a smoke
test on final inspection (throw errors, fails to capture snapshot, etc)", and
"The defects are mostly design and HMI, I need results faster and more
efficiently, checks are for stability/error detection only, not critical
stress test". On the list: "Why is there a required list?", and to "Remove
the required walk list and gate releases on the smoke test, starting with
this release?", "Yes, remove it". Then: "The documentation is a separate ask.
The whole concept of hotfix, minor and major are retired. We're going to
rolling release." and "So dropping mandatory screenshots for all surfaces is
removed. Do include the directions on where to find each feature using the
project vocabulary".

**Ruled.**

- A walk is there to find instability and errors: the surface opens, its
  presses run without throwing, and its writes land. It is not a stress test,
  and it does not judge design or handling, which the owner finds in use. A
  walk that fails for a fault of its own script is classified and left; it is
  not repaired in a loop to get a pass.
- There is one release path and no release kind. A release is cut from `main`
  when the owner calls for one, and `tools/release-preflight.mjs` takes no
  kind.
- The live gate is the smoke walk, `window-contract`: a real load with no
  thrown error, passed on the release's own runtime tree. There is no list of
  required walks, and a recipe that names a walk requires nothing.
- A change is checked on its own surface as part of its landing. A walk is
  run again only when the owner asks for it (a bug hunt, an audit) or when
  the smoke walk fails on its surface.
- No release owes a screenshot, a guide step or a gallery row. Documentation
  is its own task, done when the owner asks for it.
- A changelog bullet that names a feature says where it is found, in the path
  vocabulary of `.claude/rules/docs-doctrine.md`.

Two readings of those rulings are the release session's and not the owner's
words. What only a major did (rolling the logs, re-issuing each ROADMAP,
rolling the bug ledger, holding every walk to the tree) is done when the
owner asks for it and gated by nothing. A changed surface with no
`TESTING.md` recipe is a note in the preflight's output and no longer a
refusal.

This supersedes the 2026-11-25 entry whole, the gate of 2026-11-13's entry 30
(a major's 47 walks), and the 2026-08-19 ruling that the recipe walk is the
whole gate.

**Rejected.** Keeping three kinds with lighter tables. Each table is where the
obligations collected again after a ruling removed them. Keeping the
walk-file hash as the tie between a new check and its first run: it cannot
tell a new check from a comment, and it charged a rewalk for both.

**Cost.** A landing that breaks a surface is found before the tag only where
it throws at load or in a window the smoke walk opens, and otherwise in use
or by a bug report. Nothing rolls the logs by itself, so `CHANGELOG.md` and
each DECISIONS file grow until the owner asks for a roll. A screenshot in a
guide or the gallery goes stale with no check to say so.
