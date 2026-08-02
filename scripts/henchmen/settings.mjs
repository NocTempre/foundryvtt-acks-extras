/* global game */
/**
 * World settings. All under the module namespace; registered at init.
 */
import { MODULE_ID } from "./constants.mjs";

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);

  reg("daysPerMonth", {
    name: "ACKS-HENCHMEN.setting.daysPerMonth",
    hint: "ACKS-HENCHMEN.setting.daysPerMonthHint",
    scope: "world",
    config: true,
    type: Number,
    default: 28, // 4 weeks — the no-calendar market cadence
  });
  reg("advanceWorldTime", {
    name: "ACKS-HENCHMEN.setting.advanceWorldTime",
    hint: "ACKS-HENCHMEN.setting.advanceWorldTimeHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  reg("autoRollCalamity", {
    name: "ACKS-HENCHMEN.setting.autoRollCalamity",
    hint: "ACKS-HENCHMEN.setting.autoRollCalamityHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  reg("enforceHenchmanLimit", {
    name: "ACKS-HENCHMEN.setting.enforceHenchmanLimit",
    hint: "ACKS-HENCHMEN.setting.enforceHenchmanLimitHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "ACKS-HENCHMEN.setting.limitOff",
      warn: "ACKS-HENCHMEN.setting.limitWarn",
      block: "ACKS-HENCHMEN.setting.limitBlock",
    },
    default: "warn",
  });
  reg("wagesToBank", {
    name: "ACKS-HENCHMEN.setting.wagesToBank",
    hint: "ACKS-HENCHMEN.setting.wagesToBankHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  reg("wageReminders", {
    name: "ACKS-HENCHMEN.setting.wageReminders",
    hint: "ACKS-HENCHMEN.setting.wageRemindersHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  reg("autoRepairReferences", {
    name: "ACKS-HENCHMEN.setting.autoRepairReferences",
    hint: "ACKS-HENCHMEN.setting.autoRepairReferencesHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
  reg("playerMarketVisibility", {
    name: "ACKS-HENCHMEN.setting.playerMarketVisibility",
    hint: "ACKS-HENCHMEN.setting.playerMarketVisibilityHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      owned: "ACKS-HENCHMEN.setting.visibilityOwned",
      all: "ACKS-HENCHMEN.setting.visibilityAll",
      none: "ACKS-HENCHMEN.setting.visibilityNone",
    },
    default: "owned",
  });
  reg("enableExpectedLiving", {
    name: "ACKS-HENCHMEN.setting.enableExpectedLiving",
    hint: "ACKS-HENCHMEN.setting.enableExpectedLivingHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  reg("enableSlavery", {
    name: "ACKS-HENCHMEN.setting.enableSlavery",
    hint: "ACKS-HENCHMEN.setting.enableSlaveryHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
  reg("schemaVersion", {
    scope: "world",
    config: false,
    type: Number,
    default: 1,
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
