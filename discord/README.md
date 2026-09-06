# The Discord bot

A Node service that holds a seat in the world (a headless browser joined as
its own Foundry user) and turns slash commands into the `acksExtras.bridge`
calls the module answers. It runs beside the Foundry server, as its own
process; Foundry never loads anything in this directory, and the module
updater carries it along with the rest of the module.

Setup, the commands and what they may do:
<https://github.com/NocTempre/foundryvtt-acks-extras/blob/main/docs/guides/bridge.md>.
In short, on the Foundry host: `sudo npm run install-service` here, answer
its questions, done — updates need nothing further. By hand elsewhere: a
`.env` from `.env.example`, then `npm start`.
