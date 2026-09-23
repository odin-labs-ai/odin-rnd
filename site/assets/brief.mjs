const fields = [
  ['workflow', 'One workflow'],
  ['outcome', 'Intended outcome'],
  ['baseline', 'Current baseline'],
  ['samples', 'Samples and permission'],
  ['constraints', 'Constraints and review needs'],
];
export function formatBrief(values) {
  const answers = fields.map(([name, label]) => {
    const value = String(values[name] ?? '').replace(/\r\n?/g, '\n').trim();
    if (value.length > 2000) throw new Error(`${label}: use 2,000 characters or fewer.`);
    if (name === 'workflow' && !value) throw new Error('Describe one workflow before preparing a brief.');
    return `${label}\n${value || 'To agree'}`;
  });
  return `ODIN R&D — PROPOSED PILOT BRIEF\n\nDraft for discussion. No pilot, price or outcome is agreed by this brief.\nDo not include confidential inputs or personal data.\n\n${answers.join('\n\n')}\n\nBefore inputs are shared: agree scope, sample permissions, reviewer, evaluation contract and a fixed work/time budget.\nCompare a baseline and held-out evaluation under comparable conditions; include human review, rework, model and infrastructure costs.\nAgree thresholds, exclusions and a continue / change / stop decision.\n\nPrepared locally. Nothing has been submitted. Review before sharing through a separate contact channel.\n`;
}

export function bindBrief(doc = document, browser = window) {
  const form = doc.getElementById('pilot-brief-form');
  if (!form) return;
  const result = doc.getElementById('brief-result');
  const output = doc.getElementById('brief-output');
  const copy = doc.getElementById('copy-brief');
  const download = doc.getElementById('download-brief');
  const status = doc.getElementById('brief-status');
  let url;
  let revision = 0;
  let copying = false;
  const revoke = () => {
    if (url) browser.URL.revokeObjectURL(url);
    url = undefined;
    download.removeAttribute('href');
  };
  const invalidate = () => {
    revision++;
    revoke();
    output.value = '';
    result.hidden = true;
    status.textContent = 'Brief changed. Prepare it again to copy or download the current version.';
  };
  form.addEventListener('input', invalidate);
  form.addEventListener('submit', event => {
    event.preventDefault();
    revoke();
    revision++;
    try {
      output.value = formatBrief(Object.fromEntries(fields.map(([name]) => [name, form.elements.namedItem(name).value])));
      url = browser.URL.createObjectURL(new browser.Blob([output.value], { type: 'text/plain;charset=utf-8' }));
      download.href = url;
      result.hidden = false;
      status.textContent = 'Brief prepared locally. Review it before copying or downloading. Nothing has been submitted.';
    } catch (error) {
      output.value = '';
      result.hidden = true;
      status.textContent = error.message;
    }
  });
  copy.addEventListener('click', async () => {
    if (copying || !output.value || result.hidden) return;
    copying = true;
    copy.disabled = true;
    const capturedRevision = revision;
    try {
      await browser.navigator.clipboard.writeText(output.value);
      if (capturedRevision === revision) status.textContent = 'Brief copied. Nothing has been submitted.';
    } catch {
      if (capturedRevision === revision) {
        output.focus();
        output.select();
        status.textContent = 'Automatic copy was unavailable. The brief is selected; use your device’s Copy command or download it.';
      }
    } finally {
      copying = false;
      copy.disabled = false;
    }
  });
  // Keep downloads usable after returning through the browser back/forward cache.
  browser.addEventListener('pagehide', event => { if (!event.persisted) revoke(); });
  form.hidden = false;
}
if (typeof document !== 'undefined') bindBrief();
