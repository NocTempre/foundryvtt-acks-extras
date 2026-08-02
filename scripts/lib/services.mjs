/**
 * Named-contract service registry (FAMILY.md §3b). Providers register an
 * implementation under a CONTRACT NAME at `init`; consumers look the name up
 * from hooks onward. Contract names and shapes are defined in docs/API.md —
 * never by module ids — so no family module ever probes another's existence.
 * Pure module: no Foundry imports.
 */

const _services = new Map();

/** Provide an implementation of a named contract (last registration wins). */
export function register(name, impl) {
  if (typeof name !== "string" || !name) throw new Error("services.register: contract name required");
  _services.set(name, impl);
}

/** @returns {object|null} the registered implementation, or null */
export function get(name) {
  return _services.get(name) ?? null;
}

/** Registered contract names (diagnostics). */
export function names() {
  return [..._services.keys()].sort();
}

/** Remove all registrations (tests). */
export function resetServices() {
  _services.clear();
}
