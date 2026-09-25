// The HTML is the reading path. JavaScript opens already-rendered compartments.
const readData = (document, id) => JSON.parse(document.querySelector(id)?.textContent ?? 'null');

export function setupFactory(document, environment = globalThis) {
  const controls = [...document.querySelectorAll('[data-station]')];
  if (!controls.length) return;
  const exhibits = [...document.querySelectorAll('[data-exhibit]')];
  const geometry = [...document.querySelectorAll('[data-floor-station]')];
  const status = document.querySelector('#station-status');
  const unavailable = document.querySelector('#station-unavailable');
  const drawing = document.querySelector('.factory-drawing');
  const compartment = document.querySelector('.station-compartment');
  const crop = document.querySelector('.station-crop');
  const trace = document.querySelector('.station-trace');
  const toggle = document.querySelector('#blueprint-toggle');
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
        controls.some(control => !stations.some(s => s.id === control.dataset.station && typeof s.title === 'string' && /^[-\d. ]+$/.test(s.crop)))) throw new Error('Invalid station contract');
  } catch { fail(); return; }
  let active = stations[0].id;
  let animations = [];
  const reduce = environment.matchMedia?.('(prefers-reduced-motion: reduce)');
  const settle = () => { animations.forEach(animation => animation.cancel()); animations = []; };
  const animate = (element, frames, duration) => {
    if (!element?.animate || reduce?.matches || document.hidden) return;
    animations.push(element.animate(frames, { duration, easing:'cubic-bezier(.16,1,.3,1)' }));
  };
  const select = id => {
    const station = stations.find(s => s.id === id);
    const exhibit = exhibits.find(e => e.dataset.exhibit === id);
    settle();
    if (!station || !exhibit) { fail(); return; }
    unavailable.hidden = true;
    const changed = active !== id;
    active = id;
    controls.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.station === id)));
    geometry.forEach(group => group.classList.toggle('active', group.dataset.floorStation === id));
    exhibits.forEach(other => { other.hidden = other !== exhibit; });
    crop?.setAttribute('viewBox', station.crop);
    if (station.trace) trace?.setAttribute('d', station.trace);
    status.textContent = `${station.label}: ${station.title} Recorded experiment selected.`;
    if (!changed) return;
    animate(geometry.find(group => group.dataset.floorStation === id), [{ transform:'translateY(0)' }, { transform:'translateY(-5px)' }], 360);
    animate(trace, [{ strokeDashoffset:1 }, { strokeDashoffset:0 }], 350);
    animate(exhibit, [{ opacity:.65, clipPath:'inset(0 0 8% 0)' }, { opacity:1, clipPath:'inset(0)' }], 480);
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
    settle();
    const blueprint = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(blueprint));
    drawing.dataset.view = compartment.dataset.view = blueprint ? 'blueprint' : 'floor';
    animate(trace, [{ strokeDashoffset:1 }, { strokeDashoffset:0 }], 300);
  });
  if (toggle) toggle.hidden = false;
  document.addEventListener('visibilitychange', () => { if (document.hidden) settle(); });
  reduce?.addEventListener?.('change', settle);
  if (environment.IntersectionObserver) new environment.IntersectionObserver(entries => {
    if (entries.every(entry => !entry.isIntersecting)) settle();
  }).observe(drawing);
  return { select, settle };
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
    document.querySelector('#run-badge').textContent = run.passed ? 'DISCRIMINATION / PASS' : 'DISCRIMINATION / FAILED';
    document.querySelector('#clean-result').textContent = run.cleanScore == null ? 'UNVERIFIED' : 'GREEN / ' + run.cleanScore;
    document.querySelector('#drift-result').textContent = run.driftScore == null ? 'UNVERIFIED' : 'RED / ' + run.driftScore;
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
