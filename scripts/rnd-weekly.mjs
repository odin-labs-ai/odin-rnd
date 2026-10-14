// "R&D floor this week": a weekly Mattermost post listing what the updates feed gained in the seven days before the
// run, read from the committed site/data/updates.json (the same file the site publishes). Run by
// .github/workflows/rnd-weekly.yml through an incoming webhook.
//
//   node scripts/rnd-weekly.mjs              post the summary (needs ODIN_MM_RND_WEBHOOK_URL)
//   node scripts/rnd-weekly.mjs --dry-run    print it instead
//   RND_WEEK_END=YYYY-MM-DD                  the last day of the week to report (default: yesterday, UTC)
//
// Not configured at all (no webhook): the run skips with a clear line instead of failing the schedule.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SITE = 'https://odin-labs-ai.github.io/odin-rnd/';
// Self-contained on purpose: the workflow checks out scripts/ without installing dependencies.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const humanDay = day => { const [y, m, d] = day.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };

const dayBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
export const yesterday = (now = new Date()) => dayBefore(now.toISOString().slice(0, 10), 1);

/** The entries dated in the seven days ending on `end` (inclusive), in feed order. */
export function weekOf(feed, end) {
  const start = dayBefore(end, 6);
  return { start, end, entries: feed.updates.filter(entry => entry.date >= start && entry.date <= end) };
}

// Feed text is ours, but it is shown in Mattermost markdown: keep it inert. Line breaks become spaces (no new block can
// start), and the backslash is escaped with every other markdown character, so an escape in the text cannot re-arm one.
export const inert = text => String(text).replace(/\s+/g, ' ').replace(/[\\@*_`[\]()<>#|~!.+-]/g, char => `\\${char}`);
// A link target cannot close the markdown link early: parentheses and spaces are percent-encoded.
const absolute = href => new URL(href, SITE).href.replace(/[()\s]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

export function formatWeek({ start, end, entries }) {
  const lines = [`#### R&D floor this week (${humanDay(start)} to ${humanDay(end)})`];
  if (!entries.length) lines.push('', 'Nothing new was published on the R&D floor this week.');
  else {
    lines.push('', `${entries.length} new record${entries.length === 1 ? '' : 's'}:`, '');
    for (const entry of entries) {
      const label = entry.experiment ? `${entry.experiment}: ${entry.title}` : entry.title;
      lines.push(`- **${entry.kind}** · ${humanDay(entry.date)} · [${inert(label)}](${absolute(entry.href)})  `, `  ${inert(entry.text)}`);
    }
  }
  lines.push('', `[All updates](${SITE}updates/) · [Work with us](${SITE}work-with-us/)`);
  return lines.join('\n');
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const end = process.env.RND_WEEK_END || yesterday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('RND_WEEK_END must be YYYY-MM-DD');
  const webhook = process.env.ODIN_MM_RND_WEBHOOK_URL;
  if (!dryRun && !webhook) {
    console.log('R&D weekly summary is not configured (ODIN_MM_RND_WEBHOOK_URL is unset); skipping.');
    return;
  }
  const feed = JSON.parse(readFileSync('site/data/updates.json', 'utf8'));
  const text = formatWeek(weekOf(feed, end));
  if (dryRun) { console.log(text); return; }
  let response;
  // A fetch or URL-parse error can quote the webhook URL, whole or in part; never let one reach the log.
  try { response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error('Could not reach the Mattermost webhook (error details withheld: they can contain the webhook URL).'); }
  if (!response.ok) throw new Error(`Mattermost webhook answered HTTP ${response.status}`);
  console.log(`Posted the R&D summary for the week ending ${end} (${text.length} characters).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    // A malformed webhook secret can surface inside a fetch error message; never print a URL.
    const secret = process.env.ODIN_MM_RND_WEBHOOK_URL;
    let message = String(error?.message ?? error);
    if (secret) message = message.split(secret).join('[webhook]');
    console.error(/https?:|hooks\//i.test(message) ? 'R&D weekly summary failed (details withheld: they can contain the webhook URL).' : message);
    process.exitCode = 1;
  });
}
