// The HTML is the reading path. JavaScript opens already-rendered compartments.
const readData = (document, id) => JSON.parse(document.querySelector(id)?.textContent ?? 'null');

export function setupFactory(document, environment = globalThis) {
  const controls = [...document.querySelectorAll('[data-station]')];
  if (!controls.length) return;
  const exhibits = [...document.querySelectorAll('[data-exhibit]')];
  const geometry = [...document.querySelectorAll('[data-floor-station]')];
  const layers = [...document.querySelectorAll('[data-factory-layer]')];
  const status = document.querySelector('#station-status');
  const unavailable = document.querySelector('#station-unavailable');
  const drawing = document.querySelector('.factory-drawing');
  const art = document.querySelector('.floor-art');
  const compartment = document.querySelector('.station-compartment');
  const trace = document.querySelector('.station-trace');
  const scan = document.querySelector('.drafting-scan');
  const toggle = document.querySelector('#blueprint-toggle');
  const replay = document.querySelector('#factory-replay');
  let stations;
  const fail = () => {
    exhibits.forEach(exhibit => { exhibit.hidden = true; });
    unavailable.hidden = false;
    status.textContent = 'Station evidence unavailable. Follow a full experiment link to inspect its recording.';
  };
  try {
    stations = readData(document, '#station-data');
    if (!Array.isArray(stations) || stations.length !== controls.length ||
        new Set(stations.map(s => s.id)).size !== controls.length ||
        controls.some(control => !stations.some(s => s.id === control.dataset.station && typeof s.title === 'string' && typeof s.trace === 'string' && /^M[-\d., L]+$/.test(s.trace)))) throw new Error('Invalid station contract');
  } catch { fail(); return; }
  let active = stations[0].id;
  const animations = new Set();
  const reduce = environment.matchMedia?.('(prefers-reduced-motion: reduce)');
  let assembled = Boolean(reduce?.matches);
  const settle = () => { animations.forEach(animation => animation.cancel()); animations.clear(); };
  // The drawing is always complete in HTML/CSS. A cancelled or unsupported animation exposes that final state.
  const animate = (element, frames, duration, delay = 0) => {
    if (!element?.animate || reduce?.matches || document.hidden) return;
    const animation = element.animate(frames, { duration, delay, easing:'cubic-bezier(.16,1,.3,1)', fill:'backwards' });
    animations.add(animation);
    animation.onfinish = () => animations.delete(animation);
    return animation;
  };
  const assembly = group => group?.querySelector?.('.station-assembly');
  const drawTrace = (delay = 0) => animate(trace, [{ strokeDashoffset:1, opacity:0 }, { strokeDashoffset:0, opacity:.78 }], 620, delay);
  const assemble = () => {
    assembled = true;
    settle();
    const layer = name => layers.find(element => element.dataset.factoryLayer === name);
    animate(layer('floor'), [{ opacity:0, transform:'translateY(24px) scale(.96)' }, { opacity:1, transform:'none' }], 640);
    animate(layer('services'), [{ opacity:0, transform:'translateY(-64px)' }, { opacity:1, transform:'none' }], 720, 90);
    animate(layer('conveyor'), [{ opacity:0, transform:'translateX(-58px)' }, { opacity:1, transform:'none' }], 650, 140);
    animate(layer('wayfinding'), [{ opacity:0 }, { opacity:1 }], 460, 350);
    const order = ['blueprint','workcell','gate','record','decision','triage','floor'];
    order.forEach((id, index) => animate(assembly(geometry.find(group => group.dataset.floorStation === id)),
      [{ opacity:0, transform:'translateY(-48px)' }, { opacity:1, transform:'none' }], 650, 180 + index * 45));
    animate(layer('annotation'), [{ opacity:0 }, { opacity:1 }], 420, 600);
    drawTrace(500);
  };
  const select = (id, motion = true) => {
    const station = stations.find(s => s.id === id);
    const exhibit = exhibits.find(e => e.dataset.exhibit === id);
    settle();
    if (motion) assembled = true;
    if (!station || !exhibit) { fail(); return; }
    unavailable.hidden = true;
    const changed = active !== id;
    active = id;
    controls.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.station === id)));
    geometry.forEach(group => group.classList.toggle('active', group.dataset.floorStation === id));
    exhibits.forEach(other => { other.hidden = other !== exhibit; });
    trace?.setAttribute('d', station.trace);
    status.textContent = `${station.label}: ${station.title} ${station.status ? `${station.status}. Selected.` : 'Recorded experiment selected.'}`;
    if (!changed || !motion) return;
    assembled = true;
    const selected = geometry.find(group => group.dataset.floorStation === id);
    animate(assembly(selected), [{ transform:'translateY(14px)' }, { transform:'none' }], 480);
    animate(selected?.querySelector?.('.station-marker'), [{ opacity:.4, transform:'scale(.8)' }, { opacity:1, transform:'scale(1)' }], 420);
    drawTrace();
    animate(exhibit, [{ opacity:.55, clipPath:'inset(0 0 12% 0)', transform:'translateY(9px)' }, { opacity:1, clipPath:'inset(0)', transform:'none' }], 460);
  };
  controls.forEach(control => {
    control.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button && event.button !== 0)) return;
      event.preventDefault();
      select(control.dataset.station);
    });
    control.addEventListener('keydown', event => {
      if (event.key !== ' ') return;
      event.preventDefault();
      select(control.dataset.station);
    });
    control.setAttribute('role', 'button');
    control.setAttribute('aria-controls', `station-${control.dataset.station}`);
    control.setAttribute('aria-pressed', String(control.dataset.station === active));
    control.removeAttribute('aria-current');
  });
  toggle?.addEventListener('click', () => {
    assembled = true;
    settle();
    const blueprint = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(blueprint));
    drawing.dataset.view = compartment.dataset.view = blueprint ? 'blueprint' : 'floor';
    // A finite drafting sweep makes the change of material explicit, without simulating a running machine.
    animate(scan, [
      { opacity:0, transform:'translateX(-10px)', offset:0 },
      { opacity:.8, offset:.12 }, { opacity:.8, offset:.8 },
      { opacity:0, transform:'translateX(830px)', offset:1 }
    ], 720);
    drawTrace(80);
  });
  if (toggle) toggle.hidden = false;
  replay?.addEventListener('click', assemble);
  const syncReplay = () => { if (replay) replay.hidden = Boolean(reduce?.matches) || !art?.animate || !layers.length; };
  syncReplay();
  // A #station-<id> link opens the matching record, without moving keyboard focus.
  const fromHash = (motion = true) => { const id = environment.location?.hash?.match(/^#station-([\w-]+)$/)?.[1]; if (id && stations.some(s => s.id === id)) select(id, motion); };
  fromHash(false);
  environment.addEventListener?.('hashchange', () => fromHash());
  document.addEventListener('visibilitychange', () => { if (document.hidden) settle(); });
  reduce?.addEventListener?.('change', () => { assembled = true; settle(); syncReplay(); });
  if (environment.IntersectionObserver && art) new environment.IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) { settle(); continue; }
      if (!assembled && !document.hidden) assemble();
    }
  }, { threshold:.12 }).observe(art);
  return { select, settle, assemble };
}

export function setupExperiments(document, environment = globalThis) {
  if (!document.querySelector('#experiment-data')) return;
  let report;
  try {
    report = readData(document, '#experiment-data');
    if (!report?.runs?.length || !/^\d+\.\d+\.\d+$/.test(report.engine?.version) || !Number.isFinite(Date.parse(report.completedAt))) throw new Error('Invalid experiment data');
  } catch {
    document.querySelector('#run-badge').textContent = 'RECORDING UNAVAILABLE';
    for (const id of ['#clean-result','#drift-result']) document.querySelector(id).textContent = 'UNVERIFIED';
    document.querySelector('#transcript').textContent = 'The recording could not be read. Use Full result & provenance to inspect the source.';
    return;
  }
  const showExperiment = index => {
    const run = report.runs[index];
    if (!run) return;
    document.querySelectorAll('[data-experiment]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    document.querySelector('#run-id').textContent = 'EXP / ' + String(index + 1).padStart(3, '0');
    document.querySelector('#run-title').textContent = run.title;
    document.querySelector('#run-question').textContent = run.question;
    document.querySelector('#run-badge').textContent = run.passed ? 'TOLD APART / YES' : 'TOLD APART / NO';
    document.querySelector('#clean-result').textContent = run.cleanScore == null ? 'UNVERIFIED' : 'SCORE ' + run.cleanScore;
    document.querySelector('#drift-result').textContent = run.driftScore == null ? 'UNVERIFIED' : 'SCORE ' + run.driftScore;
    document.querySelector('#transcript').textContent = run.transcript;
    document.querySelector('#reproduce-command').textContent = `npm exec --yes --package=bce-engine@${report.engine.version} -- bce demo --recipe ${run.id}`;
    document.querySelector('#run-date').textContent = 'RECORDED ' + new Date(report.completedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    document.querySelector('#run-origin').textContent = 'Recording environment: ' + report.environment + '.';
    document.querySelector('#copy-status').textContent = '';
  };
  document.querySelectorAll('[data-experiment]').forEach((button, index) => button.addEventListener('click', () => showExperiment(index)));
  document.querySelector('#station-blueprint .station-full')?.addEventListener('click', () => {
    const index = report.runs.findIndex(run => run.id === 'module-layering');
    if (index >= 0) showExperiment(index);
  });
  document.querySelector('#copy-command')?.addEventListener('click', async () => {
    const status = document.querySelector('#copy-status');
    try {
      await environment.navigator.clipboard.writeText(document.querySelector('#reproduce-command').textContent);
      status.textContent = 'Command copied.';
      document.dispatchEvent(new Event('rd-reproduction-copied'));
    } catch {
      status.textContent = 'Select the command above to copy it manually.';
    }
  });
  showExperiment(0);
}

// Further benches name the command they copy; the status beside each button reports the outcome.
export function setupCopyButtons(document, environment = globalThis) {
  document.querySelectorAll('[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
    const status = button.nextElementSibling;
    try {
      await environment.navigator.clipboard.writeText(document.getElementById(button.dataset.copyTarget).textContent);
      status.textContent = 'Command copied.';
    } catch {
      status.textContent = 'Select the command above to copy it manually.';
    }
  }));
}

if (globalThis.document) {
  setupFactory(document);
  setupExperiments(document);
  setupCopyButtons(document);
}
