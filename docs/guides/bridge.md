# Playing from Discord

Extras ships a bot that lives on the same machine as your Foundry server,
holds a seat of its own in the world, and lets the members of your Discord
server roll, speak and read their characters without opening Foundry. It is
the first step toward play-by-post: the world keeps every roll and every
word, and Discord is where they are made.

Every command runs **as the Foundry user the member is linked to**. A member
can only use characters that user owns, and the bot's own seat decides
nothing. The Judge links members; nobody links themselves.

## Walkthrough

Eight steps, once. Afterwards the bot follows Foundry's module updater on its
own, and nothing is copied by hand at any point.

### 1. The host

The bot runs on the machine that runs Foundry, as a service beside it. That
machine needs:

- **Linux with systemd** — Debian, Ubuntu and their relatives; a Proxmox VM
  or container is fine.
- **Node 22 or newer.** `node -v` says which you have; Foundry itself runs
  on Node, so it is usually there already.
- **A Chromium-family browser** for the seat: `sudo apt install chromium`.
  Nothing shows on a screen; the bot drives it headless.
- **The Extras module installed** in Foundry, 7.0.0 or later. The bot's code
  is inside it: `discord/` under the module's directory in your Foundry data
  path, `Data/modules/acks-extras/discord`.

### 2. The Discord application

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application**; name it after your table.
2. On the **Bot** page, **Reset Token**. Keep the token where you can paste
   it into a terminal in step 4; the portal shows it once.
3. On the **OAuth2** page, in the URL generator, tick the scopes **bot** and
   **applications.commands**, then the bot permissions **Send Messages**,
   **Embed Links**, **Attach Files** and **Read Message History**. Open the
   URL it makes, pick your server, authorise.
4. Note the **Application ID** on the General Information page.

In Discord itself, turn on **Developer Mode** (User Settings → Advanced).
Right-click your server for **Copy Server ID**, yourself for **Copy User
ID**, and, if you want the world's chat relayed, the channel that should
receive it for **Copy Channel ID**.

### 3. The bot's Foundry user

In Foundry's user management, create a user for the bot: role **Assistant
Gamemaster**, any name ("Discord" reads well in the chat log), and a password
if your world uses them. The bot joins as this user and everything it posts
is credited to it, so keep the user for the bot alone.

### 4. Install the service

On the host, in the bot's directory:

```bash
cd /path/to/foundrydata/Data/modules/acks-extras/discord && sudo npm run install-service
```

It asks, one line at a time, for the token, the application id, the server
id, your user id (the first Judge), the optional chat channel, Foundry's
address as the machine sees it (usually the default), the bot's Foundry user
and password, the browser it found, and the account it will run as (the owner
of the module directory, which is what lets it keep its dependencies there).
Then it writes your answers to `/etc/acks-extras-discord.env`, readable by
root only, renders the systemd unit for this machine, enables it and starts
it. Nothing is downloaded beforehand: the service installs its own
dependencies on its first start.

If `sudo npm` cannot find npm (Node installed through a version manager), run
the script with the node you have instead:

```bash
sudo "$(command -v node)" src/install-service.mjs
```

Watch it come up:

```bash
sudo journalctl -u acks-extras-discord -f
```

The log shows the dependencies installing, the seat joining the world, the
commands registering on your server, and the bot logging in. Run the install
command again whenever an answer changes; Enter keeps what is there.

### 5. First commands

In your server, `/whoami` answers you as the Judge. Link a player with
`/link set member: foundry:`; the Foundry name autocompletes. That player's
`/whoami` now names their user, `/character use` lists what they own, and
`/sheet`, `/roll` and `/say` work as described below. In a party's channel,
`/party bind formation:` ties the channel to a formation and `/map` posts its
scene.

### 6. Staying current

Nothing to do. Update the module in Foundry's **Add-on Modules** like any
other. The bot checks the module's manifest every half minute: when the
updater has replaced the directory it exits, the service restarts it on the
new code, puts its dependencies back if they went with the old directory, and
registers the commands again only if the release changed them. Your answers
and the unit live under `/etc`, which the updater never touches. The journal
shows the whole thing happen.

### 7. Running it by hand instead

On Windows, or on a test box without systemd, put a `.env` beside `src/`
(`.env.example` lists every value, with the Windows browser path as an
example) and run `npm start` in the bot's directory. It installs its own
dependencies when they are missing. After a module update you restart it
yourself.

### 8. Removing it

```bash
sudo npm run install-service -- --remove
```

stops the service and deletes the unit and the environment file. The module
directory is untouched.

## The Judge's commands

- **`/link set member: foundry:`** binds a Discord member to a Foundry user;
  the Foundry name autocompletes. **`/link drop member:`** removes it and
  **`/link list`** shows every binding the world holds. A member linked to a
  Gamemaster user is a Judge in Discord too.
- **`/party bind formation:`** makes the current channel a party's channel;
  the formation autocompletes from the world's parties. **`/party show`**
  and **`/party unbind`** read and drop it.
- **`/map`** posts the party's scene as the bot's seat sees it, centred on
  the party token when the scene has one. `scale:` zooms (1 is the scene's
  own size), `private:` shows it only to you. It is the Judge's view, with
  everything the Judge can see; a players'-eyes map is planned.

## Playing

- **`/whoami`** says which Foundry user you are linked to and who you are
  speaking as.
- **`/character list`** shows the characters you own; **`/character use
  name:`** picks the one you speak and roll as from then on.
- **`/sheet`** shows your character's vitals, saves, purse and what is in
  hand, only to you unless you add `public:`. `character:` reads another
  character you own.
- **`/roll what:`** makes a throw. The list autocompletes from everything the
  character's sheet can roll: saves, checks, initiative, attacks by weapon,
  abilities. The card lands in the world's chat as the character, and the
  result comes back to you in Discord.
- **`/say text:`** speaks in the world's chat as your character; `emote:`
  makes it an action instead of words.

If the bot has a chat channel, the world's public chat appears there as it
happens: what players in Foundry say and roll, and what the Judge posts.
Whispers and blind rolls stay in Foundry, and a roll you made from Discord is
not shown twice.

## When something is off

- **The seat never becomes ready.** The journal names the step: the browser
  path, a world that is not running at the address you gave, or a Foundry
  user that does not exist with that password. Fix the answer by running the
  install command again.
- **The commands do not appear in Discord.** The bot registers them at
  start; check the journal for the registration line and that the server id
  is right. Discord shows guild commands at once.
- **"You are not linked".** The Judge runs `/link set` for you.
- **`/map` answers that the seat has no scene.** Bind the channel to a party
  whose formation has a scene, or have the Judge view one; the seat shows the
  party's scene when the channel has a party.
