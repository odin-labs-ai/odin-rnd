// Runs Laya typed decisions on the visitor's device. Nothing is fetched until the visitor presses
// the download button; every fetched file is pinned by an immutable URL and checked by hash before use.
import { QTYPES, buildSequence, formatAnswer, questionFromForm, renderOptions, toInternal } from './laya-core.mjs';

const CDN = 'https://cdn.jsdelivr.net/npm/';
const SOURCE = 'https://huggingface.co/convaiinnovations/laya/resolve/55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851/typed-decisions/';
const WEIGHTS = 'https://huggingface.co/VishalMysore/layaForWebTrained/resolve/dd0c52a2b563bea25279e2689689061dd0a1c382/';

export const pins = Object.freeze({
  runtime: {
    ort: { url: CDN + 'onnxruntime-web@1.30.0/dist/ort.wasm.bundle.min.mjs', size: 73054, sha384: 'PLWz+nHEVHpjwBsO0YVdvQj6n5814Iv8E3b8FG0Rp/uIAtjFMCKOpP66iPzedrIG' },
    wasm: { url: CDN + 'onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm', size: 14239897, sha384: 'vjBJ1z7qrhkTyYsNqKeF6c7N+nOJSU94czEo+tvZcu8G75JparGq9kB+kTnEUNVM' },
    tokenizers: { url: CDN + '@huggingface/tokenizers@0.2.0/dist/tokenizers.min.mjs', size: 36601, sha384: 'Tl2lMbeE3RCGFLOUGQ7LhvaagysxiOw/9dulz2sD6jxNa1MckRJQBbYdVHhOoqEs' },
  },
  source: {
    tokenizer: { url: SOURCE + 'tokenizer/tokenizer.json', size: 3583228, sha256: '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30' },
    tokenizerConfig: { url: SOURCE + 'tokenizer/tokenizer_config.json', size: 337, sha256: '08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1' },
    config: { url: SOURCE + 'rl_agent_config.json', size: 847, sha256: 'ebf0cd524d92342a6be5e48e9fca3d7c2babfb5a56ccd79d2171ef5d8c7f7be8' },
  },
  model: {
    graph: { url: WEIGHTS + 'laya_q8e8.onnx', size: 3570180, sha256: '599756d6506db9659279f4ac7871045801f90539844fbda6cd2918b6316e2d07' },
    data: {
      name: 'laya_q8e8.onnx.data', size: 442221312, partBytes: 25165824,
      sha256: 'e5ac4bfe0503361dacac825a91a82ae860e3a5d38dfb021dcf0bd37369573b44',
      parts: Array.from({ length: 18 }, (_, i) => WEIGHTS + 'laya_q8e8.onnx.data.part' + String(i).padStart(3, '0')),
    },
  },
});

export function totalBytes(p = pins) {
  return [...Object.values(p.runtime), ...Object.values(p.source), p.model.graph].reduce((sum, file) => sum + file.size, 0) + p.model.data.size;
}

const MiB = bytes => (bytes / 1048576).toFixed(0);
const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
const base64 = buffer => btoa(Array.from(new Uint8Array(buffer), b => String.fromCharCode(b)).join(''));

async function download(file, onBytes, target, offset = 0) {
  const response = await fetch(file.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'force-cache' });
  if (!response.ok) throw new Error(`${file.url} answered HTTP ${response.status}.`);
  const reader = response.body.getReader();
  const out = target || new Uint8Array(file.size);
  let at = offset;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > out.length) throw new Error(`${file.url} is larger than its pinned size.`);
    out.set(value, at); at += value.length; onBytes(value.length);
  }
  if (!target && at !== file.size) throw new Error(`${file.url} has ${at} bytes, pinned ${file.size}.`);
  return target ? at - offset : out;
}

async function verified(file, bytes) {
  if (file.sha384) {
    const actual = base64(await crypto.subtle.digest('SHA-384', bytes));
    if (actual !== file.sha384) throw new Error(`${file.url} does not match its pinned SHA-384.`);
  } else {
    const actual = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (actual !== file.sha256) throw new Error(`${file.url} does not match its pinned SHA-256.`);
  }
  return bytes;
}

async function importVerified(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
  try { return await import(url); } finally { URL.revokeObjectURL(url); }
}

export async function loadLaya(onProgress = () => {}) {
  const total = totalBytes();
  let received = 0;
  const tick = n => { received += n; onProgress({ received, total }); };
  const fetchFile = async file => verified(file, await download(file, tick));
  const [ortBytes, wasmBytes, tokBytes] = await Promise.all([pins.runtime.ort, pins.runtime.wasm, pins.runtime.tokenizers].map(fetchFile));
  const [tokenizerJson, tokenizerConfig, config] = await Promise.all([pins.source.tokenizer, pins.source.tokenizerConfig, pins.source.config].map(async file => JSON.parse(new TextDecoder().decode(await fetchFile(file)))));
  const graph = await fetchFile(pins.model.graph);
  const data = new Uint8Array(pins.model.data.size);
  let offset = 0;
  for (const url of pins.model.data.parts) offset += await download({ url }, tick, data, offset);
  if (offset !== pins.model.data.size) throw new Error(`Model weights have ${offset} bytes, pinned ${pins.model.data.size}.`);
  onProgress({ received, total, stage: 'verify' });
  await verified(pins.model.data, data);
  const ort = await importVerified(ortBytes);
  const { Tokenizer } = await importVerified(tokBytes);
  ort.env.wasm.wasmBinary = wasmBytes;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  onProgress({ received, total, stage: 'session' });
  const session = await ort.InferenceSession.create(graph, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', externalData: [{ path: pins.model.data.name, data }] });
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const encode = text => Array.from(tokenizer.encode(text, { add_special_tokens: false }).ids, Number);
  const special = { cls: tokenizer.token_to_id('[CLS]'), sep: tokenizer.token_to_id('[SEP]'), mask: tokenizer.token_to_id('[MASK]') };
  return {
    async decide(state, question) {
      const q = toInternal(question);
      const { ids, markers } = buildSequence(encode, special, state, q, config.max_len, config.head_max_len);
      if (markers.length !== renderOptions(q).length) throw new Error(`The options do not fit in ${config.head_max_len} tokens. Shorten them.`);
      const i64 = values => BigInt64Array.from(values, BigInt);
      const feeds = {
        input_ids: new ort.Tensor('int64', i64(ids), [1, ids.length]),
        attention_mask: new ort.Tensor('int64', i64(ids.map(() => 1)), [1, ids.length]),
        marker_pos: new ort.Tensor('int64', i64(markers), [1, markers.length]),
        marker_mask: new ort.Tensor('bool', Uint8Array.from(markers, () => 1), [1, markers.length]),
        qtype: new ort.Tensor('int64', i64([QTYPES[q.t]]), [1]),
      };
      const started = performance.now();
      const out = await session.run(feeds);
      const ms = performance.now() - started;
      return { answer: formatAnswer(q, Array.from(out.logits.data).slice(0, markers.length), config), ms, tokens: ids.length };
    },
  };
}

// ---------------------------------------------------------------------------------------- page
const examples = {
  'route-damaged-order': { state: 'Order 4821 arrived with the screen cracked. I would like a replacement sent before Friday.', type: 'choice', instructions: 'Which team should handle this message?', options: 'returns: Damaged or wrong item\nbilling: Charges, refunds or invoices\ntechnical: Product not working as documented\nsales: Pricing or a new purchase' },
  'urgency-broken-build': { state: 'The nightly build has failed three times in a row and nobody can merge to main.', type: 'score', instructions: 'How urgent is this for the engineering team?', options: 'Can wait until next sprint\nThis week\nToday\nRight now' },
  'request-thank-you': { state: 'Thanks for the quick fix yesterday, everything works again!', type: 'noul', instructions: 'The customer is asking for something.', options: '' },
};

const percent = p => (p * 100).toFixed(1) + '%';

function resultRows(answer) {
  if (answer.type === 'noul') return [['yes', answer.noul], ['no', Math.round((1 - answer.noul) * 1e4) / 1e4]];
  if (answer.type === 'score') return Object.entries(answer.probabilities).map(([i, p]) => [`${i} · ${answer.legend[i]}`, p]);
  return Object.entries(answer.probabilities);
}

function headline(answer) {
  if (answer.type === 'choice') return `Choice: ${answer.choice}`;
  if (answer.type === 'score') return `Score: ${answer.score.toFixed(2)} on a 0–${Object.keys(answer.legend).length - 1} scale`;
  return `Yes/no: ${answer.noul >= 0.5 ? 'yes' : 'no'} (p(yes) = ${answer.noul.toFixed(4)})`;
}

function renderResult(doc, root, { answer, ms, tokens }, id) {
  root.replaceChildren();
  root.dataset.case = id || '';
  root.dataset.answer = JSON.stringify(answer);
  const h = doc.createElement('h3'); h.textContent = headline(answer); root.append(h);
  const table = doc.createElement('table'); table.className = 'laya-probabilities';
  const caption = doc.createElement('caption'); caption.textContent = 'Calibrated probabilities computed in this browser'; table.append(caption);
  const head = doc.createElement('thead'); head.innerHTML = '<tr><th scope="col">Option</th><th scope="col">Probability</th></tr>'; table.append(head);
  const body = doc.createElement('tbody');
  const rows = resultRows(answer);
  const best = Math.max(...rows.map(([, p]) => p));
  for (const [label, p] of rows) {
    const tr = doc.createElement('tr'); if (p === best) tr.className = 'laya-top';
    const th = doc.createElement('th'); th.scope = 'row'; th.textContent = label + (p === best ? ' (highest)' : '');
    const td = doc.createElement('td');
    const bar = doc.createElement('span'); bar.className = 'laya-bar'; bar.style.setProperty('--p', String(p)); bar.setAttribute('aria-hidden', 'true');
    const value = doc.createElement('span'); value.className = 'laya-value'; value.textContent = `${p.toFixed(4)} · ${percent(p)}`;
    td.append(bar, value); tr.append(th, td); body.append(tr);
  }
  table.append(body); root.append(table);
  const meta = doc.createElement('p'); meta.className = 'laya-meta';
  meta.textContent = `${'confidence' in answer ? `Confidence ${answer.confidence.toFixed(4)} · ` : ''}${tokens} tokens · ${Math.round(ms)} ms on this device`;
  root.append(meta);
}

export function bindPage(doc) {
  const $ = id => doc.getElementById(id);
  const loadButton = $('laya-load'), status = $('laya-status'), progress = $('laya-progress'), form = $('laya-form'), result = $('laya-result'), formStatus = $('laya-form-status');
  if (!loadButton) return;
  $('laya-size').textContent = `${MiB(totalBytes())} MiB`;
  let laya = null, currentExample = null;
  const syncType = () => {
    const type = form.elements.type.value;
    $('laya-options-field').hidden = type === 'noul';
    $('laya-options-help').textContent = type === 'score' ? 'One level per line, lowest first.' : 'One option per line. Optionally add a description after a colon: label: description.';
  };
  form.elements.type.addEventListener('change', () => { currentExample = null; syncType(); });
  for (const name of ['state', 'instructions', 'options']) form.elements[name].addEventListener('input', () => { currentExample = null; });
  for (const button of doc.querySelectorAll('[data-laya-example]')) {
    button.addEventListener('click', () => {
      const example = examples[button.dataset.layaExample];
      for (const key of ['state', 'type', 'instructions', 'options']) form.elements[key].value = example[key];
      currentExample = button.dataset.layaExample;
      syncType();
      formStatus.textContent = 'Example filled in. Press Decide to run it.';
    });
  }
  syncType();
  loadButton.addEventListener('click', async () => {
    loadButton.disabled = true;
    progress.hidden = false;
    status.textContent = 'Downloading…';
    try {
      let lastPercent = -1;
      laya = await loadLaya(({ received, total, stage }) => {
        progress.value = received / total;
        if (stage === 'verify') status.textContent = 'Checking the weights against their pinned hash…';
        else if (stage === 'session') status.textContent = 'Starting the runtime on this device…';
        else {
          const now = Math.floor((received / total) * 100);
          if (now !== lastPercent && now % 5 === 0) { lastPercent = now; status.textContent = `Downloading: ${MiB(received)} of ${MiB(total)} MiB`; }
        }
      });
      progress.hidden = true;
      status.textContent = 'Model ready. It runs on this device; your text is not sent anywhere.';
      doc.body.dataset.layaReady = 'true';
      for (const control of form.querySelectorAll('button,input,select,textarea')) control.disabled = false;
      // The download button is now disabled; hand keyboard focus to the first control that works.
      form.querySelector('[data-laya-example]').focus();
    } catch (error) {
      progress.hidden = true;
      status.textContent = `Could not load the model: ${error.message}`;
      loadButton.disabled = false;
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!laya) return;
    const state = form.elements.state.value.trim();
    if (!state) { formStatus.textContent = 'Write the state the model should read.'; form.elements.state.focus(); return; }
    const parsed = questionFromForm({ type: form.elements.type.value, instructions: form.elements.instructions.value, options: form.elements.options.value });
    if (parsed.error) { formStatus.textContent = parsed.error; return; }
    const submit = $('laya-decide');
    if (submit.getAttribute('aria-disabled') === 'true') return;
    // Keep focus on the button while it works: a disabled button would drop keyboard focus.
    submit.setAttribute('aria-disabled', 'true'); formStatus.textContent = 'Deciding…';
    try {
      const outcome = await laya.decide(state, parsed.question);
      renderResult(doc, result, outcome, currentExample);
      result.hidden = false;
      formStatus.textContent = headline(outcome.answer);
    } catch (error) {
      formStatus.textContent = `The model could not answer: ${error.message}`;
    } finally { submit.removeAttribute('aria-disabled'); }
  });
}

if (typeof document !== 'undefined') bindPage(document);
