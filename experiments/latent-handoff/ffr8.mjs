// EXP 008 (latent-handoff) ffr.v1 emitter, bundle 3 WO-07.
//
// Every arm call becomes one ffr.v1 `handoff` event: channel `text` (A0, C3), `summary` (A1) or `kv-transferred`
// (C1, C2, A2a, A2b, A3 = the generic pluggable-transfer slot), with usage {prefillTok, prefillMs, ttftMs, peakMemGB}. Each event is validated against the
// vendored schema (vendor/ffr, pinned by sha256 in vendor/ffr/vendor.json) before it is written; an invalid event
// throws and nothing is written. Local MLX compute has no metered price, so costUsd is null with the reason
// `local-unpriced` (zero never means unknown).
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VENDOR = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'ffr');
export const SCHEMA_ID = 'ffr.v1@ad3aec7c87bc';
export const SOURCE = 'odin-rnd/latent-handoff';

export const CHANNEL = Object.freeze({
  A0: 'text', C3: 'text', A1: 'summary', C1: 'kv-transferred', C2: 'kv-transferred', A2a: 'kv-transferred', A2b: 'kv-transferred', A3: 'kv-transferred',
});
const USAGE_FIELDS = ['prefillTok', 'prefillMs', 'ttftMs', 'peakMemGB'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Refuse to load a vendored file whose bytes differ from vendor.json. */
export function assertVendor(dir = VENDOR) {
  const pins = JSON.parse(readFileSync(join(dir, 'vendor.json'), 'utf8'));
  for (const [file, want] of Object.entries(pins.files)) {
    const got = sha256(readFileSync(join(dir, file)));
    if (got !== want) throw new Error(`vendor/ffr/${file} hashes to ${got}, pinned ${want}`);
  }
  if (`ffr.v1@${pins.files['ffr.v1.schema.json'].slice(0, 12)}` !== SCHEMA_ID) throw new Error('vendored schema is not ffr.v1@ad3aec7c87bc');
  return pins;
}

let validatorPromise;
export async function validator(dir = VENDOR) {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      assertVendor(dir);
      const mod = await import(join(dir, 'validate.mjs'));
      const lookup = mod.loadFamilies(join(dir, 'ffr-model-family.json'));
      return {
        validate: mod.makeValidator({ schemaPath: join(dir, 'ffr.v1.schema.json'), familyPath: join(dir, 'ffr-model-family.json') }),
        familyFor: model => mod.familyFor(model, lookup),
      };
    })();
  }
  return validatorPromise;
}

const ID = /[^A-Za-z0-9._:-]/g;
const safeId = s => String(s).replace(ID, '-').slice(0, 128);

/**
 * Build one handoff event from a runner result row:
 *   { runId, itemId, stratum, arm, fromModel, toModel, ts, usage: {prefillTok, prefillMs, ttftMs, peakMemGB} }
 * A usage value that is null must come with a reason in row.nullReasons[field].
 */
export async function handoffEvent(row) {
  const { validate, familyFor } = await validator();
  const channel = CHANNEL[row.arm];
  if (!channel) throw new Error(`no ffr channel for arm ${row.arm}`);
  const usage = {};
  const nullReasons = { costUsd: 'local-unpriced' };
  for (const f of USAGE_FIELDS) {
    const v = row.usage?.[f];
    usage[f] = v ?? null;
    if (usage[f] === null) {
      if (!row.nullReasons?.[f]) throw new Error(`usage.${f} is null without a reason`);
      nullReasons[f] = row.nullReasons[f];
    }
  }
  usage.costUsd = null;
  usage.costProvenance = 'unknown';
  const stepId = safeId(`${row.itemId}.${row.stratum}.${row.arm}`);
  const ev = {
    schemaVersion: 'ffr.v1',
    eventId: safeId(`${row.runId}.${stepId}`),
    ts: row.ts,
    source: SOURCE,
    sourceRowHash: `sha256:${sha256(JSON.stringify(row))}`,
    runId: safeId(row.runId),
    stepId,
    parentStepId: null,
    tier: null,
    kind: 'handoff',
    actor: { model: row.toModel, modelFamily: familyFor(row.toModel) },
    handoff: { channel, fromModel: channel === 'text' ? null : row.fromModel, toModel: row.toModel },
    usage,
    quality: { nullReasons, tags: [safeId(`arm-${row.arm}`).toLowerCase(), `stratum-${String(row.stratum).toLowerCase()}`] },
  };
  const r = validate(ev);
  if (!r.ok) throw new Error(`ffr.v1 refused: ${r.errors.map(e => `${e.code} ${e.path}`).join('; ')}`);
  return ev;
}

/** Validate, then append one JSON line. Nothing is written for an invalid event. */
export async function emit(path, row) {
  const ev = await handoffEvent(row);
  appendFileSync(path, `${JSON.stringify(ev)}\n`);
  return ev;
}
