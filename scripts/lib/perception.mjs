/* global foundry, game, CONFIG, Token */

/**
 * The ACKS senses as Foundry perception modes: `senses.mjs` decides WHAT a
 * creature perceives, this file registers what each sense IS to Foundry
 * (vision modes, detection modes, and the two status effects core lacks). See
 * docs/lib/MODEL.md, "Perception: senses, light, and the token".
 */

import { MODULE_ID } from "./constants.mjs";
import { hasCapability } from "./capabilities.mjs";
import { ITEM_TYPE } from "./vocab.mjs";

/** Status effect ids this module adds to `CONFIG.statusEffects`. */
export const STATUS_HIDING = `${MODULE_ID}.hiding`;
export const STATUS_RUNNING = `${MODULE_ID}.running`;

/** Vision-mode ids registered in `CONFIG.Canvas.visionModes`. */
export const VISION_MODES = Object.freeze({
  BASIC: "basic",
  LIGHTLESS: `${MODULE_ID}Lightless`,
  SHADOWY: `${MODULE_ID}Shadowy`,
  ECHOLOCATION: `${MODULE_ID}Echolocation`,
  NIGHT: `${MODULE_ID}Night`,
});

/** Detection-mode ids. Terrestrial mechanoreception reuses core's own tremor. */
export const DETECTION_MODES = Object.freeze({
  LIGHTLESS: `${MODULE_ID}LightlessVision`,
  SHADOWY: `${MODULE_ID}ShadowySenses`,
  ECHOLOCATION: `${MODULE_ID}Echolocation`,
  MECHANORECEPTION: `${MODULE_ID}Mechanoreception`,
  /** Core's own: ground-borne vibration, through walls, moving targets only. */
  TREMOR: "feelTremor",
});

/** Sight without light, as a capability token; Hiding, for who can beat it. */
const CAP_HIDING = "kw:hiding";
const HIDING_PATTERN = /hid(e|ing)\b|hide\s*in\s*shadows/i;

/** Is this actor's Hiding good enough to beat lightless vision (RULES §4: proficient only)? */
function hidesFromLightless(actor) {
  if (!actor) return false;
  if (hasCapability(actor, CAP_HIDING)) return true;
  return actor.items?.some?.((i) => i.type === ITEM_TYPE.ability && HIDING_PATTERN.test(i.name)) ?? false;
}

/** Does the perceiving token currently carry this status? */
const srcHas = (visionSource, status) => !!visionSource?.object?.document?.hasStatusEffect?.(status);

/* -------------------------------------------- */
/*  Vision modes — how each sense looks          */
/* -------------------------------------------- */

function buildVisionModes() {
  const { VisionMode } = foundry.canvas.perception;
  const shader = foundry.canvas.rendering.shaders.ColorAdjustmentsSamplerShader;

  /**
   * The shared shape of a "sees without light, as dim light" mode. Never
   * remaps DIM to BRIGHT, unlike core's darkvision — see docs/lib/MODEL.md,
   * "Perception: senses, light, and the token". `tint` is the only thing
   * that varies.
   */
  const dimSense = (id, label, tint, saturation = -1) =>
    new VisionMode({
      id,
      label,
      canvas: { shader, uniforms: { contrast: 0, saturation, brightness: 0 } },
      lighting: {
        background: { postProcessingModes: ["SATURATION"], uniforms: { saturation, tint } },
        illumination: { postProcessingModes: ["SATURATION"], uniforms: { saturation, tint } },
        coloration: { postProcessingModes: ["SATURATION"], uniforms: { saturation, tint } },
      },
      vision: {
        darkness: { adaptive: false },
        defaults: { attenuation: 0, contrast: 0, saturation, brightness: 0 },
      },
    });

  return {
    // Heat, not light: warm cast, colourless.
    [VISION_MODES.LIGHTLESS]: dimSense(VISION_MODES.LIGHTLESS, "ACKS-LIB.vision.lightless", [1.0, 0.72, 0.55]),
    // Hearing, scent and touch assembled into a picture: flat and cold.
    [VISION_MODES.SHADOWY]: dimSense(VISION_MODES.SHADOWY, "ACKS-LIB.vision.shadowy", [0.72, 0.8, 1.0]),
    // A returned pulse: colourless and slightly harder-edged.
    [VISION_MODES.ECHOLOCATION]: dimSense(VISION_MODES.ECHOLOCATION, "ACKS-LIB.vision.echolocation", [0.85, 0.9, 0.85]),
    // The one light-based sense: promotes dim to bright like core's
    // lightAmplification, without its green cast.
    [VISION_MODES.NIGHT]: new VisionMode({
      id: VISION_MODES.NIGHT,
      label: "ACKS-LIB.vision.night",
      canvas: { shader, uniforms: { contrast: 0, saturation: -0.3, brightness: 0.3 } },
      lighting: {
        levels: { [VisionMode.LIGHTING_LEVELS.DIM]: VisionMode.LIGHTING_LEVELS.BRIGHT },
        background: { visibility: VisionMode.LIGHTING_VISIBILITY.REQUIRED },
      },
      vision: {
        darkness: { adaptive: false },
        defaults: { attenuation: 0, contrast: 0, saturation: -0.3, brightness: 0.3 },
      },
    }),
  };
}

/* -------------------------------------------- */
/*  Detection modes — what each sense can find   */
/* -------------------------------------------- */

function buildDetectionModes() {
  const { DetectionMode } = foundry.canvas.perception;
  const TYPES = DetectionMode.DETECTION_TYPES;

  /** Lightless vision: real sight, and Hiding proficiency defeats it. */
  class LightlessVisionDetection extends DetectionMode {
    /** @override */
    _canDetect(visionSource, target, level) {
      if (!super._canDetect(visionSource, target, level)) return false;
      // RULES §4: Hiding proficiency alone defeats it; blind/invisible are
      // already handled by core's SIGHT-mode base.
      if (target instanceof Token) {
        const doc = target.document;
        if (doc.hasStatusEffect(STATUS_HIDING) && hidesFromLightless(target.actor)) return false;
      }
      return true;
    }
  }

  /**
   * Shadowy senses: hearing, scent and touch. Fails while deafened, silenced,
   * running, or in magical darkness (inherited from core's wall-respecting
   * darkness bail); survives blindness and invisibility.
   */
  class ShadowySensesDetection extends DetectionMode {
    /** @override */
    _canDetect(visionSource, target, level) {
      if (!super._canDetect(visionSource, target, level)) return false;
      if (srcHas(visionSource, "deaf") || srcHas(visionSource, "silence")) return false;
      if (srcHas(visionSource, STATUS_RUNNING)) return false;
      return true;
    }
  }

  /**
   * Echolocation: a sound pulse. Stopped by walls, silence or deafness; not
   * by darkness or invisibility — overrides core's darkness bail, which core
   * keys to `walls` rather than to type.
   */
  class EcholocationDetection extends DetectionMode {
    /** @override */
    _canDetect(visionSource, target, level) {
      const src = visionSource?.object?.document;
      if (src?.hasStatusEffect(CONFIG.specialStatusEffects.BURROW)) return false;
      if (srcHas(visionSource, "deaf") || srcHas(visionSource, "silence")) return false;
      if (target instanceof Token && target.document.hasStatusEffect(CONFIG.specialStatusEffects.BURROW)) {
        return false;
      }
      // Deliberately no `visionSource.blinded.darkness` check: a bat in a
      // *darkness* spell hears the room exactly as well as it did before.
      return true;
    }
  }

  /**
   * Mechanoreception (aerial / aquatic / webbed): pressure and vibration
   * through air, water or a web. Not sight, not hearing — darkness, silence and
   * invisibility are all irrelevant; walls are not.
   */
  class MechanoreceptionDetection extends DetectionMode {
    /** @override */
    _canDetect(visionSource, target, level) {
      const src = visionSource?.object?.document;
      if (src?.hasStatusEffect(CONFIG.specialStatusEffects.BURROW)) return false;
      if (target instanceof Token && target.document.hasStatusEffect(CONFIG.specialStatusEffects.BURROW)) {
        return false;
      }
      return true;
    }
  }

  return {
    [DETECTION_MODES.LIGHTLESS]: new LightlessVisionDetection({
      id: DETECTION_MODES.LIGHTLESS,
      label: "ACKS-LIB.detection.lightless",
      type: TYPES.SIGHT,
      walls: true,
    }),
    // Hearing-based; deafness and silence switch it off.
    [DETECTION_MODES.SHADOWY]: new ShadowySensesDetection({
      id: DETECTION_MODES.SHADOWY,
      label: "ACKS-LIB.detection.shadowy",
      type: TYPES.SOUND,
      walls: true,
    }),
    [DETECTION_MODES.ECHOLOCATION]: new EcholocationDetection({
      id: DETECTION_MODES.ECHOLOCATION,
      label: "ACKS-LIB.detection.echolocation",
      type: TYPES.SOUND, // core's own comment cites echolocation for this type
      walls: true,
    }),
    // Core files tremorsense and movement detection under MOVE.
    [DETECTION_MODES.MECHANORECEPTION]: new MechanoreceptionDetection({
      id: DETECTION_MODES.MECHANORECEPTION,
      label: "ACKS-LIB.detection.mechanoreception",
      type: TYPES.MOVE,
      walls: true,
    }),
  };
}

/* -------------------------------------------- */

/**
 * Register everything with core. Called once at `init`, before any token is
 * drawn — a token referencing a vision mode that is not registered falls back
 * to basic, so this must not be deferred to `ready`.
 */
export function registerPerceptionModes() {
  Object.assign(CONFIG.Canvas.visionModes, buildVisionModes());
  Object.assign(CONFIG.Canvas.detectionModes, buildDetectionModes());

  // The two conditions core does not ship. Toggled from the token HUD like any
  // other status; nothing infers them.
  CONFIG.statusEffects.push(
    { id: STATUS_HIDING, name: "ACKS-LIB.status.hiding", img: "icons/svg/mystery-man.svg" },
    { id: STATUS_RUNNING, name: "ACKS-LIB.status.running", img: "icons/svg/wingfoot.svg" },
  );
}
