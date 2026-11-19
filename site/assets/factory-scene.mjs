// All evidence is rendered at build time. Without this enhancement the points link to the recorded tests.
export function setupFactoryScene(scene) {
  const pins = [...scene.querySelectorAll('[data-studio-stage]')];
  const panels = [...scene.querySelectorAll('[data-studio-result]')];
  const buttons = [...scene.querySelectorAll('[data-studio-suite]')];
  const observations = [...scene.querySelectorAll('[data-studio-observation]')];
  const decisions = [...scene.querySelectorAll('[data-studio-decision]')];
  const status = scene.querySelector('[data-studio-status]');
  if (!status || !pins.length || !buttons.length) return;
  if (!pins.every(pin => panels.some(panel => panel.dataset.studioResult === pin.dataset.studioStage))) return;
  if (!buttons.every(button => observations.some(panel => panel.dataset.studioObservation === button.dataset.studioSuite)
    && decisions.some(panel => panel.dataset.studioDecision === button.dataset.studioSuite))) return;

  // The stylesheet supplies one finite scan only when the reader permits motion.
  function scan() {
    scene.dataset.studioInspected = 'true';
    const beam = scene.querySelector('.factory-scan-beam');
    for (const effect of beam?.getAnimations?.() ?? []) {
      effect.currentTime = 0;
      effect.play();
    }
  }

  function selectStage(stage) {
    scene.dataset.activeStage = stage;
    for (const pin of pins) {
      if (pin.dataset.studioStage === stage) pin.setAttribute('aria-current', 'step');
      else pin.removeAttribute('aria-current');
    }
    for (const panel of panels) panel.hidden = panel.dataset.studioResult !== stage;
  }

  function selectSuite(suite) {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.studioSuite === suite));
    for (const panel of observations) panel.hidden = panel.dataset.studioObservation !== suite;
    for (const panel of decisions) panel.hidden = panel.dataset.studioDecision !== suite;
    const gate = pins.find(pin => pin.dataset.studioStage === 'gate');
    const receipt = decisions.find(panel => !panel.hidden).querySelector('a');
    if (gate && receipt) gate.href = receipt.href;
  }

  for (const pin of pins) {
    pin.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectStage(pin.dataset.studioStage);
      scan();
      const panel = panels.find(panel => !panel.hidden);
      const reading = panel.querySelector('.factory-readouts, div:not([hidden]) > .factory-reading');
      status.textContent = [panel.querySelector('h3'), reading]
        .filter(Boolean).map(node => node.textContent.trim().replace(/\s+/g, ' ')).join('. ');
    });
  }
  for (const button of buttons) {
    button.addEventListener('click', () => {
      selectSuite(button.dataset.studioSuite);
      scan();
      const visible = observations.find(panel => !panel.hidden);
      status.textContent = visible.querySelector('.factory-reading').textContent;
    });
  }

  selectSuite('ordinary');
  selectStage('invoice');
}

if (typeof document !== 'undefined') {
  for (const scene of document.querySelectorAll('.factory-scene')) setupFactoryScene(scene);
}
