// R&D site page-view beacon, served from this site (no other origin's code runs here). Copied from
// odin-website-preview public/rnd-beacon.js (#50). Sends this page's path and the referring
// site's host name to odin-labs.ai/api/rnd-hit/, which counts it as a cookieless Vercel Web Analytics event. No cookie,
// no storage, no identifier. Skipped when the browser signals Global Privacy Control or Do Not Track.
(() => {
  try {
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
    const path = location.pathname;
    if (location.origin !== 'https://odin-labs-ai.github.io' || !path.startsWith('/odin-rnd/')) return;
    let ref = '';
    try { const url = new URL(document.referrer); if (url.origin !== location.origin) ref = url.hostname; } catch { /* no referrer */ }
    const body = JSON.stringify({ path: path.slice(0, 160), ref });
    const url = 'https://odin-labs.ai/api/rnd-hit/';
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
    fetch(url, { method: 'POST', body, keepalive: true, mode: 'no-cors', credentials: 'omit' }).catch(() => {});
  } catch { /* never break the page */ }
})();
