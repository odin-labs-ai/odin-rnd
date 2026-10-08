// Harness service `ffr`: ffr.v1 events, validated against EXP 008's vendored schema (ffr.v1@ad3aec7c87bc, pinned in
// vendor/ffr/vendor.json) before they are recorded; no schema change. `handoff` is EXP 008's own handoffEvent;
// `step` builds an agent_step event for a harness evaluation. Local compute has no metered price: costUsd is null
// with the reason `local-unpriced`, never zero. Each event is appended to the kernel's `ffr-event` emission (history).
import { defineComponent } from '../kernel.mjs';
import { SCHEMA_ID, handoffEvent, validator } from '../../experiments/latent-handoff/ffr8.mjs';
import { sha256 } from '../../experiments/jev-gate/runner-guard.mjs';
import { safeId } from './vendored-exp008.mjs';

const USAGE = ['prefillTok', 'prefillMs', 'ttftMs', 'peakMemGB'];
const TAG = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** One agent_step event: { runId, itemId, step, ts, model, taskType, durationMs?, usage?, nullReasons?, tags? }. */
export async function stepEvent(source, row) {
  const { validate, familyFor } = await validator();
  const usage = {};
  const nullReasons = { costUsd: 'local-unpriced' };
  for (const f of USAGE) {
    usage[f] = row.usage?.[f] ?? null;
    if (usage[f] === null) nullReasons[f] = row.nullReasons?.[f] ?? 'not-measured';
  }
  usage.costUsd = null;
  usage.costProvenance = 'unknown';
  const stepId = safeId(`${row.itemId}.${row.step}`);
  const tags = (row.tags ?? []).map(t => String(t).toLowerCase());
  for (const t of tags) if (!TAG.test(t)) throw new Error(`ffr tag ${t} is not ${TAG}`);
  const ev = {
    schemaVersion: 'ffr.v1',
    eventId: safeId(`${row.runId}.${stepId}`),
    ts: row.ts,
    source,
    sourceRowHash: `sha256:${sha256(JSON.stringify(row))}`,
    runId: safeId(row.runId),
    stepId,
    parentStepId: null,
    tier: null,
    kind: 'agent_step',
    actor: { model: row.model ?? null, modelFamily: familyFor(row.model ?? null) },
    agentStep: { taskType: row.taskType ?? null, durationMs: row.durationMs ?? null },
    usage,
    quality: { nullReasons, tags },
  };
  const r = validate(ev);
  if (!r.ok) throw new Error(`ffr.v1 refused: ${r.errors.map(e => `${e.code} ${e.path}`).join('; ')}`);
  return ev;
}

export default defineComponent({
  name: 'ffr',
  provides: ['ffr'],
  emits: ['ffr-event'],
  async apply(ctx, { source = 'odin-rnd/harness' } = {}) {
    await validator(); // refuses to load if any vendored byte differs from vendor.json
    ctx.provide('ffr', Object.freeze({
      schemaId: SCHEMA_ID,
      source,
      handoff: async row => ctx.record('ffr-event', await handoffEvent(row)),
      step: async row => ctx.record('ffr-event', await stepEvent(source, row)),
      validate: async ev => (await validator()).validate(ev),
    }));
  },
});
