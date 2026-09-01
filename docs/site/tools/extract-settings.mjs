/**
 * Every `game.settings.register()` call in `scripts/`, joined with its
 * localized name and hint from `lang/en.json`.
 *
 * The published settings reference is generated from this so it states the
 * registration once — in the code that performs it — rather than a second time
 * in prose that drifts the first time a default changes.
 *
 * Four indirections have to be resolved to get a usable row, all of them real
 * in this codebase:
 *   - keys reached through a constant or a frozen `SETTINGS` map;
 *   - names built from a `LANG_PREFIX` template or a per-file `L()` helper;
 *   - a TEMPLATE helper, whose single register call fires once per call site
 *     (the equipment overlays);
 *   - an ALIAS helper (`reg(key, data)`), whose register call receives the
 *     options object as a parameter, so the options live at each call site.
 *
 * Anything that resolves to none of these is reported as unresolved rather than
 * guessed — a wrong default in a published reference is worse than a gap.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO, walk, matchBrace, cleanExpr, constantIndex, objectConstantIndex, featureOf } from "./parse.mjs";

/** Feature directories in the order the README introduces them. */
const FEATURE_ORDER = ["lib", "abilities", "equipment", "formation", "henchmen", "influence", "location", "monsters", "importer"];

const FEATURE_LABEL = {
  lib: "Library",
  abilities: "Proficiencies & class powers",
  equipment: "Equipment",
  formation: "Formations",
  henchmen: "Henchmen",
  influence: "Influence",
  location: "Locations",
  monsters: "Monsters",
  importer: "Importer",
};

/**
 * Resolve a dotted i18n key against `lang/en.json`.
 *
 * The file is a HYBRID and both halves are load-bearing: some roots are nested
 * objects (`ACKS-FORMATION.settings.x.name` is four levels of object), while
 * other entries are single flat keys containing dots
 * (`"ACKS-EQUIPMENT.container.expand"`). Foundry flattens both on load, so both
 * are valid; a resolver that assumes either shape alone misses half the strings.
 * At each node the longest matching flat segment wins before descending.
 */
export function langGet(lang, key) {
  if (typeof lang?.[key] === "string") return lang[key];
  const parts = String(key ?? "").split(".");
  let node = lang;
  let i = 0;
  while (i < parts.length && node && typeof node === "object") {
    let matched = false;
    for (let j = parts.length; j > i; j--) {
      const segment = parts.slice(i, j).join(".");
      if (segment in node) {
        node = node[segment];
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return typeof node === "string" ? node : null;
}

export function extractSettings() {
  const files = walk(path.join(REPO, "scripts"));
  const { global: consts, byFile } = constantIndex(files);
  const objects = objectConstantIndex(files);
  const lang = JSON.parse(fs.readFileSync(path.join(REPO, "lang", "en.json"), "utf8"));

  /**
   * Identifier lookup, narrowest scope first. The feature's own `constants.mjs`
   * comes before the global map because `LANG_PREFIX` is declared three times
   * with three different values — a global-only lookup would label every lib
   * setting with the abilities prefix.
   */
  const lookup = (name, file) => {
    const own = byFile.get(file)?.get(name);
    if (own !== undefined) return own;
    const featureConstants = path.join(REPO, "scripts", featureOf(file), "constants.mjs");
    const shared = byFile.get(featureConstants)?.get(name);
    if (shared !== undefined) return shared;
    return consts.get(name);
  };

  /** A string or template literal reduced to its text, or null if computed. */
  const literalize = (expr, file, subst = {}) => {
    const s = cleanExpr(expr);
    const quoted = s.match(/^(["'])((?:\\.|(?!\1).)*)\1$/);
    if (quoted) return quoted[2];
    const template = s.match(/^`([\s\S]*)`$/);
    if (template) {
      return template[1].replace(/\$\{([^}]+)\}/g, (whole, ident) => {
        const name = ident.trim();
        return subst[name] ?? lookup(name, file) ?? whole;
      });
    }
    return null;
  };

  const context = { lookup, literalize, objects, lang };
  const rows = [];

  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (!src.includes("settings.register(")) continue;

    // `const L = (k) => `ACKS-EQUIPMENT.settings.${k}`;` — the prefix every name
    // and hint in this file is built from.
    const langPrefix =
      src.match(/const\s+L\s*=\s*\(\s*\w+\s*\)\s*=>\s*`([^`$]*)\$\{\s*\w+\s*\}`/)?.[1] ?? null;

    for (const call of src.matchAll(/settings\.register\(/g)) {
      const args = splitArgs(src, call.index + call[0].length);
      if (!args) continue;
      const [moduleExpr, keyExpr, restStart] = args;
      const moduleId = literalize(moduleExpr, file) ?? lookup(cleanExpr(moduleExpr), file) ?? null;

      const rest = src.slice(restStart);
      const optionsInline = rest.trimStart().startsWith("{");

      // The enclosing local arrow helper, if this register call is inside one.
      // The match anchor is `settings.register(`, so whatever object it hangs
      // off (`game.`) still sits between the arrow and the end of `before`.
      const before = src.slice(Math.max(0, call.index - 400), call.index);
      const helper = before.match(/const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*(?:[\w$]+\.)*$/);
      const params = helper ? helper[2].split(",").map((p) => p.split("=")[0].trim()) : [];

      if (!optionsInline && helper) {
        // ALIAS: `const reg = (key, data) => register(MODULE_ID, key, data)`.
        // Every real registration is a call site supplying key AND options.
        for (const site of callSites(src, helper[1], restStart)) {
          const key = resolveKey(site.args[0], file, lookup, objects);
          if (!site.options) continue;
          rows.push(buildRow({ file, key, keyExpr: site.args[0], moduleId, options: site.options, langPrefix, subst: {}, ...context }));
        }
        continue;
      }

      const braceStart = src.indexOf("{", restStart);
      const braceEnd = matchBrace(src, braceStart);
      if (braceStart < 0 || braceEnd < 0) continue;
      const options = src.slice(braceStart, braceEnd + 1);

      const isTemplate = helper && params[0] && cleanExpr(keyExpr) === params[0];
      if (isTemplate) {
        // TEMPLATE: one register call, one row per call site of the helper.
        for (const site of callSites(src, helper[1], braceEnd)) {
          const key = resolveKey(site.args[0], file, lookup, objects);
          if (!key) continue;
          rows.push(
            buildRow({
              file,
              key,
              keyExpr: site.args[0],
              moduleId,
              options,
              langPrefix,
              subst: { [params[0]]: key },
              defaultOverride: site.args[1],
              ...context,
            }),
          );
        }
        continue;
      }

      const key = resolveKey(keyExpr, file, lookup, objects);
      rows.push(buildRow({ file, key, keyExpr, moduleId, options, langPrefix, subst: {}, ...context }));
    }
  }

  rows.sort(
    (a, b) =>
      FEATURE_ORDER.indexOf(a.feature) - FEATURE_ORDER.indexOf(b.feature) ||
      String(a.key ?? a.keyExpr).localeCompare(String(b.key ?? b.keyExpr)),
  );
  return rows;
}

/**
 * The first two arguments of a call, plus the offset the third starts at.
 * Commas inside nested parens/braces/strings do not split.
 *
 * @returns {[string, string, number]|null}
 */
function splitArgs(src, start) {
  const found = [];
  let depth = 0;
  let quote = null;
  let last = start;
  for (let i = start; i < src.length && found.length < 2; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      found.push(src.slice(last, i));
      last = i + 1;
    }
  }
  return found.length === 2 ? [found[0], found[1], last] : null;
}

/** Calls to a local helper after `from`, with args and any inline options object. */
function callSites(src, name, from) {
  const sites = [];
  const re = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, "g");
  for (const m of src.matchAll(re)) {
    if (m.index <= from) continue;
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    let quote = null;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if ("({[".includes(c)) depth++;
      else if (")}]".includes(c) && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) continue;
    const inner = src.slice(open + 1, end);
    const braceAt = inner.indexOf("{");
    const args = splitTop(braceAt >= 0 ? inner.slice(0, braceAt) : inner);
    sites.push({
      args: args.length ? args : [inner.trim()],
      options: braceAt >= 0 ? inner.slice(braceAt) : null,
    });
  }
  return sites;
}

/** Split a comma list at depth zero. */
function splitTop(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(last, i));
      last = i + 1;
    }
  }
  out.push(text.slice(last));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** `"literal"`, `CONSTANT` or `SETTINGS.MEMBER` reduced to the registered key. */
function resolveKey(expr, file, lookup, objects) {
  const s = cleanExpr(expr ?? "");
  const quoted = s.match(/^(["'])((?:\\.|(?!\1).)*)\1$/);
  if (quoted) return quoted[2];
  const member = s.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  if (member) return objects.get(member[1])?.[member[2]] ?? null;
  if (/^[A-Za-z_$][\w$]*$/.test(s)) return lookup(s, file) ?? null;
  return null;
}

function buildRow({ file, key, keyExpr, moduleId, options, langPrefix, literalize, subst, lang, objects, defaultOverride }) {
  const scalar = (name) => options.match(new RegExp(`\\b${name}:\\s*([^\\n,]+)`))?.[1];

  /** An i18n key expression to its lang key, unwrapping the `L()` helper. */
  const langKeyOf = (expr) => {
    const s = cleanExpr(expr);
    const wrapped = s.match(/^L\(\s*([\s\S]*?)\s*\)$/);
    if (wrapped) {
      const inner = literalize(wrapped[1], file, subst);
      return inner === null ? null : `${langPrefix ?? ""}${inner}`;
    }
    return literalize(s, file, subst);
  };

  const localized = (field) => {
    const raw = scalar(field);
    return raw ? langKeyOf(raw) : null;
  };

  /** `ENFORCE.RESOLVE` or `"resolve"` to the value stored in the setting. */
  const valueOf = (expr) => {
    const s = cleanExpr(expr).replace(/^\[|\]$/g, "").trim();
    const member = s.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (member) return objects.get(member[1])?.[member[2]] ?? s;
    return s.replace(/^["'`]|["'`]$/g, "");
  };

  const choices = [];
  const choicesAt = options.search(/\bchoices:\s*\{/);
  if (choicesAt >= 0) {
    const open = options.indexOf("{", choicesAt);
    const close = matchBrace(options, open);
    for (const c of options.slice(open + 1, close).matchAll(/^\s*(\[[^\]]+\]|[^\s:]+)\s*:\s*(.+?),?\s*$/gm)) {
      const labelKey = langKeyOf(c[2]);
      choices.push({
        value: valueOf(c[1]),
        label: (labelKey && langGet(lang, labelKey)) ?? labelKey ?? cleanExpr(c[2]),
      });
    }
  }

  let def = defaultOverride ? cleanExpr(defaultOverride) : cleanExpr(scalar("default") ?? "");
  if (def.startsWith("{")) def = "{}";
  else def = valueOf(def);

  const nameKey = localized("name");
  const hintKey = localized("hint");

  return {
    key: key ?? null,
    keyExpr: cleanExpr(keyExpr ?? ""),
    resolved: Boolean(key),
    moduleId,
    feature: featureOf(file),
    featureLabel: FEATURE_LABEL[featureOf(file)] ?? featureOf(file),
    source: path.relative(REPO, file).replaceAll(path.sep, "/"),
    name: nameKey ? langGet(lang, nameKey) : null,
    hint: hintKey ? langGet(lang, hintKey) : null,
    scope: scalar("scope")?.replace(/["'\s]/g, "") ?? "world",
    config: !/\bconfig:\s*false/.test(options),
    type: scalar("type")?.trim().replace(/,$/, "") ?? "",
    default: def,
    choices,
    requiresReload: /\brequiresReload:\s*true/.test(options),
    range: options.match(/\brange:\s*\{([^}]*)\}/)?.[1].replace(/\s+/g, " ").trim() ?? null,
  };
}
