/**
 * One-line readings of a spell's effect rows for the Mechanics tab. Spell
 * kinds read their own parameters; the shared kinds read the fields an
 * ability's row would. Foundry-free.
 */
import * as V from "../lib/vocab.mjs";
import { vocabLabel, printedFrequencyText, REGISTER_ORIGIN } from "../lib/magic-vocab.mjs";

const label = (enumObj, key) => enumObj?.[key]?.label ?? key ?? "";
const signed = (x) => (x == null ? "" : `${x >= 0 ? "+" : ""}${x}`);
const list = (set) => [...(set ?? [])].join(", ");

/** A level value as a short phrase: a flat number, or "N (+M/level)". */
function valueText(v, labelOf) {
  if (!v) return "";
  if (v.kind === "perLevel" && v.base != null) {
    if (v.base === v.per) return `${v.base}/level`;
    return `${v.base} (${signed(v.per)}/level)`;
  }
  if (v.kind === "breakpoints" && v.breakpoints?.length) {
    return v.breakpoints.map((b) => `${b.value} @${b.atLevel}`).join(", ");
  }
  if (v.flat == null) return "";
  return labelOf ? labelOf(v.flat) : String(v.flat);
}

/** The subject that leads a line when it is not the caster's own. */
const subject = (e) => (e.appliesTo && e.appliesTo !== "self" ? `${label(V.EFFECT_SUBJECTS, e.appliesTo)}: ` : "");

const qualifier = (e, extra = []) => {
  const parts = [...extra, e.condition, e.note].filter(Boolean);
  return parts.length ? ` (${parts.join("; ")})` : "";
};

/**
 * What a spell row says about when it lasts, where it repeats and who is
 * exempt, as short phrases from the vocabulary's own labels: a lasting that is
 * not the plain once or the whole duration, a repeat with its moment, throw and
 * target, a size exemption, a row no saving throw governs, what ends its record
 * and the conditions it writes with no clock. The figure of a `rounds` lasting is
 * the row's formula as it was read, shown beside the lasting.
 */
function castParts(e) {
  const out = [];
  if (e.lasts === "nextTurn" || e.lasts === "followingTurn") out.push(vocabLabel("effectLasts", e.lasts));
  else if (e.lasts === "rounds") out.push([vocabLabel("effectLasts", e.lasts), e.rounds].filter(Boolean).join(" "));
  if (e.recur && e.recur !== "none") {
    out.push(
      [vocabLabel("effectRecur", e.recur), e.recurAt && vocabLabel("effectRecurMoment", e.recurAt), e.recurSave && vocabLabel("effectRecurSave", e.recurSave), e.recurTarget && vocabLabel("effectRecurTarget", e.recurTarget)]
        .filter(Boolean)
        .join(", "),
    );
  }
  if (e.saveEffect === "none") out.push(vocabLabel("saveEffect", e.saveEffect));
  if (e.endsOn?.length) out.push(`ends on: ${list(e.endsOn)}`);
  if (e.untimed?.length) out.push(`no clock: ${[...e.untimed].map((c) => label(V.CONDITION_KEYS, c)).join(", ")}`);
  if (e.exemptSizeFrom) out.push(`exempt from size: ${label(globalThis.acksExtras?.monsters?.config?.SIZES, e.exemptSizeFrom)}`);
  if (e.exemptSizeOver) out.push(`exempt above size: ${label(globalThis.acksExtras?.monsters?.config?.SIZES, e.exemptSizeOver)}`);
  return out;
}

/**
 * A row's reading. A summon row names its creature through `nameOf`, a
 * synchronous lookup the caller passes (the spell sheet resolves the ref in
 * the world); a ref it cannot name reads as written.
 * @param {object} e  the effect row
 * @param {{nameOf?: (ref: string) => string|null}} [o]
 * @returns {{kind: string, text: string, option: string}} the row's kind label, its
 *   reading, and the name of its option within its choice group (blank for none)
 */
export function describeSpellEffect(e, o = {}) {
  const { kind, text, lead } = readEffect(e, o);
  // A line read alone (a card, a dialog row) names a tracked kind; a list with its own kind column does not.
  return { kind, text: lead ? (text === "—" ? kind : `${kind}: ${text}`) : text, option: e.pickOption || "" };
}

/**
 * One effect row as the Mechanics tab lists it: its reading and option, whether
 * the import wrote it (`register`) or a hand did, and the fields a capture left
 * blank, named by the editor's labels. The page reference rides beside the list;
 * no wording says the figure is missing beyond that the field is blank.
 * @param {object} row  the effect row
 * @param {number} index  its place in the spell's rows
 * @param {object} [o]
 * @param {(ref: string) => string|null} [o.nameOf]  a summon row's creature lookup
 * @param {string} [o.cite]  the spell's page reference
 * @param {(name: string) => string} [o.fieldLabel]  a field's editor label
 * @param {(key: string, data?: object) => string} [o.say]  the sheet's lang reader, `ACKS-MAGIC.<key>`
 */
export function effectRowView(row, index, { nameOf, cite = "", fieldLabel = (name) => name, say = (key) => key } = {}) {
  const blank = [...(row.unread ?? [])].map(fieldLabel);
  return {
    index,
    ...rowReading(row, nameOf),
    origin: row.origin === REGISTER_ORIGIN ? "register" : "hand",
    unread: blank.length ? say("mech.unread", { fields: blank.join(", ") }) : "",
    cite,
  };
}

/** The kind and text a list with its own kind column shows: the text never repeats the kind. */
function rowReading(row, nameOf) {
  const { kind, text } = readEffect(row, { nameOf });
  return { kind, text, option: row.pickOption || "" };
}

function readEffect(e, { nameOf } = {}) {
  const kind = label(V.EFFECT_TYPES, e.type);
  const n = valueText(e.value);
  switch (e.type) {
    case "modifier": {
      // A flat number reads signed; a per-level phrase reads as written.
      const amount = n === "" ? "" : Number.isFinite(Number(n)) ? signed(Number(n)) : n;
      const extra = [e.forWhat, e.mode === "set" ? "set" : "", e.attackKinds?.length ? list(e.attackKinds) : "", e.ownSave ? "on the spell's own save" : "", e.pickKind ? "kind picked at the cast" : ""];
      return {
        kind,
        text: `${subject(e)}${label(V.MODIFIER_TARGETS, e.target) || e.target || ""} ${amount}${qualifier(e, extra)}`.trim(),
      };
    }
    case "damage":
      return { kind, text: `${subject(e)}${[e.roll || n, list(e.damage)].filter(Boolean).join(" ")}${qualifier(e, castParts(e))}` };
    case "heal":
      return { kind, text: `${subject(e)}${[vocabLabel("healKind", e.healKind), e.roll || n].filter(Boolean).join(": ")}${qualifier(e, castParts(e))}` };
    case "ignite":
      return { kind, text: `${subject(e)}${qualifier(e, castParts(e)).trim()}`.trim() || "—" };
    case "summon": {
      let creature = e.ref || "";
      if (creature && typeof nameOf === "function") {
        try {
          creature = nameOf(e.ref) || creature;
        } catch {
          // a lookup that fails leaves the ref as written
        }
      }
      // `max` is the count's ceiling at the caster level (a level value, read as `value` is).
      const ceiling = valueText(e.max);
      return {
        kind,
        text: `${[vocabLabel("summonFormat", e.summonFormat), e.amount ? `${e.amount}×` : "", ceiling ? `up to ${ceiling}` : "", creature, n ? `${n} HD` : "", vocabLabel("controlKind", e.control)]
          .filter(Boolean)
          .join(" ")}${qualifier(e)}`,
      };
    }
    case "control":
      return { kind, text: `${subject(e)}${vocabLabel("controlKind", e.control)}${qualifier(e)}`.trim() || "—" };
    case "conditionGrant":
    case "conditionRemove": {
      const conds = [...(e.conditions ?? [])].map((c) => label(V.CONDITION_KEYS, c)).join(", ");
      return { kind, text: `${subject(e)}${e.type === "conditionRemove" ? "cures " : ""}${conds || "—"}${qualifier(e, castParts(e))}` };
    }
    case "immunity":
    case "resistance":
    case "susceptibility":
      return {
        kind,
        text: `${subject(e)}${[list(e.damage), list(e.effects), list(e.conditions)].filter(Boolean).join("; ") || "—"}${qualifier(e)}`,
      };
    case "sense":
      return { kind, text: `${subject(e)}${label(V.SENSE_TYPES, e.sense) || label(V.VISION_TYPES, e.vision)}${e.range ? ` ${e.range}'` : ""}${qualifier(e)}` };
    case "movement":
      return { kind, text: `${subject(e)}${label(V.MOVEMENT_TYPES, e.movementMode)}${n ? ` ${n}'` : ""}${qualifier(e)}` };
    case "spellLike":
      return { kind, text: [e.spellRef?.name || e.spell, printedFrequencyText(e.frequency, e.frequencyText) || label(V.SPELL_LIKE_FREQ, e.frequency)].filter(Boolean).join(" — ") || "—" };
    case "resource":
      return { kind, text: `${e.action || ""} ${label(V.RESOURCE_KINDS, e.resource)}${e.amount ? ` ×${e.amount}` : ""}`.trim() || "—" };
    case "throw":
      return { kind, text: `${e.forWhat ? `${e.forWhat} ` : ""}throw ${n}+${qualifier(e)}` };
    case "limitation":
    case "capability":
      return { kind, text: e.restriction || e.note || e.condition || "—" };
    default: {
      // The tracked-only spell kinds (wall, illusion, teleport, …) read as
      // their kind, their subject, their value, the effects a row holds back
      // and their qualifier: what a cast records.
      const held = [...(e.effects ?? [])].map((k) => label(V.EFFECT_KEYS, k)).join(", ");
      // A light row also reads the radius it sheds at each level it has one for.
      const radii = e.type === "light" ? ["daylight", "bright", "dim"].filter((band) => Number.isFinite(e.lightBands?.[band])).map((band) => `${band} ${e.lightBands[band]}'`).join(", ") : "";
      const bits = [n, e.range ? `${e.range}'` : "", radii, held].filter(Boolean).join(" ");
      const rest = `${subject(e)}${bits}${qualifier(e)}`.replace(/ {2,}/g, " ").trim();
      return { kind, text: rest || "—", lead: true };
    }
  }
}
