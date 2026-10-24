// EXP 016 shared definitions: the arms, the request, the served-model check and the cost reading.
// Frozen by sha256 in preregistration.json. run.mjs makes the calls; analyse.mjs scores the rows.

export const BROKERS = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'BROKER_OPENROUTER_KEY', currencyWhenAbsent: 'USD' },
  eurouter: { baseUrl: 'https://api.eurouter.ai/api/v1', keyEnv: 'BROKER_EUROUTER_KEY', currencyWhenAbsent: null },
  requesty: { baseUrl: 'https://router.requesty.ai/v1', keyEnv: 'BROKER_REQUESTY_KEY', currencyWhenAbsent: 'USD' },
};

// Each arm is one model, named by each broker's own id for it. `extra` is added to the request body for that broker
// only: it pins the upstream provider where the broker allows it (OpenRouter: provider.order + no fallbacks).
// Requesty's provider is part of its id (the `anthropic/` and `openai/` ids are the vendors' own APIs). EUrouter
// offers no provider pin; its upstream is recorded from the response.
export const ARMS = {
  sonnet: {
    family: 'claude-sonnet-5-5',
    ids: { openrouter: 'anthropic/claude-sonnet-5.5', eurouter: 'claude-sonnet-5-5', requesty: 'anthropic/claude-sonnet-5-5' },
    extra: { openrouter: { provider: { order: ['anthropic'], allow_fallbacks: false } } },
    sampling: {},
  },
  mini: {
    family: 'gpt-4o-mini',
    ids: { openrouter: 'openai/gpt-4o-mini', eurouter: 'gpt-4o-mini', requesty: 'openai/gpt-4o-mini' },
    extra: { openrouter: { provider: { order: ['openai'], allow_fallbacks: false } } },
    sampling: { temperature: 0 },
  },
};

export const MAX_TOKENS = 400;

export const PROMPT_HEAD = `You are reviewing a small code change to a TypeScript service. Read the diff below and decide whether it can be merged as it is.
Answer in this exact format:
VERDICT: SHIP or FIX-NEEDED
REASON: one sentence.
Then at most three short findings, one per line, each starting with "- ".

`;

/** The request body for one call. Identical across brokers except the model id and the broker's provider pin. */
export function requestBody(arm, broker, patch) {
  const a = ARMS[arm];
  return {
    model: a.ids[broker],
    messages: [{ role: 'user', content: PROMPT_HEAD + patch }],
    max_tokens: MAX_TOKENS,
    ...a.sampling,
    ...(a.extra[broker] || {}),
  };
}

/** The model family of an id, so that a broker's naming of the same model compares equal: the vendor or provider
 *  prefix, a region (`@eu-west-1`), a variant (`:batch`), a Bedrock version (`-v1:0`) and a dated snapshot
 *  (`-20260928`) are dropped, and dots become dashes. `anthropic/claude-sonnet-5.5`, `claude-sonnet-5-5`,
 *  `anthropic.claude-sonnet-5-5-20260928-v1:0` and `claude-sonnet-5-5-20260928` all give `claude-sonnet-5-5`. */
export function family(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  let s = id.trim().toLowerCase();
  s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/@.*$/, '');
  s = s.replace(/-v\d+(:\d+)?$/, '');
  s = s.replace(/:.*$/, '');
  s = s.replace(/^(anthropic|openai|us|eu|apac|global)\./, '');
  s = s.replace(/^(anthropic|openai|us|eu|apac|global)\./, '');
  s = s.replaceAll('.', '-');
  s = s.replace(/-(20\d{2}-?\d{2}-?\d{2})$/, '');
  return s;
}

/** Does the served model id name the requested model? */
export const servedMatches = (arm, servedId) => family(servedId) === ARMS[arm].family;

/** The broker-reported cost of a response: usage.cost in USD, or null with the reason. A cost without a currency
 *  takes the broker's declared currency (OpenRouter and Requesty bill in USD); otherwise it is not counted as USD. */
export function reportedCostUsd(broker, usage) {
  if (!usage || typeof usage !== 'object') return { usd: null, why: 'no-usage' };
  const cost = typeof usage.cost === 'number' ? usage.cost : (typeof usage.cost === 'string' && usage.cost.trim() !== '' ? Number(usage.cost) : null);
  if (cost == null || !Number.isFinite(cost)) return { usd: null, why: 'no-usage-cost' };
  const currency = typeof usage.cost_currency === 'string' ? usage.cost_currency.toUpperCase() : BROKERS[broker].currencyWhenAbsent;
  if (currency !== 'USD') return { usd: null, why: `currency-${currency ?? 'unknown'}` };
  return { usd: cost, why: null };
}
