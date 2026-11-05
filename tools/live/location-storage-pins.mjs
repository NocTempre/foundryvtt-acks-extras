/**
 * Live walk, location-storage-pins: the storage manager lists a location only
 * while it holds goods, is pinned, or is open. Walks docs/location/TESTING.md
 * step 23 on the GM seat: the Places list and the Move to targets leave an
 * empty location out and keep a provider that is no location, **Pin a place**
 * adds one through its picker, the row's pin unpins it, and the world's own
 * places are counted listed against held. Machine values arrive through
 * ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `location/pin-empty`, a location holding
 * nothing; `location/pin-stocked`, a location holding one row kept for the
 * house; `location/pin-cart`, a creature made a provider, holding nothing.
 * Each is brought to shape at the step's start: the empty one unpinned and
 * bare, the stocked one holding its row, the cart a provider unpinned. The
 * empty one is built pinned and left pinned, since the world-start prune takes
 * an empty location that is not; the prune is only ever run dry here. Nothing
 * is swept. Every figure printed is a count or a boolean; no place in the world
 * is named.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
/** The stocked place's row, kept for the house. */
const ROPE = { name: "Pin Walk Rope", type: "item", flags: { "acks-extras": { storage: { ownerUuid: "", ownerName: "" } } } };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const plate = (name) => path.join(process.env.SHOTS === "1" ? shotDir() : logDir(), name).replaceAll("\\", "/");

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    module: game.modules.get("acks-extras")?.version ?? null,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    manager: typeof acksExtras.location?.openStorageManager,
    pins: typeof acksExtras.lib?.storage?.setPinned,
  }),

  /** Bring the three fixtures to the step's shape. */
  shape: async ({ emptyId, stockedId, cartId, rope }) => {
    const S = acksExtras.lib.storage;
    const empty = game.actors.get(emptyId);
    const stocked = game.actors.get(stockedId);
    const cart = game.actors.get(cartId);
    const stray = S.storedItems(empty).map((i) => i.id);
    if (stray.length) await empty.deleteEmbeddedDocuments("Item", stray);
    await S.setPinned(empty, false);
    if (!S.storedItems(stocked).length) await stocked.createEmbeddedDocuments("Item", [rope]);
    await S.setPinned(stocked, false);
    await S.setProvider(cart, true);
    await S.setPinned(cart, false);
    return {
      empty: { provider: S.isProvider(empty), pinned: S.isPinned(empty), held: S.storedItems(empty).length },
      stocked: { provider: S.isProvider(stocked), held: S.storedItems(stocked).length },
      cart: { provider: S.isProvider(cart), pinned: S.isPinned(cart), held: S.storedItems(cart).length, location: cart.type === "acks-extras.location" },
    };
  },

  /** Open the manager on a place and read what its list and its targets name. */
  open: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const app of foundry.applications.instances.values()) if (app.id === "acks-location-storage-manager") await app.close();
    const app = acksExtras.location.openStorageManager(game.actors.get(placeId));
    for (let i = 0; i < 50 && !app.rendered; i++) await sleep(100);
    return { rendered: !!app.rendered };
  },

  /** What the open manager lists, and the world's providers against it. */
  read: async ({ ids }) => {
    const S = acksExtras.lib.storage;
    const root = document.getElementById("acks-location-storage-manager");
    const listed = [...(root?.querySelectorAll(".acks-location-manager-place[data-place-uuid]") ?? [])].map((li) => li.dataset.placeUuid);
    const targets = [...(root?.querySelectorAll("select[data-pick=target] option") ?? [])].map((o) => o.value);
    const active = root?.querySelector(".acks-location-manager-place.active")?.dataset.placeUuid ?? null;
    const pinOf = (uuid) => {
      const btn = root?.querySelector(`.acks-location-manager-place[data-place-uuid="${uuid}"] [data-action="togglePin"]`);
      return btn ? { pressed: btn.getAttribute("aria-pressed"), cls: btn.classList.contains("is-pinned"), label: !!btn.getAttribute("aria-label") } : null;
    };
    const uuid = (id) => game.actors.get(id)?.uuid;
    const out = {};
    for (const [key, id] of Object.entries(ids)) {
      out[key] = { listed: listed.includes(uuid(id)), target: targets.includes(uuid(id)), active: active === uuid(id), pin: pinOf(uuid(id)), flag: S.isPinned(game.actors.get(id)), provider: S.isProvider(game.actors.get(id)) };
    }
    const providers = S.providers();
    const emptyLocations = providers.filter((p) => p.type === "acks-extras.location" && !S.storedItems(p).length && !S.isPinned(p));
    out.world = {
      providers: providers.length,
      listed: listed.length,
      emptyLocations: emptyLocations.length,
      emptyLocationsListed: emptyLocations.filter((p) => listed.includes(p.uuid) && p.uuid !== active).length,
      pinButtons: root?.querySelectorAll('.acks-location-manager-place [data-action="togglePin"]').length ?? 0,
      pinPlaceButton: !!root?.querySelector('[data-action="pinPlace"]'),
    };
    return out;
  },

  /** Press Pin a place, pick a place in its picker, and press its OK. */
  pinThroughPicker: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const uuid = game.actors.get(placeId).uuid;
    const root = document.getElementById("acks-location-storage-manager");
    root.querySelector('[data-action="pinPlace"]').click();
    let dialog = null;
    for (let i = 0; i < 50 && !dialog; i++) {
      await sleep(100);
      dialog = [...foundry.applications.instances.values()].find((a) => a.element?.querySelector?.('select[name="actor"]') && a.id !== "acks-location-storage-manager");
    }
    if (!dialog) return { dialog: false };
    const select = dialog.element.querySelector('select[name="actor"]');
    const options = [...select.options].map((o) => o.value);
    const offered = options.includes(uuid);
    select.value = uuid;
    dialog.element.querySelector('button[data-action="ok"]').click();
    for (let i = 0; i < 50 && !acksExtras.lib.storage.isPinned(game.actors.get(placeId)); i++) await sleep(100);
    await sleep(300);
    return { dialog: true, offered, sorted: options.every((v, i) => i === 0 || game.actors.get(v.split(".")[1]).name.localeCompare(game.actors.get(options[i - 1].split(".")[1]).name) >= 0) };
  },

  /** Whether the world-start prune, run dry, would take each place. Deletes nothing. */
  prunes: async ({ ids }) => {
    const LM = await import("/modules/acks-extras/scripts/location/module.mjs");
    const { doomed } = await LM.pruneEmptyLocations({ dryRun: true });
    return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, doomed.includes(game.actors.get(id)?.uuid)]));
  },

  /** Pin a place through the library, as the walk's last write, so the prune keeps the fixture. */
  pin: async ({ placeId }) => acksExtras.lib.storage.setPinned(game.actors.get(placeId), true),

  /** Click a place's row in the list, or its pin. */
  click: async ({ placeId, pin = false }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const uuid = game.actors.get(placeId).uuid;
    const root = document.getElementById("acks-location-storage-manager");
    const row = root.querySelector(`.acks-location-manager-place[data-place-uuid="${uuid}"]`);
    if (!row) return { clicked: false };
    (pin ? row.querySelector('[data-action="togglePin"]') : row).click();
    await sleep(800);
    return { clicked: true };
  },
};

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.location?.openStorageManager`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm));
  const census = await run(gm, P.census);
  note("census", census);
  check("the GM seat is the active GM and the page serves the manager and the pin", census.activeGMIsSelf && census.role === 4 && census.manager === "function" && census.pins === "function", census);
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");

  section("fixtures");
  // Both locations are built able to outlive the world-start prune, which runs
  // on this seat's own ready and would otherwise take one built beside it: the
  // empty one pinned, the stocked one holding its row from the start.
  const empty = await gm.fixture("location/pin-empty", "Actor", {
    name: "Pin Walk Empty Place",
    type: LOCATION,
    flags: { "acks-extras": { storage: { provider: true, pinned: true } } },
  });
  const stocked = await gm.fixture("location/pin-stocked", "Actor", {
    name: "Pin Walk Stocked Place",
    type: LOCATION,
    items: [ROPE],
  });
  const cart = await gm.fixture("location/pin-cart", "Actor", { name: "Pin Walk Cart", type: "monster" });
  const ids = { empty: empty.id, stocked: stocked.id, cart: cart.id };
  const shaped = await run(gm, P.shape, { emptyId: empty.id, stockedId: stocked.id, cartId: cart.id, rope: ROPE });
  note("shape", shaped);
  check("the empty location is a provider, unpinned and bare; the stocked one holds a row; the cart is a provider that is no location",
    shaped.empty.provider && !shaped.empty.pinned && shaped.empty.held === 0 && shaped.stocked.held > 0 && shaped.cart.provider && !shaped.cart.location && shaped.cart.held === 0, shaped);

  section("23. the list leaves an empty location out");
  await run(gm, P.open, { placeId: stocked.id });
  let r = await run(gm, P.read, { ids });
  note("read", r);
  check("the stocked location is listed and open", r.stocked.listed && r.stocked.active);
  check("the empty location is neither listed nor a Move to target", !r.empty.listed && !r.empty.target);
  const before = await run(gm, P.prunes, { ids });
  check("unpinned, the empty location is one the world-start prune would take", before.empty && !before.stocked, before);
  check("the cart, a provider that is no location, is listed and a target though it holds nothing", r.cart.listed && r.cart.target);
  check("no other empty, unpinned location in the world is listed", r.world.emptyLocationsListed === 0, r.world);
  check("each row carries a pin and the column a Pin a place button", r.world.pinButtons === r.world.listed && r.world.pinPlaceButton, r.world);
  check("the stocked row's pin reads unpinned, and names itself", r.stocked.pin?.pressed === "false" && !r.stocked.pin?.cls && r.stocked.pin?.label, r.stocked.pin);

  section("23. Pin a place adds it");
  const picked = await run(gm, P.pinThroughPicker, { placeId: empty.id });
  note("picker", picked);
  check("the picker offers the empty location, by name in order", picked.dialog && picked.offered && picked.sorted, picked);
  r = await run(gm, P.read, { ids });
  check("pinned, it is listed, open, its pin pressed, and a target from elsewhere", r.empty.flag && r.empty.listed && r.empty.active && r.empty.pin?.pressed === "true" && r.empty.pin?.cls, r.empty);
  await run(gm, P.click, { placeId: stocked.id });
  r = await run(gm, P.read, { ids });
  check("with another place open, the pinned empty location stays listed and is a Move to target", r.stocked.active && r.empty.listed && r.empty.target, { stocked: r.stocked, empty: r.empty });
  const after = await run(gm, P.prunes, { ids });
  check("pinned, the world-start prune spares it", !after.empty, after);

  if (process.env.SHOTS === "1") {
    await gm.compose();
    await run(gm, P.open, { placeId: stocked.id });
    await sleep(500);
    note("plate", await gm.shot(plate("location-storage-manager.png"), "#acks-location-storage-manager"));
  }

  section("23. the row's pin unpins it");
  const clicked = await run(gm, P.click, { placeId: empty.id, pin: true });
  r = await run(gm, P.read, { ids });
  note("read", { clicked, empty: r.empty, stocked: r.stocked.active });
  check("unpinned while another place is open, the empty location leaves the list and the targets", clicked.clicked && !r.empty.flag && !r.empty.listed && !r.empty.target && r.stocked.active, r.empty);
  check("it is still a place that holds goods", r.empty.provider);
  // Pinned again so the next ready's prune keeps the fixture for the next walk.
  check("the empty location is pinned again for the next walk", await run(gm, P.pin, { placeId: empty.id }));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { await gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
