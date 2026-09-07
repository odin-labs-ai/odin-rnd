const stations = {
  blueprint: ['Start with intent. A versioned blueprint gives a software system explicit architectural boundaries.', 'Explore BCE', 'https://blueprint-conformance.github.io/bce/'],
  workcell: ['Make a change, inspect the result, and revise it. This station represents the agent’s build-and-check loop.', 'Read the agent loop', 'https://github.com/blueprint-conformance/bce/blob/main/docs/agent-loop.md'],
  gate: ['Compare the code with the same authored rule. A useful gate must distinguish a conforming tree from a real violation.', 'Inspect the experiment', '#experiments'],
  record: ['Keep the result with its version, inputs and time. Give the next person something specific to inspect.', 'Read a build note', 'journal/a-passing-pipeline.html'],
};
document.querySelector('#blueprint-toggle')?.addEventListener('click', event => {
  const button = event.currentTarget;
  const blueprint = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(blueprint));
  document.querySelector('.factory-drawing').dataset.view = blueprint ? 'blueprint' : 'floor';
});
document.querySelectorAll('[data-station]').forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.station;
  document.querySelectorAll('[data-station]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  document.querySelectorAll('[data-floor-station]').forEach(group => group.classList.toggle('active', group.dataset.floorStation === id));
  const [description, label, href] = stations[id];
  document.querySelector('#station-description').textContent = description;
  const link = document.querySelector('#station-link');
  link.textContent = label + ' ↗';
  link.href = href;
}));

const reportElement = document.querySelector('#experiment-data');
if (reportElement) {
  const report = JSON.parse(reportElement.textContent);
  const showExperiment = index => {
    const run = report.runs[index];
    document.querySelectorAll('[data-experiment]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    document.querySelector('#run-id').textContent = 'EXP / ' + String(index + 1).padStart(3, '0');
    document.querySelector('#run-title').textContent = run.title;
    document.querySelector('#run-question').textContent = run.question;
    document.querySelector('#run-badge').textContent = run.passed ? 'DISCRIMINATION / PASS' : 'DISCRIMINATION / FAILED';
    document.querySelector('#clean-result').textContent = run.cleanScore === null ? 'UNVERIFIED' : 'GREEN / ' + run.cleanScore;
    document.querySelector('#drift-result').textContent = run.driftScore === null ? 'UNVERIFIED' : 'RED / ' + run.driftScore;
    document.querySelector('#transcript').textContent = run.transcript;
    document.querySelector('#reproduce-command').textContent = 'npm exec --yes --package=bce-engine@0.3.0 -- bce demo --recipe ' + run.id;
    document.querySelector('#run-date').textContent = 'RECORDED ' + new Date(report.completedAt).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
    document.querySelector('#run-origin').textContent = 'Recording environment: ' + report.environment + '.';
    document.querySelector('#copy-status').textContent = '';
  };
  document.querySelectorAll('[data-experiment]').forEach((button, index) => button.addEventListener('click', () => showExperiment(index)));
  document.querySelector('#copy-command').addEventListener('click', async () => {
    const status = document.querySelector('#copy-status');
    try {
      await navigator.clipboard.writeText(document.querySelector('#reproduce-command').textContent);
      status.textContent = 'Command copied.';
    } catch {
      status.textContent = 'Select the command above to copy it manually.';
    }
  });
  showExperiment(0);
}
