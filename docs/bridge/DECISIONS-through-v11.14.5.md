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

### The bot is configured in Foundry, and its token is sealed (2026-09-06)

Owner direction: the bot must be configurable from inside Foundry; answering
an installer over SSH is too finicky. Ruled: everything a Judge sets — which
Discord server, which channel receives the world's chat, who is a Judge
before anyone is linked, the seat's size, the log level — lives in a hidden
world setting written by a settings window (`bridgeClient`), and the bot
reads it through its own seat. The environment still wins wherever it carries
a value, so an existing install and a Windows run by hand keep working
untouched.

**The token could not simply join them.** Foundry vends the whole settings
table to every connected client — `db.Setting.dump()` builds the payload with
no filter by scope or user — so a token typed into a window would be a token
any player could read out of their own console. Ruled: the bot generates an
RSA-OAEP key pair in its systemd `StateDirectory`, publishes the public half
in a second setting it alone writes (`bridgeAgent`), and the window seals the
token to that half before storing it. What reaches a player is ciphertext;
the private half never enters the world. One implementation of the sealing
runs on both sides (`scripts/bridge/sealing.mjs`), and one test seals with
the window's code and opens with the bot's, because a handshake that is
written twice is a handshake that drifts.

**The sealing half is written out by hand, and that is not gold-plating.**
`crypto.subtle` exists only in a secure context, and a self-hosted Foundry
on a LAN is plain http — so on the most ordinary install of all, WebCrypto
encryption is simply absent from the window. The window therefore carries
SHA-256, MGF1 and a BigInt modular exponentiation of its own, which is
RSA-OAEP's encrypting half and needs nothing but `getRandomValues` (not
secure-context gated). The output is ordinary RSA-OAEP/SHA-256: the bot
opens it with WebCrypto, where the private key is and where the API is
always there. The hash is checked against the platform's at every padding
boundary, because a hash that is subtly wrong seals a token nothing can
open.

**Two records, one writer each.** The window writes the configuration, the
client writes the announcement. Neither merges the other's fields, so a
browser saving a form and a bot announcing at the same moment cannot lose
each other's work.

**A configuration change restarts the bot.** It hears the save as a `config`
event on the tap, compares a digest of what it actually runs on — not the
revision, so a form saved unchanged does not bounce a running bot — and exits
0 for the service manager, exactly as a module update already does. Rejected:
reconfiguring in place. Re-logging a Discord client, re-registering commands
and re-seating the relay is a state machine, and the restart it would avoid
takes ten seconds.

**What stays on the host, and why it cannot move.** Where Foundry is, which
user to join as and that user's password: a bot that cannot reach the world
cannot be told anything by it. The installer therefore asks only those, the
browser is found in the usual places, and the Foundry user defaults to
`Discord` — on a stock host every answer is already right and the operator
presses Enter through all of them.

**The first Judge is the Discord server's owner.** Listing a guild's members
needs the privileged Server Members intent, which is one more portal switch
for the sake of a dropdown; the owner's id arrives with the guild and no
intent. So `DISCORD_JUDGE_IDS` stops being something anyone must find, and
the window's extra-Judges field is for the rare second one.

**Rejected: a file the module writes into the Foundry data directory.**
Foundry serves that directory, so it moves the leak rather than closing it.
**Rejected: handing the token over a socket message.** Foundry's socket
broadcasts to every client. **Rejected: storing it in the clear and warning
about it in the hint.** The margin the family keeps on IP it keeps on
secrets: a token a player can read is a token a player can use.

Cost: a key pair to keep — a bot that loses its state directory cannot open a
token a Judge already sealed, and says so (`staleToken`) rather than failing
to log in for no visible reason. The Judge pastes it again.

### Accounts and dice reach the world from Discord, inside the seat's role (2026-09-06)

Owner direction: a Foundry-side window for linking players, a Discord-side
tool to set up a new player account, players managing their own password
from Discord, and the bot taking over the server's dice — for anyone, linked
or not.

**The window is a second door onto the binding store, not a second store.**
`apps/members.mjs` runs the same `bindings-logic` arithmetic `/link` runs,
over the same setting. It offers members by name out of the client's
announcement — the ones who have run any command — because listing a
server's members needs the privileged Server Members intent (the same
reason the first Judge is the guild owner), and takes a pasted id for anyone
else. Rejected: asking for the Members intent. One portal switch and a
privileged-intent review for the sake of a dropdown, when `/whoami` already
puts a member on the list.

**A created user is a Player, born with a secret nobody knows.** `enroll`
never makes anything above Player: a Judge who wants a Trusted Player
promotes in Foundry's own user management. The initial password is random
and discarded, so no secret passes through the Judge who ran the command,
and until the member sets their own nobody can join as that user. Rejected:
an empty initial password (on a world where players have none, anyone at
the join screen could take the seat); a random password DMed to the member
(a secret in a Discord DM is a secret in Discord's database). Rejected for
now: self-service enrolment — a toggle that lets any server member mint a
Player. Cheap to add later (roadmap), but it makes guild membership the
whole gate on a world's user list, and that is the Judge's to opt into, not
a default.

**A password from Discord is the member's own, and never a Gamemaster's.**
Foundry itself refuses an Assistant seat a Gamemaster's password
(`common/documents/user.mjs`, `#canUpdate`); the module refuses it too, so
an operator who runs the seat as a full Gamemaster does not quietly widen
the door. A compromised Discord account may take a player's seat at worst,
never the Judge's. The floor is eight characters: Foundry has no policy, and
a one-letter password typed into a chat command is a footgun the window
would never have allowed. Rejected: Judge-reset of another member's password
from Discord — Foundry's user management does it without the Judge learning
the new secret through a chat option.

**Dice are core's `Roll`, evaluated on the seat.** A dice parser in the bot
would be the family's fourth implementation of something Foundry ships, and
would drift from what a player sees in Foundry's chat (`kh`, `x`, `r<2`,
`dF`, `d%`). `Roll.validate` judges the formula; the module adds a length
and a dice-count ceiling and nothing else. The throw is kept in the world's
chat only when a character can be named for it — an unbound member's roll
has no user to credit and stays in Discord. Rejected: a separate `/dice`
command. `/roll 2d6` is what every dice bot answers; the shape of the text
tells a formula from a throw's id.

Cost: the seat performs `User.create` and `User#update` with its own role,
so what the two verbs can do is bounded by Foundry's permission tests for
an Assistant — which is the bound, not a limitation: it is exactly what
keeps a Player-only creation Player-only whatever the module asks.

### The installer installs in the foreground, and a re-install is the whole install (2026-09-06)

Evidence from the first host to run 7.1.0's installer: it "stalled", and the
window's token field stayed locked. The unit's `ExecStartPre` ran `npm ci`
with its output in the journal, and `systemctl enable --now` blocks until a
`Type=simple` unit's pre-step returns — so the operator watched a silent
prompt for as long as npm took, and a bot that had not yet joined had
published no key for the window to seal to. Ruled: the installer runs
`prestart` itself, as the service's user with the service's HOME, before
enabling anything, and ends by printing `is-active` and the journal's first
lines; the unit keeps `ExecStartPre` for the restart after a module update,
where nobody is watching. The window's locked field now says why it is
locked.

**The stall had a second cause, found on the same host running 7.1.1.** The
installer wrote each question to stdout by hand and gave readline an empty
prompt; a terminal readline answers `ESC[1G ESC[0J` — column one, clear to
the end of the screen — before it waits, so every question was erased the
instant it appeared and the operator sat at a blank cursor with six answers
owed. Nothing offline saw it because no test held a terminal: the asker's
non-tty branch was the one every script exercised. Ruled: the question goes
through readline, the asker takes its streams so a test can be a terminal,
and the test that would have caught 7.1.0 now exists.

**The third cause, same host, 7.1.2 (2026-09-07):** with the questions
visible and answered, the unit restarted twenty-two times on `devtools
endpoint never came up`. The browser the installer had offered,
`/usr/bin/chromium-browser`, is on Ubuntu a shell stub for the Chromium snap,
and a snap does not start under a system service. The guide had said `apt
install chromium`, which on Ubuntu installs that stub. Ruled: a snap stub is
not a browser anywhere the bot looks — the search skips it, the installer
refuses it, the seat names it — and a browser that never answers is reported
with its exit code and its stderr, because the seat had been discarding both
and reporting only the timeout. Not ruled: bundling a browser (Playwright's
Chromium) — a hundred-megabyte download inside a Foundry module for a host
that has `apt`.

**A re-install overwrites a failed one.** Owner direction. The unit is
stopped and `reset-failed` before the files are rewritten (a unit that
tripped its start limit refuses `start` otherwise), a `node_modules` another
account made is chowned to the service's, and the Discord half of an earlier
environment file is **dropped, not carried**: the environment wins over the
window wherever it is set, so a 7.0.1 host's stale `DISCORD_GUILD_ID` would
have overruled every choice made in Foundry without a word. An operator who
wants a host-side override sets it in the installer's own environment, and
the installer names each value it dropped.

### A restart is a change in the world; a start or an install is a command on the host (2026-09-06)

Owner direction: launch, restart and install "from within Foundry". Only the
first is buildable, and it is built as a configuration change rather than a
channel of its own: `restartNonce` sits in `configDigest` and nowhere else,
so the window moving it restarts a running bot through the exact path a saved
change takes, with no new command, no new event, and no bot-side code. The
button is offered only while an announcement is fresh, because the request
travels through the world and a bot that is not running is not listening.

**Rejected: a start or an install reachable from Foundry.** Foundry runs no
module code on its server, so a window can reach the host only through a
process already there — and the process already there is the bot, which is
the thing that would be down. A second, always-on host agent whose one job is
to start the first was weighed and refused: it is a privileged daemon to
install, secure and update for a case the unit's `Restart=always` already
covers (a crashed bot is back in seconds; a stopped host brings it up on
boot). Installing stays the one command in the guide; the guide says why.

### A failed startup retries; an unbounded restart loop parks the unit instead (2026-09-08)

Field evidence: a host whose bridge call to the world timed out at startup
restarted the process 408 times, each life spawning and killing a browser
(peak 1.5 GB) before dying on the same unguarded top-level `await`, with
`Restart=always` and no `StartLimit*` giving the loop nothing to hit. Ruled:
the startup `announce` retries with the seat's own backoff instead of
throwing, because a world that is merely slow to answer is not a
misconfiguration the operator needs to see — it is the same shape of problem
the token-wait loop already treats as normal. `unhandledRejection` and
`uncaughtException` are now caught process-wide, logged, and routed through
the same clean shutdown a signal gets (seat and Discord client torn down,
exit 1 instead of `shutdown`'s 0) rather than left to whatever Node's default
handling of an unhandled rejection does, which does not tear the seat down at
all. The unit's `StartLimitIntervalSec=600`/`StartLimitBurst=10` is the
backstop above both: ten starts in ten minutes is generous next to a working
bot's occasional config-change or module-update restart, and still turns a
crash loop that would otherwise run all night into a unit `systemctl` reports
as failed.

**Rejected: no retry, just a clearer crash.** A cleaner stack trace on the
same top-level `await` still hands the failure to `Restart=always` with
nothing to distinguish "the world is not up yet" from "this host is
misconfigured." The bot already treats the first case as ordinary for a
missing token; a slow world deserves the same patience, not a different one.
**Rejected: an iteration cap on the startup retry itself.** The unit's own
`StartLimitBurst` already bounds how many times systemd will restart the
process; a second, smaller cap inside the process would fire first and start
handing genuinely-transient failures back to the service manager anyway,
buying nothing.

### `seat:check` proves a write lands, not only that a read comes back (2026-09-08)

Field evidence: the same host reported `seat:check` green all night while
every document write in the world hung for 47 seconds — because the check
only ever called `commands`, `users`, `parties` and `whoami`, four local
reads of data the seat already holds cached, none of which touch the
network. Ruled: the check now calls `config` and `announce` — the two
commands the running bot calls to start — timing each, and closes a write
round trip: `announce` writes a nonce into the world's `bridgeAgent` setting,
and a fresh `config` call must see that same nonce, because `{ok:true}` from
`announce` is a resolved promise, not proof the setting was persisted. A
write (or its read-back) past two seconds fails the check outright — ordinary
bridge calls run in the tens of milliseconds (MODEL.md), and two seconds is
already what a hung write short of its own timeout looks like, well below
the seconds a `Runtime.evaluate` is given before it gives up entirely.

### The registration digest covers where it was sent, not only what was sent (2026-09-08)

Field evidence: a bot kicked from a guild and reinvited — or repointed at a
different one entirely — kept answering "the guild already holds these N;
nothing to register" forever, because `digest(body)` hashed only the command
bodies and neither changed. Ruled: the digest folds in the application and
guild id (`register.mjs`), so a guild with no memory of the bot's commands
reads as a digest never sent to it, and registers with no operator
intervention. `register-commands.mjs` (`npm run register`, the by-hand form
of the same fix) no longer requires the three Discord values in the
environment either: `install-service.mjs` strips them from the host on
purpose once a Judge holds them in Foundry, so the escape hatch for "the
guild lost its commands" was dead on every supported install. It now takes a
seat and reads `bridgeClient` the same way `main.mjs` boots, falling back to
the environment wherever that already carries a value, and reads the
application id off the token over a plain REST call rather than logging a
gateway client in for a fact the world setting has nowhere to keep.

**Also ruled: a guild invited after the bot is already running is adopted.**
The guild used to resolve once, at login (`client.guilds.cache`), which is
also why a kicked-and-reinvited bot needed a restart before it noticed
anything to register. `Events.GuildCreate` now adopts a newly joined guild
when none is chosen yet (`guild-adopt.mjs`, Discord-free), registers on it,
and re-announces — discord.js only emits that event once the client's own
`Ready` status has already been reached, so it never fires for the guilds
the bot was already in at login and never races the boot-time adoption of a
lone guild.

---

### The seat draws no canvas, and `map` is what pays for one (2026-09-08)

Measured on a field install, not reasoned about. Every document write the seat
made took **47,304 ms**; the same write with the canvas torn down took **12 ms**.
The bot therefore died on its first `announce` — the first write it makes — and
the service manager restarted it 408 times.

Nothing was refused and nothing was dropped. The Foundry server's own log
recorded each write landing immediately; what never arrived in time was the
acknowledgement, because the page's main thread was rasterising a hex battlemap
in software. A headless browser on a host with no GPU renders through
SwiftShader, on the same thread that has to run the socket callback the bot is
awaiting. Foundry says so itself, in a console warning present on every life:
*your web browser does not have hardware acceleration enabled.*

**Ruled.** The seat tears its canvas down as soon as the page is ready. Hardware
acceleration is a knob — `SEAT_GPU` in the environment, **Draw the map** in the
Judge's window — default off, which is both the previous behaviour of the browser
flags and the right answer for the host a bot actually runs on. `map` is the only
command that reads the canvas and answers `unavailable` when there is none. Its
guard runs FIRST, before the `scene.view()` that would otherwise draw the canvas
back and take the seat with it.

Writes still work with no canvas: the field probe created and deleted a
`ChatMessage` in 12 ms after teardown. That is worth recording, because the seat
is sized above Foundry's canvas floor precisely on the grounds that core's chat
speaker dereferences the scene — the floor governs a canvas that initialises, not
one that was never drawn.

**Why it hid for four releases.** `seat:check` called only `commands`, `users`,
`parties` and `whoami` — every one a local read, all of them answered inside the
first 300 ms after `ready`, before the canvas gets going. The check reported OK
all night against a bot that could not start. That is a separate ruling, above.

**Rejected: drawing on demand, so `map` keeps working everywhere.** The bridge is
serialised on purpose, so the fifty seconds a redraw costs is fifty seconds in
which no other member's command is answered. A refusal that names its cause beats
a command that appears to work and stops the table.

**Rejected: keeping the canvas and raising the timeouts.** The timeout is where
the failure surfaced, not what it is. Starvation is paid by every command on the
seat, and a limit generous enough to survive it would turn each of them into a
minute of silence.

**Rejected: core's `noCanvas` client setting.** It is client-scoped, so it lives
in the browser profile's storage — and the seat mints a throwaway profile for
every life, which is what makes a lost socket recoverable. It would be re-set to
its default before every join.

**Cost, stated.** `map` is unavailable on a host without hardware acceleration,
which is the common one. It is recoverable by a Judge with a suitable host and one
checkbox, it says why rather than failing obscurely, and the alternative on those
hosts was never a working `map` — it was a bot that answered nothing at all.

### HOME travels inside the command, not in the runner's environment (2026-09-09)

Field report: `sudo node src/install-service.mjs` on an Ubuntu host stopped at
the dependency step. `npm ci` ran as the service user and died `EACCES` on
`/root/.npm/_cacache`, npm advised making root's cache writable by uid 1001,
and the installer enabled nothing. The installer had set the child's `HOME`
since 7.1.1 — in the environment it handed `runuser`. Both runners re-decide
`HOME` for the user they switch to, so the value reached the runner and stopped
there, and npm resolved its cache under whatever home the root shell had.

**Ruled: the value is set by `env` inside the argv the runner executes.** After
the switch there is no policy left to overrule it, and it reads the same on
both branches. `dependencyCommand` is the one place that argv is built, so a
test can assert the ordering that makes it work.

**Rejected: `sudo -E`.** It was already on the sudo branch and is what made
that branch look correct. It preserves the CALLER's environment — the wrong
`HOME` with it — and a sudoers policy without `SETENV` refuses the flag
outright, turning a wrong home into a failed run. It is dropped.

**Rejected: pre-creating the cache under the state directory.** It fixes npm
and leaves every other child of the runner reading root's home, which is the
class of bug rather than the instance.

**Cost:** an operator who already followed npm's advice owns a `/root/.npm`
chowned to the service user. Nothing reads it after this, so it is untidy
rather than harmful — the guide's troubleshooting entry says to undo it.

### npm's own config does not travel into the dependency step (2026-09-09)

New evidence the same day's ruling above did not have: a second field report,
from the invocation the guide actually documents. `sudo npm run install-service`
fails at the dependency step exactly as `sudo node src/install-service.mjs` did
before it — `EACCES` under `/root/.npm`, npm advising a chown of root's cache,
nothing enabled — and the `HOME` fix cannot touch it. `npm run` exports every
npm setting to the script it runs, resolved against the CALLER's home:
`npm_config_cache=/root/.npm` and `npm_config_userconfig=/root/.npmrc` are in
the installer's environment before it starts. Those names outrank `HOME` in the
child npm's resolution and `runuser -u` scrubs nothing, so the correct `HOME`
arrives and is ignored.

**Ruled: the whole `npm_config_*` family is stripped from the environment the
dependency step is handed** (`withoutNpmConfig`). The child then resolves
against the `HOME` the argv gives it, which is what the service gets at runtime.

**Rejected: naming `npm_config_cache` in the argv beside `HOME`.** It fixes npm
and leaves every other inherited setting — `userconfig`, `prefix` — pointing at
root, which is the same instance-over-class objection the entry above rejected
pre-creating a cache for. Stripping the family answers both.

**Cost:** an operator who set an npm cache or registry config deliberately, in
root's environment, for this install loses it here; the service's own npm never
had it either, so the dependency step and the running service now agree.
