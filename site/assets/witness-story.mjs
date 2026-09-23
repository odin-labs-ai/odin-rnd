// Connect each explanation to its existing recorded observation. No simulated run.
for (const link of document.querySelectorAll('[data-observation]')) {
  link.addEventListener('click', () => {
    const select = document.getElementById('witness-choice');
    if (!select || select.disabled) return;
    const id = link.dataset.observation;
    if (![...select.options].some(option => option.value === id)) return;
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const transcript = document.getElementById('witness-transcript')?.closest('details');
    if (transcript) transcript.open = true;
  });
}
