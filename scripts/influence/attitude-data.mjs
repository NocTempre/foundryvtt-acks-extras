/* global foundry */
/**
 * Data model for the `acks-influence.attitude` Item subtype — a stored
 * relationship: a target, the current attitude (ladder index 0-4), and the
 * number of influence attempts used per tone.
 */
const fields = foundry.data.fields;

export default class AttitudeData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      targetUuid: new fields.StringField({ required: false, blank: true }),
      targetName: new fields.StringField({ required: false, blank: true }),
      targetImg: new fields.StringField({ required: false, blank: true }),
      // Current attitude on the 5-rung ladder (0 = Hostile … 4 = Friendly).
      attitude: new fields.NumberField({ required: true, initial: 2, min: 0, max: 4, integer: true }),
      // Attempts-to-influence used per tone (the next attempt level to resume at).
      attempts: new fields.SchemaField({
        diplomacy: new fields.NumberField({ required: true, initial: 0, min: 0, integer: true }),
        intimidation: new fields.NumberField({ required: true, initial: 0, min: 0, integer: true }),
        seduction: new fields.NumberField({ required: true, initial: 0, min: 0, integer: true }),
      }),
      notes: new fields.HTMLField({ required: false, blank: true }),
    };
  }
}
