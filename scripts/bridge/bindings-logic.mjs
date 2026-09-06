/**
 * The binding store's arithmetic, Foundry-free.
 *
 * Three maps: which external identity (a Discord user) is which Foundry user,
 * which external channel is which formation (the party), and which character
 * each Foundry user is currently speaking as. Every function returns a NEW
 * store; the Foundry side persists what it is handed and never mutates in
 * place, so a failed write leaves the setting exactly as it was.
 *
 * A binding is Judge-made, never self-claimed: nothing here decides who may
 * call these — the registry's guard does — but the shape makes the claim
 * impossible to forge, because the store is world-scoped and only a GM client
 * can write it.
 */

/** An empty store. */
export const emptyStore = () => ({ users: {}, parties: {}, active: {} });

/** The key one external identity is filed under: `<kind>:<id>`. */
export const externalKey = (kind, id) => `${kind}:${id}`;

const nonEmpty = (v, what) => {
  const s = String(v ?? "").trim();
  if (!s) throw new TypeError(`bridge bindings: ${what} is required`);
  return s;
};

/** Read whatever the setting holds into the three-map shape, tolerating garbage. */
export function normalizeStore(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const map = (m) => (m && typeof m === "object" ? { ...m } : {});
  return { users: map(s.users), parties: map(s.parties), active: map(s.active) };
}

/** Bind an external identity to a Foundry user (replacing any earlier binding of that identity). */
export function bindUser(store, kind, externalId, foundryUserId) {
  const key = externalKey(nonEmpty(kind, "client kind"), nonEmpty(externalId, "external id"));
  const users = { ...store.users, [key]: nonEmpty(foundryUserId, "Foundry user id") };
  return { ...store, users };
}

/** Drop an external identity's binding, and the active character it implied. */
export function unbindUser(store, kind, externalId) {
  const key = externalKey(nonEmpty(kind, "client kind"), nonEmpty(externalId, "external id"));
  const users = { ...store.users };
  const gone = users[key] ?? null;
  delete users[key];
  const active = { ...store.active };
  // The active character belongs to the Foundry user; it goes only when no
  // other identity still reaches that user.
  if (gone && !Object.values(users).includes(gone)) delete active[gone];
  return { ...store, users, active };
}

/** The Foundry user id an external identity is bound to, or null. */
export const boundUserId = (store, kind, externalId) => store.users[externalKey(kind, externalId)] ?? null;

/** Every external identity bound to a Foundry user. */
export function externalIdsOf(store, foundryUserId) {
  return Object.entries(store.users)
    .filter(([, uid]) => uid === foundryUserId)
    .map(([key]) => {
      const i = key.indexOf(":");
      return { kind: key.slice(0, i), id: key.slice(i + 1) };
    });
}

/** Set the character a Foundry user speaks as, by uuid. */
export function setActive(store, foundryUserId, uuid) {
  return { ...store, active: { ...store.active, [nonEmpty(foundryUserId, "Foundry user id")]: nonEmpty(uuid, "actor uuid") } };
}

/** Forget a Foundry user's active character. */
export function clearActive(store, foundryUserId) {
  const active = { ...store.active };
  delete active[foundryUserId];
  return { ...store, active };
}

/** The uuid a Foundry user is speaking as, or null. */
export const activeOf = (store, foundryUserId) => store.active[foundryUserId] ?? null;

/** Bind an external channel to a formation. */
export function bindParty(store, kind, channelId, formationId) {
  const key = externalKey(nonEmpty(kind, "client kind"), nonEmpty(channelId, "channel id"));
  return { ...store, parties: { ...store.parties, [key]: nonEmpty(formationId, "formation id") } };
}

/** Drop a channel's party binding. */
export function unbindParty(store, kind, channelId) {
  const parties = { ...store.parties };
  delete parties[externalKey(nonEmpty(kind, "client kind"), nonEmpty(channelId, "channel id"))];
  return { ...store, parties };
}

/** The formation id a channel is bound to, or null. */
export const partyOf = (store, kind, channelId) => store.parties[externalKey(kind, channelId)] ?? null;

/** Every channel bound to a formation. */
export function channelsOf(store, formationId) {
  return Object.entries(store.parties)
    .filter(([, fid]) => fid === formationId)
    .map(([key]) => {
      const i = key.indexOf(":");
      return { kind: key.slice(0, i), id: key.slice(i + 1) };
    });
}
