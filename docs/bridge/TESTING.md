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
3. **`commands`** lists the sixteen verbs (`commands, events, whoami,
   characters, use, sheet, rolls, roll, say, users, link, unlink, bindings,
   parties, party, map`).
4. **Unbound.** `whoami` answers `bound: false`; `characters` and `link`
   from the identity answer `unbound`.
5. **Linked by the seat.** `link` with `asSeat` binds the identity to the
   Player user. Then, as the identity: `whoami` reads bound, `judge: false`,
   `active: null`; `characters` lists the owned fixture only.
6. **The guard.** `sheet` before `use` answers `noActive`; `use` on the
   unowned actor and `sheet` by its uuid answer `forbidden`; a Judge verb
   (`users`) answers `forbidden`.
7. **The active character.** `use` sets it; `sheet` answers hp, ac, the
   purse in gp and the five saves; `rolls` lists ids by group, `save:death`
   among them.
8. **A roll.** `roll save:death` answers at least one captured card. The
   card's `flags.acks-extras.bridge` reads `via: "discord"`, the identity's
   user and `command: "roll"` — poll up to three seconds, the stamp is a
   second update after the card. The seat's `event` stream carried a `chat`
   event with the same stamp. `roll save:nope` answers `notFound`.
9. **Words.** `say` posts as the character: `speaker.alias` is the actor's
   name, `speaker.actor` its id, markup arrives escaped, the stamp reads
   `command: "say"`. `style: "emote"` answers the emote style; blank text
   answers `invalid`. A whisper created on the seat reaches the event stream
   with its `whisper` list, which is what the relay refuses on.
10. **Parties.** `parties` (as seat) lists the fixture formation; `party`
    with `channel` and `formationId` binds, `party` with `channel` reads it
    back; `bindings` resolves the Player user, the party and the active
    actor.
11. **The map.** `map` as seat answers the fixture scene and a clip wider
    than a hundred pixels; `Seat.screenshot(clip)` yields a PNG; `map` from
    the identity answers `forbidden`.
12. **Events.** `events since: 0` answers a `seq` of at least one and the
    buffered events; the sequence the seat heard is strictly increasing.
13. **Unbound again.** `party` with `unbind` clears the channel; `unlink`
    clears the identity and `whoami` reads `bound: false`.

### Teardown

Delete both actors, dissolve the formation, delete the scene, delete every
message carrying the walk's stamp or a `Bridge Fixture` alias, and remove
the identity's and the channel's keys from the binding store. Prove it: no
fixture actor resolves, the formation and the scene are gone, the store has
neither key, and the active scene is what it was. The driver runs the
teardown even when a step throws, and starts by removing the same two keys
so a run that died before its teardown cannot fail the next one.

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
the bot is invited to (scopes `bot applications.commands`), a channel, and
the operator's Discord id in `DISCORD_JUDGE_IDS`. Setup is the
[guide](../guides/bridge.md).

### Steps and what proves each

1. **`npm run register`** answers the eight commands; they appear in the
   test server's command picker at once.
2. **`/whoami`** before any link answers, ephemerally, that the member is
   not linked.
3. **`/link set`** from the operator binds a test member to the Player user;
   the Foundry name autocompleted. `/link list` shows it; `/whoami` from the
   member now names the user.
4. **`/character use`** autocompletes only characters the Player owns;
   after it, `/sheet` answers an ephemeral embed and `/sheet public:` a
   visible one.
5. **`/roll`** autocompletes the sheet's throws; the result comes back in
   Discord and the card is in Foundry's chat, stamped.
6. **`/say`** puts the words in Foundry as the character, and the reply in
   Discord is the only Discord copy.
7. **The relay**, with `DISCORD_CHAT_CHANNEL_ID` set: a message posted in
   Foundry appears in the channel; a whisper does not; the roll from step 5
   is not shown a second time.
8. **`/party bind`** in the channel, then **`/map`**, answers a PNG
   attachment of the party's scene; `private:` makes it ephemeral. From the
   member, `/map` is refused.
9. **`/link drop`** and **`/party unbind`** return the server to step 2.
10. **The install.** On the host, `sudo npm run install-service` in the
    module's `discord/` asks its questions and answers with the unit's name;
    `systemctl status acks-extras-discord` is active and the journal shows
    `prestart` installing, the seat ready, the commands registering, the
    login. On any machine, `npm run install-service -- --dry-run` prints the
    two files it would write, with no placeholder left in the unit.
11. **The update.** Install a newer module build through Foundry's Add-on
    Modules. Within a minute the journal reads `module updated … restarting`,
    then `prestart` reinstalling, then the seat ready again; the registration
    line says the commands were unchanged unless the build changed them.
    `/whoami` answers afterwards without any hand on the host.

### Teardown

Drop the test binding and the channel binding; delete the fixture actors in
the world.

The release snapshot for this feature is shot here — `/sheet public:` or
`/map` in a real channel is what a user produces — never from the walk's
fixtures.
