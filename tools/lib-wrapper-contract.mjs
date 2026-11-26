/**
 * A stand-in for libWrapper that keeps the one rule of its contract a patch can
 * break: a wrapper registered as `WRAPPER` that settles without having called
 * `wrapped` is unregistered, and the package is shown an error. `MIXED` and
 * `OVERRIDE` wrappers may skip `wrapped` and stay registered.
 *
 * The rule is read from libWrapper's own source (`_cleanup_call_wrapper`): the
 * check runs when the wrapper's return value settles (a promise is awaited
 * first); a `WRAPPER` that never chained is unregistered and an error naming
 * its package is raised. With one wrapper on a method, unregistering puts the
 * original method back on its owner. This stand-in holds one wrapper per target,
 * which is what a module's registration of a method is (the validate gate allows
 * one per target).
 *
 * Install with `globalThis.libWrapper = contractLibWrapper()`; read
 * `registrations` for what was registered, `errors` for each unregistration, and
 * `live(target)` for whether a target's wrapper is still on its owner.
 */

/**
 * @returns {{register: Function, registrations: Array, errors: string[], live: (target: string) => boolean}}
 */
export function contractLibWrapper() {
  const registrations = [];
  const errors = [];
  const wrappers = new Map();

  const ownerOf = (target) => {
    const path = target.split(".");
    const name = path.pop();
    return { owner: path.reduce((at, key) => at[key], globalThis), name };
  };

  return {
    registrations,
    errors,
    /** Whether the target's wrapper is still the method on its owner. */
    live(target) {
      const { owner, name } = ownerOf(target);
      return wrappers.get(target) === owner[name];
    },
    register(id, target, fn, type = "MIXED") {
      registrations.push({ id, target, type });
      const { owner, name } = ownerOf(target);
      const original = owner[name];
      const wrapper = function (...args) {
        let called = false;
        const wrapped = (...a) => {
          called = true;
          return original.apply(this, a);
        };
        const settle = (value) => {
          if (!called && type === "WRAPPER") {
            errors.push(`The wrapper for '${target}' registered by ${id} with type WRAPPER did not chain the call to the next wrapper. This wrapper will be unregistered.`);
            if (owner[name] === wrapper) owner[name] = original;
            wrappers.delete(target);
          }
          return value;
        };
        const out = fn.call(this, wrapped, ...args);
        return out && typeof out.then === "function" ? out.then(settle) : settle(out);
      };
      wrappers.set(target, wrapper);
      owner[name] = wrapper;
    },
  };
}
