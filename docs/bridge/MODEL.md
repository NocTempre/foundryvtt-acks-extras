# Bridge — how it works now

A command surface for a client outside Foundry (`scripts/bridge/`). The first
client is the Discord service in `discord/`: this repo's own Node process,
run beside the Foundry server. This feature is everything that has to live
INSIDE the world for such a client to act, and nothing about how the client
presents it. Why it is shaped this way is
[DECISIONS.md](DECISIONS.md); what is not built is [ROADMAP.md](ROADMAP.md);
the live-test recipe is [TESTING.md](TESTING.md); the user-facing setup is
[the guide](../guides/bridge.md).

## The shape

```
client (Discord)  ──slash command──▶  discord/ (Node service, on the Foundry host)
                                        │ holds a SEAT: a headless browser joined
                                        │ to the world as the bot's own user
                                        ▼  Runtime.evaluate
                                acksExtras.bridge.run(name, { client, ...args })
                                        │ resolve the BOUND Foundry user; guard
                                        ▼
                    the sheet's roll-by-id · the frame snapshot · core chat · formation's record
                                        │
                     hooks ──▶ event tap ──▶ window.acksExtrasBridgeEmit(json) ──▶ the seat
```

Foundry has no server-side module runtime — `esmodules` run in browsers and
nowhere else — so a client that wants the rules the module performs has to
reach a running client. The seat IS that client: a browser the service owns,
sized above Foundry's canvas floor, watched and relaunched. Everything the
service does in the world is `Runtime.evaluate` of one call; everything it
hears is the tap calling one global. The join mechanics are the release
capture driver's (`acks-module-template/bin/foundry-capture.mjs`).

**The seat draws nothing.** Once the page is ready the canvas is torn down,
because a browser without hardware acceleration rasterises the scene on the
same thread that has to answer the bot — with a canvas up, a document write
costs tens of seconds instead of tens of milliseconds, which is past every
timeout the bridge has. A Judge who has a host with a GPU turns **Draw the
map** on and gets a canvas; everyone else has one command fewer and a bot that
answers. `map` is that command, and it refuses rather than redrawing
([DECISIONS.md](DECISIONS.md)).

## The registry and its one guard

`registry-logic.mjs` (Foundry-free) holds one name → one handler. `run(name,
args)` never throws: the answer is `{ok: true, data}` or `{ok: false, code,
message}`, JSON both ways, and `constants.mjs` `ERR` is the whole code
vocabulary a client maps to its own words.

Before any handler runs, the guard resolves **who is acting**: `args.client`
(`{kind, user, guild, channel, message}`) is looked up in the binding store,
and the handler runs as that Foundry user — never as the seat, whose Assistant
GM rights decide nothing. A handler that touches a document calls
`requireOwner(ctx, doc)`, which asks the document `testUserPermission(user,
"OWNER")` for the bound user. A command declared `judge` requires the bound
user to be a GM. A command declared `allowUnbound` (`whoami`, `events`,
`commands`) runs with `ctx.user === null`.

`asSeat` is the one bypass, and it is the client's operator's: the service
sets it only for a Judge command from a member its own configuration names as
a Judge, and the command then runs as the seat's user. That is how the first
Judge is linked before any binding exists. The seat holder has full access to
the page regardless; the flag only lets the bootstrap travel the same path as
everything else.

## The binding store

One hidden world setting (`bridgeBindings`, `config: false`), three maps,
all arithmetic in `bindings-logic.mjs` (Foundry-free, returns new stores):

| map | key | value |
|---|---|---|
| `users` | `<kind>:<externalId>` (a Discord user id) | Foundry user id |
| `parties` | `<kind>:<channelId>` | formation id |
| `active` | Foundry user id | the actor uuid that user speaks as |

Bindings are Judge-made (`link`, `unlink`, `enroll`, `party`), never
self-claimed; a user chooses their own active character among the actors
they own (`use`). Unbinding an identity clears the active character only
when no other identity still reaches that user. The store is keyed by client
kind so a second client can share it.

The Judge has two doors onto the same store: the client's `/link` verbs, and
the **Discord Members** window in Foundry (`apps/members.mjs`), which lists
every binding, links a member to a user, and makes the user first when there
is none. Both run the same arithmetic over the same setting.

## Accounts

A Foundry user can be made, and its password set, from the client — within
what the SEAT may do, which Foundry decides server-side by the seat's own
role: an Assistant may create users below a Gamemaster and change any
non-Gamemaster's password, and nothing this module asks widens that.

- **`enroll`** (a Judge, or the window's *Create & link*) creates a **Player**
  — never higher — with a password nobody knows (`accounts-logic.mjs`
  `randomSecret`), and binds the identity to it in the same call. Until the
  member sets a password, nobody can join as that user.
- **`password`** sets the bound user's OWN password, at least eight
  characters, and refuses a Gamemaster's whatever the seat could do — a
  Discord account must never be the key to a Judge's seat. Foundry
  invalidates that user's open sessions on the change.

The password arrives as a slash-command option: the client never logs it,
and from the seat to the server it travels as the join screen would send it.

## Dice

**`dice`** throws any formula core's `Roll` accepts, for anyone — bound or
not — and answers the total and every die. Core's parser is the judge of a
formula (`Roll.validate`); this feature adds only a ceiling on length and on
the number of dice, because `10000d10000` is a request to hang the seat. A
member with an active character has the throw kept in the world's chat as
that character, stamped; an unbound member, or one with no character chosen,
rolls in the client alone.

## The configuration and the announcement

A client is configured **in Foundry**, not on the host it runs on. Two more
hidden world settings carry it, one writer each:

| setting | written by | holds |
|---|---|---|
| `bridgeClient` | the Judge's window (`apps/client-config.mjs`) | the Discord server, the relay channel and whether to relay, extra Judges, the seat's size, join timeout and whether it draws a canvas, the log level, and the bot token **sealed** |
| `bridgeAgent` | the client itself, through `announce` | its public key, its version, what it is doing, its application, the servers and channels it can see, and the members it has heard from |

Neither side edits the other's record. The window offers dropdowns for the
server and the channel out of the client's announcement, and plain id fields
before one has arrived. The members it lists are the ones who have run any
command — listing a server's members outright needs a privileged intent, and
a member who has knocked has named themselves — kept most-recent-first,
capped, and carried across the client's restarts by the record itself.

**The token is sealed, because a world setting is public.** Foundry vends the
whole settings table to every connected client, so the client generates a key
pair on the machine it runs on, publishes only the public half, and the
window encrypts to it (`sealing.mjs`, one implementation both halves run —
with the encrypting half written out by hand, because `crypto.subtle` is
absent from the plain-http world most self-hosted Foundry servers are).
The window never reads a token back — it shows a length and four characters.
A token sealed to a key the client no longer holds reads as `staleToken` in
the window rather than as a login that quietly fails.

`configDigest` is what a running client compares. It covers what the client
is configured **by**, so a form saved with nothing changed does not restart a
bot; `revision` rises on every save and tells the window whether the running
client has caught up yet. `restartNonce` is in the digest and in nothing
else: the window's **Restart the bot** button (`requestRestart`) moves it, and
a running client restarts on that as on any change. The button is offered only
while an announcement is fresh, because the request travels through the world
— a client that is not running hears nothing, and starting or installing one
is the host's to do (`docs/guides/bridge.md`).

## Provenance

Every document a command creates carries `flags["acks-extras"].bridge =
{via, user, guild, channel, message, at, command}` (`provenance.mjs`). A roll
is the exception the tap handles: core's rollers post their card without
awaiting the create, so the card lands a beat after the command returns and
the command cannot stamp it. `roll` therefore marks the actor **in flight**
for its duration; the tap, seeing a message this client posts for that
speaker while the mark stands, stamps the message and the event alike. The
relay reads the stamp to skip what the client already showed.

## The event tap

`events.mjs` folds the hooks a client cares about into one plain-JSON stream
with a running `seq`: `chat` (speaker, whisper list, blind, flavor, plain
text, every roll's total and dice), `actor` (HP or XP changed), `time`
(`updateWorldTime`), `henchmen` (the ledger hooks), `config` (the client's
own configuration was saved). Each event is kept in a
bounded page buffer and, when a seat holder has installed the global named
`EMIT_BINDING`, pushed as it happens. `drain(since)` answers a seat that
connects late. The buffer is the page's: a reload starts it over, which a
`seq` going backwards tells the seat. Visibility travels WITH the event —
`whisper` and `blind` as the message has them — so the client routes a secret
rather than flattening it.

## The commands (v1)

| command | runs as | over |
|---|---|---|
| `whoami` | anyone | the store |
| `characters`, `use` | bound user | `game.actors` the user OWNS |
| `sheet` | owner | `characterSheet.snapshotFrame` + the purse (`coinTotalGC`) |
| `rolls` | owner | `characterSheet.rollInventory`, flattened to `{id, label, value, group}` |
| `roll` | owner | `characterSheet.rollById(actor, id, {event})` with a synthetic event carrying the world's skip-dialog key, so core posts without its dialog; answers the cards it captured |
| `say` | owner | `ChatMessage.create` with `speaker.alias` the character, IC or EMOTE style, stamped |
| `password` | bound user, own account, never a Gamemaster's | `User#update` |
| `users`, `link`, `unlink`, `bindings` | Judge | the store |
| `enroll` | Judge | `User.create` as a Player, then the store |
| `parties`, `party` | Judge | `formation.getFormations` / `getFormation`, the store |
| `map` | Judge | views the party's scene on the seat, pans to its party token, and answers the board's clip; the seat takes the PNG. `unavailable` on a seat that draws no canvas |
| `dice` | anyone | core's `Roll`; `Roll#toMessage` as the active character when there is one |
| `events`, `commands` | anyone | the tap, the registry |
| `config`, `announce` | the client, as the seat | the two settings above |

`map` is the Judge's view — every token, no fog — which is why only a Judge
may ask for it (DECISIONS). A player-vision map is on the roadmap.

## What the service adds

The service (`discord/`) is the seat holder, one serialised bridge
client, the slash commands, and a relay of the world's public chat into one
channel.

**What it is told, and where.** Its environment carries only what gets it to
a world — `FOUNDRY_ORIGIN`, `FOUNDRY_USER`, `FOUNDRY_PASSWORD`, and a
`BROWSER` it finds by itself in the usual places. Everything else it reads
from `bridgeClient` once the seat is up, and the environment wins wherever it
carries a value. A bot with no token yet is not a failure: it announces
`awaiting` and sits on its seat until a Judge saves the window — with its
signal handlers and its update watch already armed, so a bot that has never
been configured still follows a module update and still stops on request. It caches the
last configuration it saw in its state directory, because the seat it must
build to read the world is sized by that configuration. The first Judge is
the Discord server's owner, whose id arrives with the guild and needs no
privileged intent. Its discipline: defer every interaction inside Discord's three
seconds, then edit; autocomplete from `characters` / `rolls` / `users` /
`parties`; ephemeral replies for what is the member's own, public for what
the table should see; the interaction reply IS the Discord copy of a bridge
action, so the relay skips stamped messages. Every chat command it answers
notes the member (`onMember`) and the next announcement carries them.

**A bridge call that fails at startup is retried, not fatal.** The first
`announce` (`main.mjs`) can fail before the world is reachable at all — the
world still booting, a slow first `Runtime.evaluate` — and a failure there
retries on the seat's own backoff (`reconnectDelay`, five seconds doubling to
a minute) rather than exiting, logging what failed and how long until the
next attempt. Nothing else in the running process is allowed to take the
process down silently either: `unhandledRejection` and `uncaughtException`
are caught at the top level, logged, and answered with the same shutdown a
signal gets — seat and Discord client torn down — except the exit code is 1,
not 0, so the journal tells an unhandled failure apart from a restart the
process chose for itself (a module update, a configuration change, a
signal). The unit's own `StartLimitIntervalSec`/`StartLimitBurst`
(`deploy/acks-extras-discord.service`) is the backstop above that: a failure
neither retry survives parks the unit as failed after repeated restarts in
one window, instead of restarting every ten seconds forever.

**A guild invited to the bot while it is already running is adopted, not
ignored.** The guild the bot logs into with is only resolved once, at login
— but a Judge inviting the bot to a server AFTER it is already running (the
common shape of "the bot lost its commands and I reinvited it") fires
`Events.GuildCreate`, and a bot with no server chosen yet adopts that guild
exactly as it would adopt the one guild it found itself in at login:
`guild-adopt.mjs`'s `adoptGuild` (Discord-free, one decision) makes the
guild's owner a Judge, the guild the configured one, registers the commands
on it, and re-announces so the Foundry window sees it at once. A bot already
pointed at a guild ignores a second invite; that is the Judge's to resolve in
Foundry, not the bot's to grab.

**One `/roll` for dice and throws.** `/roll what:` names either a sheet
throw by its id or a dice formula; the shape decides (`format.mjs`
`looksLikeDice`: a die in it and no colon). A formula goes to `dice` and
answers publicly, naming the member and, when the world kept it, the
character. Inline dice in ordinary messages (`!roll 2d6`) would need the
privileged Message Content intent and is on the roadmap, not here.

**Restarting on a change.** The tap emits a `config` event when the setting
is saved; the client compares the digest and, if it is now running the wrong
thing, exits 0 for the service manager — the same clean exit a module update
uses. A poll every half minute is the floor under a seat that reconnected and
missed the event.

**Staying current.** The service runs from the module directory Foundry's
updater replaces, and follows it without an operator: `install-service`
renders the systemd unit and the environment file under `/etc`, outside that
directory, and runs `prestart` itself, in the foreground and as the service's
user, before enabling anything — re-running it is the whole install over
whatever an earlier attempt left; `prestart` (the unit's `ExecStartPre`, and
`npm start`'s own pre-step) reinstalls dependencies only when `node_modules`
is missing, incomplete, or older than the lock; the running bot polls the module manifest
and exits cleanly when it vanishes and returns, so the service manager
restarts it on the new files; and registration runs at every start, sending
the commands only when their digest differs from the last one sent, kept in
the unit's state directory. That digest (`register.mjs`) covers the
application and guild id alongside the command bodies, not the bodies alone —
a guild that lost its registration without a single command changing (the
bot kicked and reinvited, or repointed at a different server) still reads as
a digest it has never sent, and registers again with no `--force` needed.

**`npm run register` reads the same configuration the running bot does.**
The token, application and guild a Judge sets live in Foundry, and
`install-service` deliberately strips them from the host's environment file
once they do — so the by-hand form for "the guild lost its commands" cannot
assume they are on the host. When the environment does not already carry a
token and a guild, `register-commands.mjs` takes a seat, reads
`bridgeClient` the way `main.mjs` boots (`ensureKeyPair`, `readWorld`,
`openToken`, `applyWorldConfig`), and asks Discord for the application id
over a plain REST call (`/applications/@me`) rather than logging a gateway
client in — `bridgeClient` has nowhere to keep an application id, since
nothing that reads it needs one. A dev run with the three Discord values
already in the environment never touches a world.

## Not here

Nothing in `scripts/bridge/` knows a rule, renders a window, or registers
anything another feature consumes. A verb that needs a headless entry point
another feature lacks (level-up, the score roll) is that feature's refactor,
listed on the roadmap.
