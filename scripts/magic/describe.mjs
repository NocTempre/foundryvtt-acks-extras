/**
 * One-line readings of a spell's effect rows for the Mechanics tab. Spell
 * kinds read their own parameters; the shared kinds read the fields an
 * ability's row would. Foundry-free.
 */
import * as V from "../lib/vocab.mjs";
import { vocabLabel } from "../lib/magic-vocab.mjs";

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
 * @returns {{kind: string, text: string}} the row's kind label and its reading
 */
export function describeSpellEffect(e) {
  const kind = label(V.EFFECT_TYPES, e.type);
  const n = valueText(e.value);
  switch (e.type) {
    case "modifier": {
      // A flat number reads signed; a per-level phrase reads as written.
      const amount = n === "" ? "" : Number.isFinite(Number(n)) ? signed(Number(n)) : n;
      return {
        kind,
        text: `${subject(e)}${label(V.MODIFIER_TARGETS, e.target) || e.target || ""} ${amount}${qualifier(e, [e.forWhat])}`.trim(),
      };
    }
    case "damage":
      return { kind, text: `${subject(e)}${[e.roll || n, list(e.damage)].filter(Boolean).join(" ")}${qualifier(e)}` };
    case "heal":
      return { kind, text: `${subject(e)}${[vocabLabel("healKind", e.healKind), e.roll || n].filter(Boolean).join(": ")}${qualifier(e)}` };
    case "summon":
      return {
        kind,
        text: `${[vocabLabel("summonFormat", e.summonFormat), e.amount ? `${e.amount}×` : "", e.ref || "", n ? `${n} HD` : "", vocabLabel("controlKind", e.control)]
          .filter(Boolean)
          .join(" ")}${qualifier(e)}`,
      };
    case "control":
      return { kind, text: `${subject(e)}${vocabLabel("controlKind", e.control)}${qualifier(e)}`.trim() || "—" };
    case "conditionGrant":
    case "conditionRemove": {
      const conds = [...(e.conditions ?? [])].map((c) => label(V.CONDITION_KEYS, c)).join(", ");
      return { kind, text: `${subject(e)}${e.type === "conditionRemove" ? "cures " : ""}${conds || "—"}${qualifier(e)}` };
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
      return { kind, text: [e.spellRef?.name || e.spell, label(V.SPELL_LIKE_FREQ, e.frequency)].filter(Boolean).join(" — ") || "—" };
    case "resource":
      return { kind, text: `${e.action || ""} ${label(V.RESOURCE_KINDS, e.resource)}${e.amount ? ` ×${e.amount}` : ""}`.trim() || "—" };
    case "throw":
      return { kind, text: `${e.forWhat ? `${e.forWhat} ` : ""}throw ${n}+${qualifier(e)}` };
    case "limitation":
    case "capability":
      return { kind, text: e.restriction || e.note || e.condition || "—" };
    default: {
      // The tracked-only spell kinds (wall, illusion, teleport, …) read as
      // their subject, their value and their qualifier: what a cast records.
      const bits = [n, e.range ? `${e.range}'` : ""].filter(Boolean).join(" ");
      return { kind, text: `${subject(e)}${bits}${qualifier(e)}`.trim() || "—" };
    }
  }
}
