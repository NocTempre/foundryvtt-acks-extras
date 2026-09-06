/**
 * The command registry, Foundry-free: one name → one handler, and ONE guard
 * before any handler runs.
 *
 * The seat a bridge client drives has Assistant GM power, so the guard is
 * what keeps a client's user inside their own rights: every command runs as
 * the Foundry user the client identity is BOUND to, and a handler asks that
 * user's permission on the document it touches (`requireOwner`, below), never
 * the seat's. A Judge command additionally requires the bound user to be a
 * GM. The two facts Foundry owns — who an identity is bound to, whether a
 * user is a GM — are injected, which is what lets the Node tests run the
 * whole guard without a world.
 *
 * `asSeat` is the one bypass: the seat holder sets it when its OWN operator
 * configuration names the caller as a Judge, and the command then runs as
 * the seat's user. The seat holder runs on the operator's machine with full
 * access to the page anyway; this only makes the bootstrap (binding the
 * first Judge) expressible through the same path as everything else.
 *
 * Handlers never throw across the boundary: a result is always
 * `{ok: true, data}` or `{ok: false, code, message}`, JSON both ways.
 */
import { ERR } from "./constants.mjs";

/** An error carrying a bridge code; the registry answers it as `{ok:false, code}`. */
export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.bridgeCode = code;
  }
}

/** A failed answer. */
export const fail = (code, message) => ({ ok: false, code, message: String(message ?? "") });

/** Refuse unless `user` owns `doc` — the guard every writing handler calls. */
export function requireOwner(ctx, doc, what = "this document") {
  const ok = !!doc && typeof doc.testUserPermission === "function" && !!ctx?.user && doc.testUserPermission(ctx.user, "OWNER");
  if (!ok) throw new BridgeError(ERR.forbidden, `${ctx?.user?.name ?? "this user"} does not own ${what}`);
  return doc;
}

/**
 * Build a registry.
 * @param {object} deps
 * @param {(client: object|null, args: object) => (object|null|Promise<object|null>)} deps.resolveUser
 *   the Foundry user a client identity is bound to (or the seat's own user
 *   when `args.asSeat`); null when unbound.
 * @param {(user: object) => boolean} [deps.isJudge]  default `user.isGM`.
 */
export function createRegistry({ resolveUser, isJudge = (u) => !!u?.isGM } = {}) {
  if (typeof resolveUser !== "function") throw new TypeError("bridge registry: resolveUser is required");
  const commands = new Map();

  /**
   * Register one command. Names share one registry — a duplicate is a
   * programming error and throws rather than silently rebinding.
   * @param {string} name
   * @param {object} spec
   * @param {(ctx: {user, client, judge}, args: object) => *} spec.run
   * @param {boolean} [spec.judge]         the bound user must be a GM
   * @param {boolean} [spec.allowUnbound]  runs with `ctx.user === null`
   * @param {string}  [spec.describe]      one line for `list()`
   */
  function register(name, { run, judge = false, allowUnbound = false, describe = "" } = {}) {
    const key = String(name ?? "").trim();
    if (!key) throw new TypeError("bridge registry: a command needs a name");
    if (typeof run !== "function") throw new TypeError(`bridge registry: "${key}" needs a run function`);
    if (commands.has(key)) throw new Error(`bridge registry: command "${key}" registered twice`);
    commands.set(key, { run, judge: !!judge, allowUnbound: !!allowUnbound, describe: String(describe ?? "") });
  }

  /** Every command, sorted by name, without its handler. */
  function list() {
    return [...commands.entries()]
      .map(([name, c]) => ({ name, judge: c.judge, allowUnbound: c.allowUnbound, describe: c.describe }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const has = (name) => commands.has(String(name ?? ""));

  /** Run one command by name. Never throws. */
  async function run(name, args = {}) {
    const cmd = commands.get(String(name ?? ""));
    if (!cmd) return fail(ERR.unknownCommand, `no bridge command "${name}"`);
    const safeArgs = args && typeof args === "object" ? args : {};
    const client = safeArgs.client && typeof safeArgs.client === "object" ? safeArgs.client : null;

    let user = null;
    try {
      user = (await resolveUser(client, safeArgs)) ?? null;
    } catch (err) {
      return fail(ERR.invalid, err?.message ?? String(err));
    }
    if (!user && !cmd.allowUnbound) return fail(ERR.unbound, "this identity is bound to no Foundry user");
    const judge = !!(user && isJudge(user));
    if (cmd.judge && !judge) return fail(ERR.forbidden, `"${name}" is a Judge's command`);

    try {
      const data = await cmd.run({ user, client, judge }, safeArgs);
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      if (err?.bridgeCode) return fail(err.bridgeCode, err.message);
      return fail(ERR.failed, err?.message ?? String(err));
    }
  }

  return { register, list, has, run };
}
