// Counts interactions, never people. No cookies, storage, query strings or retry queue.
export const routes = Object.freeze(['home','test-witness','migration-witness','ci-witness','work-with-us','journal-why-open-the-floor','journal-a-passing-pipeline']);
export const events = Object.freeze(['page_view','experiment_selected','reproduction_copied','contact_opened']);
export function apiOrigin(value) {
  if (value === null || value === undefined) return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid enquiry service configuration');
  return url.origin;
}
export function routeKey(pathname) {
  const path = pathname.replace(/^\/odin-rnd(?=\/|$)/,'').replace(/index\.html$/,'');
  if (path === '/' || path === '') return 'home';
  if (path === '/work-with-us/') return 'work-with-us';
  for (const name of ['test-witness','migration-witness','ci-witness']) if (path === `/projects/${name}/`) return name;
  const journal = /^\/journal\/(a-passing-pipeline|why-open-the-floor)\.html$/.exec(path);
  if (journal) return `journal-${journal[1]}`;
  return null;
}
export async function recordActivity(origin, event, route, fetcher = globalThis.fetch) {
  if (!origin || !events.includes(event) || !routes.includes(route)) return false;
  try {
    const response = await fetcher(`${apiOrigin(origin)}/v1/rd/events`, {
      method:'POST', credentials:'omit', redirect:'error', referrerPolicy:'no-referrer', keepalive:true,
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({event,route}),
      signal:AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch { return false; }
}
export async function readConfig(fetcher = globalThis.fetch) {
  const response = await fetcher(new URL('../data/intake-config.json', import.meta.url), {credentials:'omit', redirect:'error', referrerPolicy:'no-referrer'});
  if (!response.ok) throw new Error('Enquiry service configuration unavailable');
  const config = await response.json();
  if (!config || Object.keys(config).join(',') !== 'apiOrigin') throw new Error('Invalid enquiry service configuration');
  return apiOrigin(config.apiOrigin);
}
export function bindActivity(doc, browser, origin) {
  const route = routeKey(browser.location.pathname);
  const emit = event => recordActivity(origin,event,route,browser.fetch.bind(browser));
  if (!origin || !route) return;
  void emit('page_view');
  doc.addEventListener('click', event => {
    const control = event.target?.closest?.('a,button');
    if (!control) return;
    if (control.hasAttribute('data-station') || control.hasAttribute('data-experiment')) void emit('experiment_selected');
    if (control.matches('[data-contact-opened]')) void emit('contact_opened');
  });
  // Enhanced station links implement Space themselves; native buttons emit click.
  doc.addEventListener('keydown', event => {
    if (event.key === ' ' && !event.repeat && event.target?.matches?.('[data-station][role="button"]')) void emit('experiment_selected');
  });
  doc.addEventListener('change', event => {
    // Deep-link initialization is programmatic, not another visitor interaction.
    if (event.isTrusted !== false && event.target?.id === 'witness-choice') void emit('experiment_selected');
  });
  // Copy code dispatches only after the clipboard succeeds.
  doc.addEventListener('rd-reproduction-copied', () => { void emit('reproduction_copied'); });
}
if (typeof document !== 'undefined') readConfig().then(origin => bindActivity(document,window,origin)).catch(() => {});
