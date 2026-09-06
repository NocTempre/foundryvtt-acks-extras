# Bridge — live-test recipe

Two halves, walked separately. The **world half** (`scripts/bridge/`) is
driven through the service's own seat holder, headless, and needs only the
test world. The **Discord half** (`discord/`) needs a bot token and a Discord
server, which the repo never holds; its recipe is the second section. The
canonical procedure (fixtures you create and destroy, real seats, what to
report) is `.claude/rules/live-testing.md`.

## The world half

`tools/bridge-walk.mjs` walks everything below in one run and prints a
verdict per check. It imports the seat holder from `discord/src/` (no
`npm ci` needed; the seat uses nothing outside Node) and reads the machine's
values from the environment — `BROWSER`, `FOUNDRY_ORIGIN`, `FOUNDRY_USER`,
optionally `FOUNDRY_PASSWORD` — which come from `TEST_ENVIRONMENT.md` and
never from a file in the repo. Run it from the repo root with output to a
log, then read the log; a browser walk takes about a minute.

### Fixtures

- **The seat**: the test world's Assistant Gamemaster user, passed as
  `FOUNDRY_USER`. The driver joins as it; nothing is created.
- **A second GM online** (optional): join the browser pane as the world's
  Gamemaster first, and the run also observes which of the two is
  `game.users.activeGM`.
- **Two characters**: one owned by the world's Player seat, one owned by
  nobody. Both named `Bridge Fixture — …`.
- **A scene**, created and *viewed* on the seat, never activated: viewing is
  client-local, activating changes the world for everyone online.
- **A formation**, created through the formation feature's own model in page
  context — `import("/modules/acks-extras/scripts/formation/formation-model.mjs")`
  gives `createFormation(name, {actorId})`, `getFormation(id)` and
  `dissolveFormation(formation)`; the `acksExtras.formation` api exposes no
  creator.
- **A fake external identity**, `{kind: "discord", user, channel}`, that no
  real Discord member has.

### Steps and what proves each

1. **The seat joins.** `game.user.name` is `FOUNDRY_USER`, role 3, `isGM`.
   With a Gamemaster online, `game.users.activeGM` is the Gamemaster, not the
   seat: Foundry designates the highest role and only ties fall to the id.
2. **The scene draws.** `canvas.ready` with the fixture scene as
   `canvas.scene`. Poll for it: a `view()` issued while the first draw is
   still loading is dropped with a console warning.
3. **`commands`** lists the twenty-one verbs (`commands, events, whoami,
   characters, use, sheet, rolls, roll, say, users, link, unlink, bindings,
   parties, party, map, config, announce, dice, enroll, password`).
4. **Unbound.** `whoami` answers `bound: false`; `characters`, `link` and
   `config` from the identity answer `unbound`. **`dice`** from the same
   unbound identity answers a total inside the formula's range, one result
   per die, `messageId: null` and `actor: null` — the world kept nothing;
   `2d6+(` answers `invalid` (core's parser refused it) and `5000d6`
   answers `invalid` (the dice cap).
5. **The configuration handshake.** `announce` as the seat records a key, a
   catalogue and the members it has heard from, and answers the Judge's
   configuration in the same call; `config` reads back the same pair. A secret sealed **in the page** — by the
   same `sealing.mjs` the config window uses — opens with the private half
   the walk holds, which is the handshake end to end: a seal proved in Node
   alone proves the algorithm and not the browser the Judge types into. The walk writes only the CLIENT's record — the Judge's
   configuration is read and never touched, so a configured world stays
   configured.
6. **Linked by the seat.** `link` with `asSeat` binds the identity to the
   Player user. Then, as the identity: `whoami` reads bound, `judge: false`,
   `active: null`; `characters` lists the owned fixture only.
7. **The guard.** `sheet` before `use` answers `noActive`; `use` on the
   unowned actor and `sheet` by its uuid answer `forbidden`; a Judge verb
   (`users`) answers `forbidden`.
8. **The active character.** `use` sets it; `sheet` answers hp, ac, the
   purse in gp and the five saves; `rolls` lists ids by group, `save:death`
   among them. **`dice`** now answers `actor` and a `messageId`: the message
   has the character as `speaker.alias` and `speaker.actor`, its first
   roll's total is the answer's, and its stamp reads `command: "dice"` with
   the identity's user.
9. **A roll.** `roll save:death` answers at least one captured card. The
   card's `flags.acks-extras.bridge` reads `via: "discord"`, the identity's
   user and `command: "roll"` — poll up to three seconds, the stamp is a
   second update after the card. The seat's `event` stream carried a `chat`
   event with the same stamp. `roll save:nope` answers `notFound`.
10. **Words.** `say` posts as the character: `speaker.alias` is the actor's
    name, `speaker.actor` its id, markup arrives escaped, the stamp reads
    `command: "say"`. `style: "emote"` answers the emote style; blank text
    answers `invalid`. A whisper created on the seat reaches the event stream
    with its `whisper` list, which is what the relay refuses on.
11. **Parties.** `parties` (as seat) lists the fixture formation; `party`
    with `channel` and `formationId` binds, `party` with `channel` reads it
    back; `bindings` resolves the Player user, the party and the active
    actor.
12. **The map.** `map` as seat answers the fixture scene and a clip wider
    than a hundred pixels; `Seat.screenshot(clip)` yields a PNG; `map` from
    the identity answers `forbidden`.
13. **Events.** `events since: 0` answers a `seq` of at least one and the
    buffered events; the sequence the seat heard is strictly increasing.
14. **Unbound again.** `party` with `unbind` clears the channel; `unlink`
    clears the identity and `whoami` reads `bound: false`.
15. **Accounts.** With a second identity: `enroll` from it answers `unbound`
    (only the seat or a bound Judge may); `enroll` as the seat with the name
    `Bridge Fixture User` answers a user of role 1 and `created: true` — the
    user's id is the walk's fixture; `whoami` from the identity is bound to
    it and `judge: false`; `enroll` again for the same identity, and for
    another identity with the same name in any case, both answer `invalid`.
    `password` from the identity with `short` answers `invalid`; with a real
    one answers `changed: true` — the seat performed `User#update` as an
    Assistant, which Foundry allows for a Player; from the unbound first
    identity it answers `unbound`. Bound for one call to a Gamemaster user,
    the first identity's `password` answers `forbidden`, then the binding is
    dropped. Nothing verifies the new password by joining as the user: the
    server hashes it and vends neither field, so the answer and the absence
    of a refusal are the observable.

### Teardown

Delete both actors, the enrolled user, dissolve the formation, delete the
scene, delete every message carrying the walk's stamp or a `Bridge Fixture`
alias, and remove both identities' and the channel's keys from the binding
store. Prove it: no fixture actor resolves, the user is gone, the formation
and the scene are gone, the store has none of the three keys, and the
active scene is what it was. The driver runs the teardown even when a step
throws, and starts by removing the same keys so a run that died before its
teardown cannot fail the next one. A run that died after `enroll` and before
its teardown leaves `Bridge Fixture User` in the world: delete it **by the
id the log printed** (the `enroll` check's detail), never by name, and the
next run's `enroll` then succeeds again.

### The Members window

Walked by hand in the browser pane, as the Gamemaster — the window is the
same store the walk exercised, through real gestures:

1. **Settings → Module Settings → ACKS II Extras → Discord Members** opens;
   the member dropdown offers whoever the last announcement carried (after
   the walk: `The Walker`), and never anyone already linked.
2. **Link.** Pick a member and the Player user, press Link: a row appears,
   `bridgeBindings.users` holds `discord:<id>`. Its Unlink removes both.
3. **Create & link.** Paste an id, type a name, press Create & link: a
   Player user of that name exists, the row shows it, and the store holds
   the key. The user's id is your fixture — Unlink, then delete it by id.
4. **A bad id** (`abc`) answers a warning and writes nothing.
5. **A Player seat** sees neither the Discord Bot nor the Discord Members
   menu (both `restricted`), and can read `bridgeAgent.members` — names and
   ids, which is what the record is for — but never a token.

### Drive mechanics worth knowing

- The join sequence, the window size the canvas needs, and how the browser
  is killed are all in `discord/src/seat.mjs`; the walk reuses them rather
  than re-deriving them.
- A raw `Runtime.evaluate` must answer plain data. Returning a document
  fails with "Object reference chain is too long"; return its id.
- Core's rollers post their card without awaiting it, which is why the
  bridge stamps roll cards from the event tap and why the recipe polls.
- The seat forwards the page's console warnings and errors as `console`
  events; a quiet console during a roll is part of the observable.

## The Discord half

Needs a Discord application whose token the operator holds, a test server
the bot is invited to (scopes `bot applications.commands`) and a channel.
Nothing else: the bot is configured from inside Foundry and the server's
owner is a Judge without being listed anywhere. Setup is the
[guide](../guides/bridge.md).

### Steps and what proves each

1. **The handshake, before any token.** Start the bot with a `.env` carrying
   only the Foundry values. The journal reads `no bot token yet`; in Foundry,
   **Settings → Extras → Discord Bot** shows *The bot is waiting to be
   configured*, names no gap about a missing client, and its token field is
   enabled — which is only true once the bot's key has arrived. In a
   **player's** browser console,
   `game.settings.get("acks-extras", "bridgeClient")` is reachable (every
   world setting is), and after the next step its `token.sealed` is
   ciphertext, not the token: that comparison is the point of the design and
   is part of the pass.
2. **Paste the token and save.** The window says it saved; within half a
   minute the journal reads `the configuration changed in Foundry;
   restarting`, then the seat rejoining, then the login. Re-open the window:
   the state is *online*, the application is named, and the server dropdown
   now lists the servers the bot is in — proof the announcement travelled
   back. Save the form again with nothing changed: the bot does **not**
   restart (the digest, not the revision, decides). Press **Restart the
   bot**: the toast says the restart is requested, the journal reads `the
   configuration changed in Foundry; restarting` with no field of the form
   changed, and the bot is back online within half a minute. The button is
   absent while the bot has not announced within the last two minutes.
3. **`npm run register`** answers the nine commands; they appear in the
   test server's command picker at once. A bot configured in Foundry has
   already registered them at its start — this step is the by-hand form and
   needs the Discord values in the environment.
4. **`/whoami`** before any link answers, ephemerally, that the member is
   not linked — and names both ways to be linked. Within a few seconds the
   Members window in Foundry offers that member by their server name: the
   knock was announced.
5. **`/link set`** from the operator binds a test member to the Player user;
   the Foundry name autocompleted. `/link list` shows it; `/whoami` from the
   member now names the user. Then link a second test member in the
   **Members window** instead, and their `/whoami` names the user too — the
   two doors write one store.
5a. **`/roll 2d6+3`** from an unlinked member answers publicly with the
    member's name, the total and each die, and nothing lands in Foundry's
    chat. `/roll what:` while typing `2d6` offers the formula itself as the
    one choice; typing `sav` offers the sheet's throws to a linked member
    with a character and nothing to anyone else. From a linked member with
    an active character, the same roll also lands in Foundry's chat as the
    character, and the relay does not show it a second time.
5b. **`/account create member: name:`** from the operator makes a Player
    user and links the member; the reply says they set their own password.
    Run it again for the same member: refused as already linked. From a
    non-Judge member: refused. **`/account password new:`** from that member
    (eight characters or more) answers that it is set — then join Foundry as
    that user with that password, which is the one observable the world
    half cannot give. From a member linked to a Gamemaster user: refused
    with the reason. Nothing in the journal carries the password.
6. **`/character use`** autocompletes only characters the Player owns;
   after it, `/sheet` answers an ephemeral embed and `/sheet public:` a
   visible one.
7. **`/roll`** autocompletes the sheet's throws; the result comes back in
   Discord and the card is in Foundry's chat, stamped.
8. **`/say`** puts the words in Foundry as the character, and the reply in
   Discord is the only Discord copy.
9. **The relay**, with a channel chosen in the window: a message posted in
   Foundry appears in the channel; a whisper does not; the roll from step 7
   is not shown a second time. Turning **Relay chat** off and saving
   restarts the bot and silences it without clearing the channel.
10. **`/party bind`** in the channel, then **`/map`**, answers a PNG
    attachment of the party's scene; `private:` makes it ephemeral. From the
    member, `/map` is refused.
11. **`/link drop`** and **`/party unbind`** return the server to step 4.
12. **The install.** On the host, `sudo npm run install-service` in the
    module's `discord/` asks only where Foundry is, who to join as and which
    browser — every answer already filled in on a stock host — then shows
    npm installing the dependencies as the service's user, and ends with
    `systemctl is-active` reading `active` and the journal's first lines;
    `systemctl status acks-extras-discord` is active and the journal shows
    the seat ready, the commands registering, the login. Run it a second
    time over the first: same result, and any Discord value an earlier
    environment file held is named as dropped. On any machine, `npm run install-service -- --dry-run` prints the
    two files it would write, with no placeholder left in the unit.
13. **The update.** Install a newer module build through Foundry's Add-on
    Modules. Within a minute the journal reads `module updated … restarting`,
    then `prestart` reinstalling, then the seat ready again; the registration
    line says the commands were unchanged unless the build changed them.
    `/whoami` answers afterwards without any hand on the host.
14. **A key the bot lost.** Delete `client-key.json` from the bot's state
    directory (`/var/lib/acks-extras-discord`) and restart it. The window
    reads *the stored token was sealed to a key this bot no longer holds*,
    and the journal says the same rather than failing to log in for no
    visible reason. Pasting the token again fixes it.

### Teardown

Drop the test bindings and the channel binding; delete the fixture actors
and the user `/account create` made, by id, in the world. The two
configuration settings are the world's own state, not fixtures: leave the
test world configured, or clear the token with the window's own button.

The release snapshot for this feature is shot here — `/sheet public:` or
`/map` in a real channel is what a user produces — never from the walk's
fixtures.
