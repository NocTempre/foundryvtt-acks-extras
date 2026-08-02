/* global game, ui, foundry */
/**
 * PostingDialog — create a recruitment posting on a location: pick the
 * specification (henchman by level / by class rarity / by proficiency /
 * mercenary / specialist), the hiring employer, and options. Validates the
 * employer level cap (RR 168) before rolling the month's pool.
 */
import { MODULE_ID } from "../constants.mjs";
import { getTable, optTable } from "../rules/tables.mjs";
import { createPosting, PRIVATE_KINDS } from "../engine/recruitment.mjs";
import { maxHenchmanLevel } from "../rules/wages.mjs";
import * as adapter from "../acks-adapter.mjs";
import { executeAsGM } from "../sockets.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class PostingDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ location, ...options } = {}) {
    super(options);
    this.location = location;
  }

  static DEFAULT_OPTIONS = {
    id: "acks-henchmen-posting-{id}",
    tag: "form",
    classes: ["acks-henchmen", "posting-dialog"],
    position: { width: 480 },
    window: { resizable: false, contentClasses: ["standard-form"] },
    form: { handler: PostingDialog.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/henchmen/posting-dialog.hbs` },
  };

  get title() {
    return game.i18n.format("ACKS-HENCHMEN.posting.createTitle", { name: this.location.name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isGM = game.user.isGM;
    // Players post on behalf of characters they OWN; GMs see every PC.
    const mayUse = (a) => game.user.isGM || a.testUserPermission(game.user, "OWNER");
    context.employers = game.actors
      .filter((a) => a.type === "character" && a.hasPlayerOwner && !a.system?.retainer?.enabled && mayUse(a))
      .map((a) => ({ id: a.id, name: a.name, level: adapter.getLevel(a) }));
    if (!context.employers.length) {
      context.employers = game.actors
        .filter((a) => a.type === "character" && !a.system?.retainer?.enabled && mayUse(a))
        .map((a) => ({ id: a.id, name: a.name, level: adapter.getLevel(a) }));
    }
    context.levels = [0, 1, 2, 3, 4].map((l) => ({ level: l }));
    context.mercTypes = (optTable("availability", "mercenaryAvailability")?.rows ?? []).map((r) => ({
      id: r.type,
      label: game.i18n.localize(`ACKS-HENCHMEN.troop.${r.type}`),
    }));
    context.specialistTypes = (optTable("availability", "specialistAvailability")?.rows ?? []).map((r) => ({
      id: r.type,
      label: game.i18n.localize(`ACKS-HENCHMEN.specialist.${r.type}`),
    }));
    const variant = this.location.system.classRarityTableId || "default";
    const variants = optTable("rarity", "classRarityTables")?.variants ?? {};
    const tiers = (variants[variant] ?? variants.default)?.tiers ?? {};
    context.classes = Object.entries(tiers).flatMap(([tier, list]) =>
      list.map((c) => ({ id: c, label: `${c} (${game.i18n.localize(`ACKS-HENCHMEN.rarity.${tier}`)})` }))
    );
    return context;
  }

  /** Show only the fields relevant to the selected posting kind. */
  _onRender(context, options) {
    super._onRender(context, options);
    const sync = () => {
      const kind = this.element.querySelector("[data-posting-kind]")?.value;
      this.element.querySelectorAll("[data-kind-field]").forEach((el) => {
        const kinds = el.dataset.kindField.split(" ");
        el.style.display = kinds.includes(kind) ? "" : "none";
      });
    };
    this.element.querySelector("[data-posting-kind]")?.addEventListener("change", sync);
    sync();
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const employer = game.actors.get(data.employerId) ?? null;
    let kind = data.kind;
    const spec = {};

    if (kind === "henchmanGeneral") {
      // the player-facing option: one post covers the whole henchman market
      kind = "henchman";
      spec.general = true;
    } else if (kind === "henchman") {
      spec.level = Number(data.level) || 0;
    }
    spec.kind = kind;
    if (kind === "henchmanByClass") {
      spec.classKey = data.classKey ?? "";
      // level blank = "by class" (any level); set = "by class and level"
      const level = data.level === "" || data.level == null ? null : Number(data.level);
      if (level != null && level >= 1) {
        spec.level = level;
        spec.levelShift = Math.max(0, level - 1);
      }
      spec.commissioned = !!data.commissioned;
    }
    if (kind === "henchmanByClassProficiency") {
      spec.classKey = data.classKey ?? "";
      spec.proficiencyName = data.proficiencyName ?? "";
      spec.proficiencyRanks = Number(data.proficiencyRanks) || 1;
      spec.commissioned = !!data.commissioned;
    }
    if (kind === "henchmanByProficiency") {
      spec.proficiencyName = data.proficiencyName ?? "";
      spec.proficiencyRanks = Number(data.proficiencyRanks) || 1;
      spec.commissioned = !!data.commissioned;
    }
    if (kind === "mercenary") spec.troopType = data.troopType;
    if (kind === "specialist") spec.specialistType = data.specialistType;

    // A player's post names what they want (the paid menu): general
    // henchmen, a mercenary/specialist type, or a directed target.
    if (!game.user.isGM) {
      if (kind === "henchman" && !spec.general) {
        ui.notifications.error(game.i18n.localize("ACKS-HENCHMEN.posting.error.criteria-required"));
        return;
      }
      if ((kind === "henchmanByClass" || kind === "henchmanByClassProficiency") && !spec.classKey) {
        ui.notifications.error(game.i18n.localize("ACKS-HENCHMEN.posting.error.criteria-required"));
        return;
      }
      if ((kind === "henchmanByProficiency" || kind === "henchmanByClassProficiency") && !spec.proficiencyName.trim()) {
        ui.notifications.error(game.i18n.localize("ACKS-HENCHMEN.posting.error.criteria-required"));
        return;
      }
    }

    // RR 168: candidates judge the employer by appearance and spending —
    // the PRESENTED level (a lie, if it differs) governs who will sign on.
    // Discovery later means a loyalty roll at −1 per level of difference.
    const presented = data.presentedLevel !== "" && data.presentedLevel != null ? Number(data.presentedLevel) : null;
    if (presented != null) spec.presentedLevel = presented;

    // Employer level cap (RR 168) for leveled henchman searches — judged
    // against the level the candidates BELIEVE the employer to be.
    if (employer && (kind === "henchman" || kind === "henchmanByClass") && (spec.level ?? 0) > 0) {
      const believedLevel = presented ?? adapter.getLevel(employer);
      const cap = maxHenchmanLevel(believedLevel, !!data.domainRuler);
      if (spec.level > cap) {
        ui.notifications.error(
          game.i18n.format("ACKS-HENCHMEN.posting.levelCapError", {
            employer: employer.name,
            level: spec.level,
            cap,
          })
        );
        return;
      }
    }

    // LOCAL-FIRST: a seat that can write the location posts directly — no GM
    // client required (locations default to OWNER; user direction
    // 2026-07-22). Seats without write fall back to the GM socket relay.
    const canLocal = game.user.isGM || this.location.testUserPermission(game.user, "OWNER");
    if (!canLocal) {
      await executeAsGM("createPosting", {
        locationUuid: this.location.uuid,
        spec,
        employerUuid: employer?.uuid ?? "",
        playersSeeDetails: data.playersSeeDetails !== false,
        requestUserId: game.user.id,
      });
      ui.notifications.info(game.i18n.localize("ACKS-HENCHMEN.posting.submitted"));
      return;
    }

    const result = await createPosting(this.location, spec, employer, {
      playersSeeDetails: data.playersSeeDetails !== false,
      requestUserId: game.user.isGM ? null : game.user.id,
    });
    if (result.error) {
      ui.notifications.error(game.i18n.localize(`ACKS-HENCHMEN.posting.error.${result.error}`));
      return;
    }
    if (result.gmPlaced) {
      ui.notifications.info(game.i18n.format("ACKS-HENCHMEN.posting.gmPlaced", { name: result.placedName ?? "?" }));
      return;
    }
    if (result.replaced != null && PRIVATE_KINDS.includes(spec.kind)) {
      // Directed search: say what the replacement actually did — a success
      // with no valid targets left silently "finding no one" reads as broken.
      ui.notifications.info(
        result.replaced > 0
          ? game.i18n.format("ACKS-HENCHMEN.posting.replaced", { n: result.replaced, total: result.posting.totalAvailable, fee: result.fee.gp })
          : game.i18n.format("ACKS-HENCHMEN.posting.replacedNone", { total: result.posting.totalAvailable, fee: result.fee.gp })
      );
      return;
    }
    ui.notifications.info(
      game.i18n.format("ACKS-HENCHMEN.posting.created", {
        total: result.posting.totalAvailable,
        fee: result.fee.gp,
      })
    );
  }
}

export function openPostingDialog(location) {
  new PostingDialog({ location }).render(true);
}
