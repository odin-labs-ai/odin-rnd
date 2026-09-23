// Resolve only a recorded observation; malformed or unrelated hashes do nothing.
export function openObservation(hash, document, EventType = Event) {
  let id;
  try { id = decodeURIComponent(hash.replace(/^#/, '')); } catch { return false; }
  if (!id.startsWith('observation-')) return false;
  const observation = id.slice('observation-'.length);
  const select = document.getElementById('witness-choice');
  const details = document.getElementById(id);
  if (!select || select.disabled || ![...select.options].some(option => option.value === observation) || details?.tagName !== 'DETAILS') return false;
  select.value = observation;
  select.dispatchEvent(new EventType('change', {bubbles:true}));
  details.open = true;
  details.scrollIntoView({block:'start', behavior:'instant'});
  return true;
}
