import { renderFactoryReceipts } from './factory-receipts.mjs';

const inspections = [
  { stage: 'invoice', label: 'Invoice', observation: 'rounding-strong' },
  { stage: 'test', label: 'Test bench', observation: 'rounding-weak' },
  { stage: 'gate', label: 'Gate', observation: 'rounding-always-pass' },
];

export function renderFactoryScene(report) {
  const pins = inspections.map(({ stage, label, observation }, index) => `
    <a class="factory-scene-pin" data-studio-stage="${stage}" href="projects/test-witness/#observation-${observation}"${index === 0 ? ' aria-current="step"' : ''} aria-label="Inspect ${label}">
      <span class="factory-pin-light" aria-hidden="true">${index + 1}</span>
      <span class="factory-pin-label">${label}</span>
    </a>`).join('');

  return `<section class="factory-scene" data-active-stage="invoice" aria-label="The software factory">
    <header class="factory-scene-heading">
      <h2>The software factory</h2>
      <p>Explore the model. Inspect the invoice, choose a test and see what the gate catches.</p>
    </header>
    <div class="factory-scene-workbench">
      <div class="factory-scene-art">
        <img class="factory-scene-image" src="assets/factory-studio.webp" width="1672" height="941" loading="lazy" decoding="async" alt="A model assembly line with an invoice desk on the left, a robot test bench in the centre and an inspection gate on the right.">
        <span class="factory-scan-aperture" aria-hidden="true"><span class="factory-scan-beam"></span></span>
        ${pins}
      </div>
      ${renderFactoryReceipts(report)}
    </div>
  </section>`;
}
