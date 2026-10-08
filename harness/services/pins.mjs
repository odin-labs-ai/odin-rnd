// Harness service `pins`: EXP 008's model pins (models.json, verified by its own pins.mjs) and the frozen-path census
// of every file an experiment binds. Import-only: the EXP 008 module is used as published, never edited.
import { defineComponent } from '../kernel.mjs';
import { census } from '../frozen-census.mjs';
import { EXPECTED_GEOMETRY, MODELS_PATH, loadModels, verify } from '../../experiments/latent-handoff/pins.mjs';

export default defineComponent({
  name: 'pins',
  provides: ['pins'],
  apply(ctx, { modelsPath = MODELS_PATH, cacheRoot = null } = {}) {
    const models = loadModels(modelsPath);
    ctx.provide('pins', Object.freeze({
      models,
      geometry: EXPECTED_GEOMETRY,
      /** pins.mjs --verify, in process: the error list (empty = verified). Reads the weight cache; never downloads. */
      verifyModels: () => verify(models, cacheRoot ? { root: cacheRoot } : {}),
      /** The frozen-path census of the repo (or a scratch root): { entries, violations }. */
      frozen: root => census(root),
    }));
  },
});
