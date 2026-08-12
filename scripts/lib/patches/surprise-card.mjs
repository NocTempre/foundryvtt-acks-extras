/* global game, Hooks, ChatMessage */
/**
 * Core patch: the Surprise Matrix's results, gathered onto ONE chat card.
 *
 * Core's `SurpriseMatrix` posts a separate `ChatMessage` per combatant — a
 * one-line sentence each, in roll order, so a six-combatant encounter buries the
 * chat log under six cards that have to be read one at a time to answer the only
 * question being asked: who is surprised. This replaces the pile with a single
 * card carrying a Monsters table and an Adventurers table, name / total /
 * result, which is the shape the answer actually has.
 *
 * THE ROLL IS STILL CORE'S. Nothing here re-derives a surprise number. The
 * matrix cell, the modifier stack, the surprise threshold and the `surprised`
 * status effect are all the system's, and are unreachable from a module
 * besides: the system ships as one minified bundle with no exports, and
 * `SURPRISE_MATRIX`, `#rollSurprise` and `#rollSurpriseForGroup` are a private
 * constant and two private methods. Duplicating the matrix here would be
 * inventing what the system provides, and would drift the first time the system
 * corrected a cell.
 *
 * So the seam is presentation only, in three moves:
 *
 *  1. `renderApplicationV2` hands over a live instance. `this.options` is
 *     shallow-frozen but `options.actions` is a per-instance deep clone, and
 *     ApplicationV2 looks the handler up at CLICK time — so the instance's
 *     `rollSurprise` can be swapped for a wrapper that still calls core's.
 *  2. While core's handler runs, a scoped `preCreateChatMessage` hook captures
 *     and BLOCKS the per-combatant messages, reading each one's total and
 *     verdict back out of its own localized template (see `resultReaders`).
 *  3. The captured rows are posted as one card.
 *
 * Privacy is preserved by splitting, not by widening: core whispers a HIDDEN
 * monster's result to the Judges, and one chat message cannot be part public.
 * Rows core would have whispered go to a second, GM-only card; the rest go to a
 * public one. With nothing hidden — the ordinary case — there is exactly one
 * card.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { makeLoc } from "../util.mjs";
import { renderRollCard } from "../roll-card.mjs";

const loc = makeLoc(LANG_PREFIX);

/** World setting: off restores core's one-message-per-combatant behaviour. */
export const SETTING_SURPRISE_CARD = "surpriseCard";

/**
 * The two messages core can post per combatant. Order matters only in that
 * `surprised` is tested first — the strings are distinct, but a translation
 * that made one a prefix of the other would otherwise resolve the wrong way.
 */
const RESULT_KEYS = [
  { key: "ACKS.surprise.surprised", surprised: true },
  { key: "ACKS.surprise.notsurprised", surprised: false },
];

/**
 * Sentinels stood into the i18n template to find where its data landed. Control
 * characters, so no translation of either string can hold one by accident.
 */
const TOTAL_MARK = String.fromCharCode(1);
const FORMULA_MARK = String.fromCharCode(2);

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Readers that pull `{result}` and `{formula}` back out of a rendered core
 * message, built from the very template that rendered it.
 *
 * Core hands the roll to `game.i18n.format(key, {result, formula})` and keeps
 * nothing else — no attached Roll, no flag. Formatting the same key with
 * sentinels in place of the data says exactly where in the sentence the two
 * values sit, so a reader tracks any translation of those strings for free and
 * needs no copy of their English.
 *
 * Returns null when a template does not carry `{result}` at all. That is the
 * pre-flight: with no way to read a total, nothing is captured and nothing is
 * blocked, and core's own messages post unchanged.
 */
function resultReaders() {
  const readers = [];
  for (const { key, surprised } of RESULT_KEYS) {
    const probe = game.i18n.format(key, { result: TOTAL_MARK, formula: FORMULA_MARK });
    if (!probe.includes(TOTAL_MARK)) return null;
    const pattern = escapeRx(probe)
      .replace(TOTAL_MARK, "(-?\\d+)")
      .replace(FORMULA_MARK, "([\\s\\S]*)");
    readers.push({ rx: new RegExp(`^${pattern}$`), surprised });
  }
  return readers;
}

/**
 * Which side of the matrix each combatant is on, and by which id a chat speaker
 * will name them.
 *
 * Both ids are indexed because `ChatMessage.getSpeaker` fills `token` for a
 * combatant with a token on the canvas and leaves it null otherwise; the token
 * id is looked up first because unlinked duplicates ("Goblin #1", "Goblin #2")
 * share one actor id and only the token id tells them apart.
 */
function groupIndex(pools) {
  const byToken = new Map();
  const byActor = new Map();
  const add = (combatants, group) => {
    for (const combatant of combatants ?? []) {
      if (combatant?.token?.id) byToken.set(combatant.token.id, group);
      if (combatant?.actor?.id && !byActor.has(combatant.actor.id)) byActor.set(combatant.actor.id, group);
    }
  };
  // Core rolls the hostile, neutral and secret pools as one "monsters" side.
  add(pools?.hostile, "monsters");
  add(pools?.neutral, "monsters");
  add(pools?.secret, "monsters");
  add(pools?.friendly, "adventurers");
  return { byToken, byActor };
}

/**
 * The whole card for one audience, or "" when that audience has no rows.
 *
 * The card itself is `renderRollCard` (lib/roll-card.mjs) — the same renderer
 * the party's checks and saving throws post through, so all three read alike
 * and gain any improvement once.
 *
 * A surprised row is marked `neutral`, NOT `failure`: whether being surprised is
 * bad news depends on which of the two tables you are reading.
 */
function cardHtml(rows, { hidden }) {
  const side = (group) =>
    rows
      .filter((r) => r.group === group)
      .map((r) => ({
        name: r.name,
        total: r.total,
        tooltip: r.formula,
        outcome: loc(r.surprised ? "surprise.surprised" : "surprise.notSurprised"),
        emphasis: r.surprised ? "neutral" : undefined,
      }));
  return renderRollCard({
    title: loc("surprise.cardTitle"),
    subtitle: hidden ? loc("surprise.hiddenNote") : undefined,
    sections: [
      { title: loc("surprise.monsters"), rows: side("monsters") },
      { title: loc("surprise.adventurers"), rows: side("adventurers") },
    ],
  });
}

/**
 * Run core's roll with its chat output diverted into `rows`.
 *
 * The capture is deliberately narrow — this user's own messages, speaking for a
 * combatant in this matrix's pools, matching one of core's two result templates.
 * Anything else posted while the roll is in flight is left alone and posts
 * normally, which is what keeps an unrelated message from vanishing into a card
 * it has nothing to do with.
 */
async function captureRolls(app, original, event, target, readers) {
  const { byToken, byActor } = groupIndex(app.options?.pools);
  const rows = [];

  const capture = (_message, data) => {
    if (data?.author !== game.user.id) return true;
    const speaker = data.speaker ?? {};
    const group = byToken.get(speaker.token) ?? byActor.get(speaker.actor);
    if (!group) return true;
    for (const reader of readers) {
      const match = reader.rx.exec(data.content ?? "");
      if (!match) continue;
      rows.push({
        group,
        name: speaker.alias ?? "",
        total: match[1],
        formula: match[2] ?? "",
        surprised: reader.surprised,
        whisper: Array.isArray(data.whisper) ? data.whisper : [],
      });
      return false; // captured — core's own message never reaches the log
    }
    return true;
  };

  Hooks.on("preCreateChatMessage", capture);
  try {
    await original.call(app, event, target);
  } finally {
    Hooks.off("preCreateChatMessage", capture);
  }
  return rows;
}

/** Post the public card, and the Judges-only card for rows core would whisper. */
async function postCards(rows) {
  const open = rows.filter((r) => !r.whisper.length);
  const secret = rows.filter((r) => r.whisper.length);

  const openHtml = cardHtml(open, { hidden: false });
  if (openHtml) await ChatMessage.create({ content: openHtml });

  const secretHtml = cardHtml(secret, { hidden: true });
  if (secretHtml) {
    // Core chose these recipients per row; the union is who it already told.
    const whisper = [...new Set(secret.flatMap((r) => r.whisper))];
    await ChatMessage.create({ content: secretHtml, whisper });
  }
}

/**
 * The Surprise Matrix, identified by what it DECLARES rather than by what it is
 * called.
 *
 * `render<ClassName>` is unusable here: the system ships terser-minified, so
 * `SurpriseMatrix` reaches a live world as `E` and the hook name is whatever
 * that build's mangler chose. `surprise-matrix-app` is a string in the app's own
 * `DEFAULT_OPTIONS.classes` and survives minification unchanged; the action is
 * required alongside it so a future app that merely borrowed the class cannot be
 * mistaken for this one.
 */
function isSurpriseMatrix(app) {
  return (
    !!app?.options?.classes?.includes("surprise-matrix-app") &&
    typeof app?.options?.actions?.rollSurprise === "function"
  );
}

/**
 * Swap one instance's `rollSurprise` for the consolidating wrapper.
 *
 * The setting is read at CLICK time rather than at install, so turning the card
 * off takes effect on the next encounter with no reload. The wrapper is marked
 * because the render hook fires again on every re-render, and a second pass
 * would wrap the wrapper.
 */
function wrapRollAction(app) {
  const actions = app?.options?.actions;
  if (actions.rollSurprise[MODULE_ID]) return;

  const original = actions.rollSurprise;
  const wrapper = async function (event, target) {
    if (!game.settings.get(MODULE_ID, SETTING_SURPRISE_CARD)) return original.call(this, event, target);
    // No readable template means no readable total: leave core's messages be
    // rather than blocking output this cannot reproduce.
    const readers = resultReaders();
    if (!readers) return original.call(this, event, target);
    const rows = await captureRolls(this, original, event, target, readers);
    if (rows.length) await postCards(rows);
  };
  wrapper[MODULE_ID] = true;
  actions.rollSurprise = wrapper;
}

/** Bind the consolidating card to every Surprise Matrix this session opens. */
export function installSurpriseCardPatch() {
  Hooks.on("renderApplicationV2", (app) => {
    if (!isSurpriseMatrix(app)) return;
    try {
      wrapRollAction(app);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not bind the consolidated surprise card`, err);
    }
  });
}
