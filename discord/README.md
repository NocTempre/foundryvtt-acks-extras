# The Discord bot

A Node service that holds a seat in the world (a headless browser joined as
its own Foundry user) and turns slash commands into the `acksExtras.bridge`
calls the module answers. It runs beside the Foundry server, as its own
process; Foundry never loads anything in this directory, and the module
updater carries it along with the rest of the module.

It is configured from inside Foundry: **Settings → Module Settings → ACKS II
Extras → Discord Bot** holds the token (sealed to a key this process keeps on
the host), the Discord server and the relay channel. The environment carries
only what gets the bot to the world, and wins wherever it is set.

Setup, the commands and what they may do:
<https://github.com/NocTempre/foundryvtt-acks-extras/blob/main/docs/guides/bridge.md>.
In short, on the Foundry host: `sudo npm run install-service` here and press
Enter through its questions, then paste the token in Foundry — updates need
nothing further. By hand elsewhere: a `.env` from `.env.example`, then
`npm start`.
