/**
 * The client configuration's arithmetic, Foundry-free: the shape of what a
 * Judge sets, the shape of what a client announces about itself, and the
 * digest a running client compares to know its configuration moved.
 *
 * Two records with one writer each — the window writes the configuration,
 * the client writes the announcement — so neither side merges the other's
 * fields and there is no write race between a browser and a bot.
 */

/** Log levels a client may be set to, coarsest first. */
export const LOG_LEVELS = Object.freeze(["error", "warn", "info", "debug"]);

/** States a client announces. `unseen` is the absence of an announcement, never announced. */
export const AGENT_STATES = Object.freeze(["unseen", "starting", "awaiting", "online", "error"]);

const str = (v) => String(v ?? "").trim();
/** A Discord snowflake, or "" — the window and the client both refuse anything else silently rather than storing junk. */
const id = (v) => (/^[0-9]{5,25}$/.test(str(v)) ? str(v) : "");
const int = (v, fallback, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};
const ids = (v) => [...new Set((Array.isArray(v) ? v : str(v).split(/[\s,]+/)).map(id).filter(Boolean))];

/** The configuration of a client nobody has configured yet. */
export const emptyClientConfig = () => ({
  discord: { guildId: "", chatChannelId: "", judgeIds: [], relay: true },
  seat: { width: 1600, height: 1000, readySeconds: 120, gpu: false },
  service: { logLevel: "info" },
  token: { sealed: "", keyId: "", hint: "" },
  restartNonce: 0,
  revision: 0,
  updatedAt: 0,
});

/** Anything read out of the setting, as the shape above. Unknown fields are dropped, not carried. */
export function normalizeClientConfig(raw) {
  const base = emptyClientConfig();
  const r = raw && typeof raw === "object" ? raw : {};
  const d = r.discord && typeof r.discord === "object" ? r.discord : {};
  const s = r.seat && typeof r.seat === "object" ? r.seat : {};
  const v = r.service && typeof r.service === "object" ? r.service : {};
  const t = r.token && typeof r.token === "object" ? r.token : {};
  return {
    discord: {
      guildId: id(d.guildId),
      chatChannelId: id(d.chatChannelId),
      judgeIds: ids(d.judgeIds),
      relay: d.relay === undefined ? true : !!d.relay,
    },
    seat: {
      width: int(s.width, base.seat.width, 640, 4096),
      height: int(s.height, base.seat.height, 480, 4096),
      readySeconds: int(s.readySeconds, base.seat.readySeconds, 10, 900),
      // Off is the answer for the headless host a bot usually runs on, and the
      // one a world that predates the field upgrades into: a seat with no GPU
      // draws its scene on the page's own thread and starves everything the
      // bot awaits. On costs that and buys `map`.
      gpu: !!s.gpu,
    },
    service: { logLevel: LOG_LEVELS.includes(str(v.logLevel)) ? str(v.logLevel) : base.service.logLevel },
    token: { sealed: str(t.sealed), keyId: str(t.keyId), hint: str(t.hint) },
    // A stamp the window sets to ask for a restart and nothing else reads:
    // it is in the digest, so moving it restarts a running client.
    restartNonce: int(r.restartNonce, 0, 0, Number.MAX_SAFE_INTEGER),
    revision: int(r.revision, 0, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: int(r.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/** How many members a client remembers having heard from. A table's roster is dozens; the cap is against a public server. */
export const MEMBER_CAP = 200;

/** The announcement of a client that has never announced. */
export const emptyAgent = () => ({
  kind: "discord",
  version: "",
  keyId: "",
  publicKey: null,
  status: { state: "unseen", message: "", at: 0 },
  application: { id: "", name: "" },
  guilds: [],
  channels: [],
  members: [],
  revisionSeen: 0,
  seenAt: 0,
});

/** Anything read out of the announcement setting, as the shape above. */
export function normalizeAgent(raw) {
  const base = emptyAgent();
  const r = raw && typeof raw === "object" ? raw : {};
  const st = r.status && typeof r.status === "object" ? r.status : {};
  const app = r.application && typeof r.application === "object" ? r.application : {};
  const list = (v, fields) =>
    (Array.isArray(v) ? v : [])
      .map((e) => (e && typeof e === "object" ? Object.fromEntries(fields.map((f) => [f, f === "id" || f.endsWith("Id") ? id(e[f]) : str(e[f])])) : null))
      .filter((e) => e?.id);
  return {
    kind: str(r.kind) || base.kind,
    version: str(r.version),
    keyId: str(r.keyId),
    publicKey: r.publicKey && typeof r.publicKey === "object" ? r.publicKey : null,
    status: {
      state: AGENT_STATES.includes(str(st.state)) ? str(st.state) : "unseen",
      message: str(st.message),
      at: int(st.at, 0, 0, Number.MAX_SAFE_INTEGER),
    },
    application: { id: id(app.id), name: str(app.name) },
    guilds: list(r.guilds, ["id", "name"]),
    channels: list(r.channels, ["id", "name", "guildId"]),
    members: list(r.members, ["id", "name", "displayName"]).slice(0, MEMBER_CAP),
    revisionSeen: int(r.revisionSeen, 0, 0, Number.MAX_SAFE_INTEGER),
    seenAt: int(r.seenAt, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

/**
 * Remember a member the client has heard from, most recent first, one entry
 * per id, capped. Answers the same list when nothing changed, so a caller
 * can tell whether an announcement is due by identity.
 *
 * The list exists because enumerating a server's members needs a privileged
 * intent; a member who has run any command has named themselves, and that is
 * enough for a window to offer them in a dropdown.
 */
export function noteMember(members, member) {
  const m = { id: id(member?.id), name: str(member?.name), displayName: str(member?.displayName) };
  if (!m.id) return members;
  const list = Array.isArray(members) ? members : [];
  const at = list.findIndex((e) => e?.id === m.id);
  const same = at >= 0 && list[at].name === m.name && list[at].displayName === m.displayName;
  if (same && at === 0) return list;
  return [m, ...list.filter((e) => e?.id !== m.id)].slice(0, MEMBER_CAP);
}

/** The display a window gives a member: their server name, else their account name, else the bare id. */
export const memberLabel = (member) => str(member?.displayName) || str(member?.name) || str(member?.id);

/**
 * A stable digest of everything a running client is configured BY. Revision
 * moves on every save; this moves only when the client would run
 * differently, so a saved form that changed nothing does not restart a bot.
 */
export function configDigest(config) {
  const c = normalizeClientConfig(config);
  return JSON.stringify([c.discord.guildId, c.discord.chatChannelId, [...c.discord.judgeIds].sort(), c.discord.relay, c.seat.width, c.seat.height, c.seat.readySeconds, c.seat.gpu, c.service.logLevel, c.token.sealed, c.token.keyId, c.restartNonce]);
}

/**
 * What still stands between this configuration and a bot that answers, in
 * the order the operator must fix them. Codes, not sentences: the window
 * localizes them.
 */
export function configGaps(config, agent) {
  const c = normalizeClientConfig(config);
  const a = normalizeAgent(agent);
  const gaps = [];
  if (a.status.state === "unseen") gaps.push("noClient");
  else if (!a.publicKey) gaps.push("noKey");
  if (!c.token.sealed) gaps.push("noToken");
  else if (a.keyId && c.token.keyId && a.keyId !== c.token.keyId) gaps.push("staleToken");
  if (!c.discord.guildId) gaps.push("noGuild");
  // Only once a server is chosen: a fresh configuration is a checklist, not a scolding.
  else if (c.discord.relay && !c.discord.chatChannelId) gaps.push("noChannel");
  return gaps;
}

/** Whether the client is running the configuration that is stored. */
export const isCurrent = (config, agent) => normalizeAgent(agent).revisionSeen === normalizeClientConfig(config).revision;

/** The channels of one guild, for a window offering a relay channel. */
export const channelsOfGuild = (agent, guildId) => normalizeAgent(agent).channels.filter((ch) => !guildId || ch.guildId === guildId);
