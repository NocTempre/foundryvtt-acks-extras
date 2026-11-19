/**
 * The open blood sacrifice's shared record (model): what a Judge has set and what has been dropped, kept on the
 * caster while a sacrifice is open so every window for that caster draws the same thing. Foundry-free: the live
 * half (`sacrifice-record-live.mjs`) reads and writes the flag `flags["acks-extras"].magic.sacrifice`.
 *
 * The record is `{site, power, list}`. `site` and `power` are the Judge's two facts about the sacrifice (a
 * qualifying site, the class power) and `list` is the victims in the order they were dropped, each
 * `{uuid, willing, helpless, young, traits, value}` (`cleanState` plus the uuid), so a victim's facts travel with
 * it. A list is an array on purpose: a flag update merges objects key by key and would keep a removed victim,
 * and a uuid holds dots, which an update reads as a path. The window's model reads the record as the `state`
 * `planOf` takes (`stateOf`), so the model of the act is the one that has always read it.
 *
 * A record changes by an op applied to the freshest record, never by a whole record written from a window's copy,
 * so a Player's drop and a Judge's tick made together both land (`applyOp`). Who may make which op is decided where
 * the write is made, from the sender Foundry attested (`checkRecordRequest`): a victim's drop, removal and the clear
 * belong to the owner of the caster or a Judge, and the Judge's facts to a Judge alone.
 */
import { MODULE_ID } from "./constants.mjs";

/** A figure as a finite number, else null. */
export const num = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Number(n));

/** A victim's state as the window holds it, cleaned: the toggles, the ticked trait rows, and a Judge's value and young mark. */
export function cleanState(raw) {
  const traits = Array.isArray(raw?.traits) ? [...new Set(raw.traits.map(Number).filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b) : [];
  return { willing: raw?.willing === true, helpless: raw?.helpless === true, young: raw?.young === true, traits, value: num(raw?.value) };
}

/** The ops a record takes: a victim dropped, a victim removed, the Judge's facts, and the record cleared. */
export const OP = Object.freeze({ add: "add", remove: "remove", judge: "judge", clear: "clear" });

/** The facts of one victim a Judge sets: the toggles, the ticked trait rows and a hand-set value. */
export const VICTIM_FIELDS = Object.freeze(["willing", "helpless", "young", "traits", "value"]);

/** The sacrifice's own two Judge-set facts. */
export const SACRIFICE_FIELDS = Object.freeze(["site", "power"]);

/** Why a write to the record is refused, each a lang key under `ACKS-MAGIC.sacrifice.refused`. */
export const REFUSED = Object.freeze({ noCaster: "noCaster", owner: "owner", judgeOnly: "judgeOnly", op: "op", victim: "victim", self: "self", duplicate: "duplicate" });

/** The record as it is when nothing is open. */
export const emptyRecord = () => ({ site: false, power: false, list: [] });

/** One victim of the list, cleaned; null where it names no uuid. */
function cleanVictim(raw) {
  const uuid = typeof raw?.uuid === "string" ? raw.uuid : "";
  return uuid ? { uuid, ...cleanState(raw) } : null;
}

/** A stored record as the model reads it: the two facts as booleans, and each victim once, in order. */
export function cleanRecord(raw) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(raw?.list) ? raw.list : []) {
    const victim = cleanVictim(item);
    if (victim && !seen.has(victim.uuid)) {
      seen.add(victim.uuid);
      list.push(victim);
    }
  }
  return { site: raw?.site === true, power: raw?.power === true, list };
}

/** Whether a stored value is an open record at all: an object that holds anything. */
export const isOpen = (raw) => Boolean(raw) && typeof raw === "object" && Object.keys(raw).length > 0;

/** The record as the window's `state`: the bucket's list, the two facts and each victim's facts by uuid. */
export function stateOf(record) {
  const rec = cleanRecord(record);
  return {
    site: rec.site,
    power: rec.power,
    list: rec.list.map((v) => ({ uuid: v.uuid, qty: 1, fit: "" })),
    victims: Object.fromEntries(rec.list.map(({ uuid, ...facts }) => [uuid, facts])),
  };
}

/** One victim's fields of a Judge's op, cleaned, and only those named. */
function pickFields(raw) {
  const out = {};
  const clean = cleanState(raw);
  for (const field of VICTIM_FIELDS) if (raw && Object.hasOwn(raw, field)) out[field] = clean[field];
  return out;
}

/**
 * The record after an op, or null where the op clears it. A clear keeps the Judge's class-power mark, which belongs to
 * the caster and not to one sacrifice, so a caster so marked keeps an empty record holding it. A victim already held is not added twice, one that is
 * not held is not removed, and a Judge's facts for a victim that is not on the list change nothing. The result is a
 * new record and the argument is never changed.
 * @param {object} record a stored record
 * @param {{op: string, uuid?: string, site?: boolean, power?: boolean, victims?: object}} op
 * @returns {{site: boolean, power: boolean, list: object[]}|null}
 */
export function applyOp(record, op) {
  const rec = cleanRecord(record);
  if (op?.op === OP.clear) return rec.power ? { ...emptyRecord(), power: true } : null;
  if (op?.op === OP.add) {
    const uuid = typeof op.uuid === "string" ? op.uuid : "";
    return uuid && !rec.list.some((v) => v.uuid === uuid) ? { ...rec, list: [...rec.list, { uuid, ...cleanState({}) }] } : rec;
  }
  if (op?.op === OP.remove) return { ...rec, list: rec.list.filter((v) => v.uuid !== op.uuid) };
  if (op?.op === OP.judge) {
    const next = { ...rec, list: rec.list.map((v) => ({ ...v })) };
    for (const key of SACRIFICE_FIELDS) if (typeof op[key] === "boolean") next[key] = op[key];
    for (const victim of next.list) {
      const set = op.victims?.[victim.uuid];
      if (set) Object.assign(victim, pickFields(set));
    }
    return cleanRecord(next);
  }
  return rec;
}

/**
 * The Judge's op for what a form reads against the record, or null where nothing differs. `read` is
 * `{site?, power?, victims?: {uuid: {willing?, helpless?, young?, traits?, value?}}}` with only the controls that
 * were drawn enabled, so a field the form did not carry is never compared and never sent. Only what differs goes
 * into the op, so a Judge's tick does not carry the rest of the form over a Player's drop made meanwhile.
 */
export function diffJudge(record, read) {
  const rec = cleanRecord(record);
  const op = { op: OP.judge };
  let changed = false;
  for (const key of SACRIFICE_FIELDS) {
    if (typeof read?.[key] === "boolean" && read[key] !== rec[key]) {
      op[key] = read[key];
      changed = true;
    }
  }
  for (const [uuid, fields] of Object.entries(read?.victims ?? {})) {
    const held = rec.list.find((v) => v.uuid === uuid);
    if (!held) continue;
    const picked = pickFields(fields);
    const differs = Object.fromEntries(Object.entries(picked).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(held[k])));
    if (Object.keys(differs).length) {
      (op.victims ??= {})[uuid] = differs;
      changed = true;
    }
  }
  return changed ? op : null;
}

/**
 * Whether a request to write the record is one the GM's client may run, decided from what that client reads
 * and the sender Foundry attested, never what the payload claims: a Judge, or an owner of the caster for a drop,
 * a removal or the clear; the Judge's facts are a Judge's alone.
 * @param {{casterUuid?: string, op?: object}} req
 * @param {{caster: object|null, fromJudge: boolean, owns: boolean, resolved?: {creature: boolean, held: boolean}}} from
 *   `resolved` is, for a drop, whether the uuid resolves to a creature here and whether the list already holds that creature
 * @returns {{ok: true}|{refused: string}}
 */
export function checkRecordRequest(req, { caster, fromJudge, owns, resolved = null }) {
  if (!caster) return { refused: REFUSED.noCaster };
  if (!fromJudge && !owns) return { refused: REFUSED.owner };
  const kind = req?.op?.op;
  if (!Object.values(OP).includes(kind)) return { refused: REFUSED.op };
  if (kind === OP.judge && !fromJudge) return { refused: REFUSED.judgeOnly };
  if (kind === OP.add) {
    if (!resolved?.creature) return { refused: REFUSED.victim };
    if (req.op.uuid === req.casterUuid || resolved.self === true) return { refused: REFUSED.self };
    if (resolved.held) return { refused: REFUSED.duplicate };
  }
  return { ok: true };
}

/**
 * Whether an actor update touched the record: a set, a deletion, or the whole `magic` object replaced or deleted.
 * `changes` is the diff an `updateActor` hook receives; a deletion's shape is checked in every spelling Foundry uses.
 */
export function touchesRecord(changes, key = "sacrifice") {
  const ours = changes?.flags?.[MODULE_ID];
  if (ours && typeof ours === "object") {
    for (const spelling of ["magic", "-=magic", "==magic"]) {
      if (!(spelling in ours)) continue;
      const magic = ours[spelling];
      if (spelling !== "magic" || magic === null || typeof magic !== "object") return true;
      if (key in magic || `-=${key}` in magic || `==${key}` in magic) return true;
    }
  }
  const base = `flags.${MODULE_ID}.`;
  const flat = (k) => {
    if (typeof k !== "string" || !k.startsWith(base)) return false;
    const rest = k.slice(base.length);
    if (rest === "magic" || rest === "-=magic" || rest === "==magic") return true;
    return rest.startsWith(`magic.${key}`) || rest.startsWith(`magic.-=${key}`) || rest.startsWith(`magic.==${key}`);
  };
  return Object.keys(changes ?? {}).some(flat);
}

/**
 * Whether a caster's Sacrifice button is drawn on the casting strip: a Judge sees it on every caster (`casts`, an
 * actor the strip draws for), and a Player on one whose casting tradition is divine and whose alignment is chaotic, or
 * for whom the Judge marked the class power.
 */
export function openerVisible({ judge = false, casts = false, divine = false, alignment = "", power = false } = {}) {
  return (judge === true && casts === true) || power === true || (divine === true && alignment === "chaotic");
}
