# Bridge — decision record

Why the bridge is shaped the way it is: what was ruled, what was rejected,
and what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### The bot owns a seat; nothing lives on the server (2026-09-05)

Owner ruling on the transport, after the proposal's three options. Ruled:
the client service launches a headless browser joined to the world as its
own user and drives the page over the DevTools protocol — the release
capture driver's mechanics, kept alive with a watchdog.

The owner's question, asked twice and worth keeping the answer to: *why can
the bot not live on the world directly?* Because Foundry has no server-side
module runtime — `esmodules` are served to browsers and run only there — so
nothing a module contains can hold a Discord connection on the server. A
module running in a GM's browser tab cannot answer slash commands either:
Discord's REST API refuses bot tokens from browser origins, and the tab
would still have to stay open around the clock. The nearest thing to "on the
world" is what was built: a sibling service **on the same host as the Foundry
server**, pointed at `localhost`, bringing its own browser as the tab that
never closes. Owner direction: the Foundry host runs the bot.

**Rejected: raw socket.io to the server** (`foundry-cli`, `foundryvtt-mcp`).
Reads and writes documents without a browser, and cannot roll a save, level
anyone up, hire anyone or advance a journey, because none of that exists
server-side; the bot would re-implement ACKS in Node and drift from the
module. Acceptable only ever for read-only dumps.

**Rejected as the foundation: the ThreeHats REST relay.** Still needs a
browser client open — it is the seat with someone else's transport — and the
public relay routes world data through a third party. It may return as a
second consumer of `acksExtras.bridge`; whether it can execute in-page
JavaScript was not verified.

Cost accepted: one Chromium per bot, and a long-lived Foundry client that was
designed for a session, not a month. The seat is disposable by construction —
a failed probe or a lost socket tears the browser down and launches a new one
with backoff — and a scheduled restart is cheap insurance against a leak
nobody has yet seen.

### Two repos: the guard here, the service beside it (2026-09-05)

**Superseded the same day by the next entry.**

`scripts/bridge/` is a feature of this module: it is the half that must live
inside the world, and the bindings, the guard and the stamp are what a second
client would reuse. The Discord service is `acks-discord`, a sibling repo,
because it is a service with its own runtime, dependencies, deployment and
secrets: a module zip must not carry it, and the family's manifest assumes
Foundry modules. That makes it a new KIND of repo for the template
(`acks-module-template` decides which synced trees apply; none of validate,
the pack builder or the release workflow do). The slug is `bridge`, not
`discord`, because Discord is the first client of a client-agnostic surface.

### One repo: the service is `discord/` (2026-09-05)

Owner direction, given after the sibling repo had been created: the bot is
part of Extras. What the earlier entry did not know, and what makes this cost
nothing: `tools/validate.mjs` walks only `scripts/`, `tools/`, `templates/`,
`styles/` and `lang/`, so a top-level Node package trips none of its gates;
`ip-scan` reads it like any tracked source; the service's own suites import
nothing outside Node, so `tools/run-tests.mjs` runs them without an install;
and the release zip sweeps in everything its exclude list does not name, so
`discord/` ships inside `module.zip` unasked. That last fact is the
deployment the owner wanted from the start — installing the module puts the
bot's code on the Foundry host — and the "new kind of repo for the template"
cost disappears with the repo.

What it costs: `module.zip` carries a few dozen kilobytes of source Foundry
never reads; an operator running the bot from the installed module directory
reruns `npm ci` there after every module update, because the updater
replaces the directory; and secrets must live outside that directory
(the unit's `EnvironmentFile`), because the update would take a `.env` with
it. The runtime ruling is unchanged: still a separate process, still a seat.

### Following the Foundry updater (2026-09-05)

Owner direction: deploy through the module updater, with nothing copied by
hand. Ruled: the service runs from the module directory itself and notices
its own replacement — it polls the manifest, because the directory it would
watch is deleted and recreated, which no watcher survives — then exits and
lets systemd restart it; dependencies come back through the unit's
`ExecStartPre` only when they are missing or stale; commands register at
start by digest; the installer renders the unit and the environment file
under `/etc`, the one place the updater never touches.

**Rejected: a systemd path unit** watching the manifest. A second unit to
keep in step, and it re-arms only after the unit it triggers has finished,
which a long-running service never does. **Rejected: a git checkout as the
deployment.** It puts a `git pull` on the operator, which is the copy-paste
the direction excluded. **Rejected: global commands.** They take up to an
hour to propagate; guild commands apply at once, and one table is one guild.

Cost: a module update restarts the bot within half a minute and the seat
rejoins; so does a reinstall of the same version, since the files under the
process changed either way.

### The guard runs as the bound user, never the seat (2026-09-05)

The seat is one Foundry user at Assistant GM, so every member's command
arrives with GM power behind it. The guard is what puts that power back
inside the member's own rights: a command runs as the Foundry user the
member is bound to, and `requireOwner` asks the document about THAT user.
The seat's rights decide nothing.

Consequence accepted: `asSeat`. A Judge command from a member the service's
operator lists as a Judge runs as the seat's user, which is how the first
Judge gets linked before any binding exists. The service runs on the
operator's machine with full access to the page anyway; the flag only makes
the bootstrap take the same path as everything else, and it is set for the
seven Judge verbs and nothing else.

**Rejected: bindings a member claims for themselves.** A self-claim is a
player choosing which Foundry user they are; the Judge's `link` is the only
writer, and `use` (the active character) is limited to actors the bound user
already owns.

Checked live (2026-09-05): Foundry's `getDesignatedUser` picks the qualifying
user with the highest role, and only ties fall to the id. An Assistant seat
therefore never takes `game.users.activeGM` from a Gamemaster who is online;
it becomes the designated GM only when it is the highest-role GM present,
which for a table is "the Judge is away". That is the play-by-post case, and
it makes the module's primary-GM hooks run on a headless client — walking
them there is on the roadmap, not assumed harmless.

### A roll's card is stamped by the tap, not the command (2026-09-05)

Core's rollers create their chat card without awaiting it, so the card lands
after `rollById` resolves and the command has nothing to stamp. Ruled: `roll`
marks the actor in flight for its duration and the tap stamps any message
this client posts for that speaker meanwhile — event and document alike.
The relay reads the stamp to skip what the interaction reply already showed,
which is why a roll appears once in Discord and not twice.

**Rejected: relaying every chat message and answering interactions with
"posted".** One copy in the channel, from the relay, would be simpler — and
would put a member's own roll result behind the relay's latency and its
filter, and make `/say` from a member whose party channel is unbound vanish.
The interaction reply is the copy; the relay carries what the table did.

### `map` is the Judge's, and a player map waits (2026-09-05)

The seat sees the scene as an Assistant GM: every token, no fog. A player
asking for that picture would be asking for the Judge's map. Ruled: `map` is
a Judge verb; the Judge posts it where they choose. A player-vision map —
the seat controlling the party token so the canvas draws that token's sight
— is on the roadmap, to be verified live rather than reasoned about.

### One-to-one time is a formation ruling, deferred (2026-09-05)

Two parties in the field both write the one `game.time` (`lib/world-time.mjs`).
The proposal recommends one-to-one time with per-formation expedition clocks
reconciled on return; that is a change to formation's clock, not to the
bridge, and it is step two. Recorded on the roadmap so `/travel` does not
promise what the clock cannot yet keep.

### The bot's dependency is the root's devDependency too (2026-09-06)

The first 7.0.0 tag failed its Release run: `tools/run-tests.mjs` runs the
bot's suites, the command suites import `discord.js`, and CI's `npm ci`
installs the root package alone — `discord/node_modules` exists only on a
host that ran the service's own install. The local gate passed because that
directory was there. Ruled: `discord.js` is declared in the root
`package.json` devDependencies as well as in `discord/package.json`; Node
resolves it from the root when the bot's directory has none, which is what a
CI checkout is. The service on a Foundry host still installs its own copy
through `prestart`, so nothing about deployment changes.

**Rejected: skipping the bot's suites when the dependency is absent.** A
skip on CI would report the release green with the bot untested, which is
the failure `npm test` exists to catch.
