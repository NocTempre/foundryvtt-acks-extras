/**
 * The adventuring throw's one wrapper (scripts/lib/patches/adventuring-roll.mjs).
 *
 * Stand-in user, actor class, Roll, dialog and chat: what this pins is which
 * throws leave core's roll, the message each seat's secret throw is posted as,
 * and that the target is the one stored when the throw was asked for. The die
 * is supplied here. That Foundry delivers a blind whisper to the GMs alone,
 * and withholds its content from the roller, are the live recipe's to prove
 * (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const GM = { id: "gm1", isGM: true };
const GM2 = { id: "gm2", isGM: true };
const PLAYER = { id: "pl1", isGM: false };

/** What the stand-ins recorded since the last `reset`. */
const seen = { core: [], created: [], rendered: [], formulas: [], dialogs: [], dice: [] };
/** What the stand-ins answer: the die's total, the dialog's modifier (null closes it), a template that throws. */
const next = { total: 10, bonus: 0, templateFails: false };
function reset(user) {
  for (const list of Object.values(seen)) list.length = 0;
  Object.assign(next, { total: 10, bonus: 0, templateFails: false });
  game.user = user;
}

globalThis.game = {
  user: GM,
  users: [GM, GM2, PLAYER],
  i18n: { localize: (k) => k, format: (k, d = {}) => `${k}|${Object.values(d).join(",")}` },
  settings: { get: (ns, key) => (ns === "acks" && key === "skip-dialog-key" ? "ctrlKey" : "public") },
  dice3d: { showForRoll: async (...args) => { seen.dice.push(args); } },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Roll = class {
  constructor(formula, data = {}) { this.formula = formula; this.data = data; seen.formulas.push(formula); }
  async evaluate() { this.total = next.total; return this; }
  async render() { return `<div class="dice-roll">${this.total}</div>`; }
};
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ alias: actor.name }),
  create: async (data) => { seen.created.push(data); return data; },
};
globalThis.foundry = {
  utils: { escapeHTML: (s) => String(s).replace(/</g, "&lt;") },
  applications: {
    handlebars: {
      renderTemplate: async (template, data) => {
        if (next.templateFails) throw new Error("no such template");
        seen.rendered.push({ template, data });
        return "<section>card</section>";
      },
    },
    api: {
      DialogV2: {
        prompt: async (config) => {
          seen.dialogs.push(config);
          if (next.bonus == null) throw new Error("closed");
          return config.ok.callback(null, { form: { elements: { bonus: { value: String(next.bonus) } } } });
        },
      },
    },
  },
};

/** The system's actor class: its own roll records the call and answers a marker. */
class CoreActor {
  constructor() {
    this.name = "Tester";
    this.img = "tester.webp";
    this.system = { adventuring: { listening: 18, searching: 14, climb: 8 } };
  }
  rollAdventuring(advKey, options) {
    seen.core.push({ advKey, options, target: this.system.adventuring[advKey] });
    return "core-roll";
  }
}
globalThis.CONFIG = { Actor: { documentClass: CoreActor }, sounds: { dice: "dice.wav" }, ChatMessage: { modes: {} } };

const { installAdventuringRollPatch, rollSecretAdventuring, SECRET_ADVENTURING } = await import("../scripts/lib/patches/adventuring-roll.mjs");
installAdventuringRollPatch();

const SKIP = { event: { ctrlKey: true } };

await ok("the secret keys are listening and searching", () => {
  assert.deepEqual([...SECRET_ADVENTURING], ["listening", "searching"]);
});

await ok("a player's listening throw is posted blind to the GMs, with no roll attached", async () => {
  reset(PLAYER);
  next.total = 19;
  const actor = new CoreActor();
  const roll = await actor.rollAdventuring("listening", SKIP);
  assert.equal(seen.core.length, 0, "core's roll is not called");
  assert.equal(seen.created.length, 1);
  const msg = seen.created[0];
  assert.equal(msg.blind, true);
  assert.deepEqual(msg.whisper, ["gm1", "gm2"]);
  assert.equal("rolls" in msg, false);
  assert.equal(msg.content, "<section>card</section>");
  assert.deepEqual(msg.speaker, { alias: "Tester" });
  assert.equal(roll.total, 19);
  assert.equal(roll.data.roll.target, 18, "the Roll carries its target where core's does");
  const { template, data } = seen.rendered[0];
  assert.equal(template, "systems/acks/templates/chat/roll-result.hbs");
  assert.equal(data.data.roll.blindroll, true, "the body is marked for core's hook");
  assert.deepEqual(data.result, { isSuccess: true, isFailure: false, target: 18 });
  assert.deepEqual(seen.dice[0].slice(3), [["gm1", "gm2"], true], "the dice box is shown to the GMs, blind");
});

await ok("a GM's searching throw is whispered to that GM, not blind", async () => {
  reset(GM2);
  next.total = 5;
  const actor = new CoreActor();
  await actor.rollAdventuring("searching", SKIP);
  const msg = seen.created[0];
  assert.equal(msg.blind, false);
  assert.deepEqual(msg.whisper, ["gm2"]);
  assert.deepEqual(seen.rendered[0].data.result, { isSuccess: false, isFailure: true, target: 14 });
});

await ok("any other throw is core's, with its arguments and its answer", async () => {
  reset(PLAYER);
  const actor = new CoreActor();
  const options = { event: {} };
  assert.equal(actor.rollAdventuring("climb", options), "core-roll");
  assert.equal(seen.core.length, 1);
  assert.equal(seen.core[0].options, options);
  assert.equal(seen.created.length, 0);
  assert.equal(seen.dialogs.length, 0);
});

await ok("the dialog states the visibility and its modifier joins the formula", async () => {
  reset(PLAYER);
  next.bonus = 2;
  next.total = 20;
  const actor = new CoreActor();
  await actor.rollAdventuring("listening", { event: {} });
  assert.equal(seen.dialogs.length, 1);
  assert.equal(seen.dialogs[0].content.includes('name="messageMode"'), false, "the mode is not offered");
  assert.equal(seen.formulas[0], "1d20 + 2[ACKS-LIB.rollDialog.situational]");
  assert.equal(seen.created.length, 1);
});

await ok("a closed dialog rolls and posts nothing", async () => {
  reset(PLAYER);
  next.bonus = null;
  const actor = new CoreActor();
  assert.equal(await actor.rollAdventuring("searching", { event: {} }), undefined);
  assert.equal(seen.formulas.length, 0);
  assert.equal(seen.created.length, 0);
  assert.equal(seen.core.length, 0);
});

await ok("the target is the one stored when the throw was asked for", async () => {
  reset(PLAYER);
  const actor = new CoreActor();
  const pending = actor.rollAdventuring("listening", SKIP);
  actor.system.adventuring.listening = 99;
  await pending;
  assert.equal(seen.rendered[0].data.result.target, 18);
});

await ok("a stated target replaces the stored one", async () => {
  reset(PLAYER);
  next.total = 12;
  const actor = new CoreActor();
  await rollSecretAdventuring(actor, "searching", { ...SKIP, target: 11 });
  assert.deepEqual(seen.rendered[0].data.result, { isSuccess: true, isFailure: false, target: 11 });
  assert.equal(seen.created[0].blind, true);
});

await ok("a card that cannot render keeps the body core withholds", async () => {
  reset(PLAYER);
  next.templateFails = true;
  const logged = console.error;
  console.error = () => {};
  try {
    await new CoreActor().rollAdventuring("listening", SKIP);
  } finally {
    console.error = logged;
  }
  const msg = seen.created[0];
  assert.equal(msg.blind, true);
  assert.match(msg.content, /<div class="blindable" data-blind="true">/);
});

await ok("with no dice box the message carries core's dice sound", async () => {
  reset(PLAYER);
  const box = game.dice3d;
  game.dice3d = undefined;
  try {
    await new CoreActor().rollAdventuring("listening", SKIP);
  } finally {
    game.dice3d = box;
  }
  assert.equal(seen.created[0].sound, "dice.wav");
});

console.log(`\n${passed} passed`);
