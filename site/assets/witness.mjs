import { openObservation } from './witness-navigation.mjs';
const byId = id => document.getElementById(id);
const data = byId('witness-data');
const format = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
if (data) {
  const report = JSON.parse(data.textContent);
  byId('witness-choice')?.addEventListener('change', event => {
    const observation = report.observations.find(item => item.id === event.target.value);
    if (!observation) return;
    for (const [id, value] of Object.entries({
      'witness-case': observation.caseId,
      'witness-expected': observation.expected,
      'witness-actual': observation.actual,
      'witness-verdict': observation.verdict.toUpperCase(),
      'witness-reason': observation.reason,
      'witness-transcript': report.commands.filter(command => observation.commandIds.includes(command.id)).map(command => `${command.id}: ${command.executable} ${command.args.join(' ')}\ncwd: ${command.cwd}\n${command.status}; exit ${command.exitCode}; ${command.durationMs} ms\nstdout:\n${command.stdout}\nstderr:\n${command.stderr}`).join('\n\n')
    })) byId(id).textContent = format(value);
  });
  if (byId('witness-choice')) byId('witness-choice').disabled = false;
}
byId('copy-witness-command')?.addEventListener('click', async () => {
  const command = byId('witness-command');
  const status = byId('witness-copy-status');
  try {
    await navigator.clipboard.writeText(command.textContent);
    status.textContent = 'Reproduction command copied. Run it locally from the repository root.';
    document.dispatchEvent(new Event('rd-reproduction-copied'));
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(command);
    selection?.removeAllRanges();
    selection?.addRange(range);
    status.textContent = 'Clipboard access was denied or unavailable. The command is selected; copy it manually.';
  }
});

if (byId('copy-witness-command')) byId('copy-witness-command').disabled = false;

const openLinkedObservation = () => openObservation(window.location.hash, document);
window.addEventListener('hashchange', openLinkedObservation);
openLinkedObservation();
