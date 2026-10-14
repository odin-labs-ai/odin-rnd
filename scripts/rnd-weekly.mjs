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

export const KINDS = ['Results', 'Erratum', 'Amendment', 'Pre-registered', 'Measured', 'Recorded', 'Tool', 'Field note'];
const kindOf = kind => { if (!KINDS.includes(kind)) throw new Error(`Unknown update kind in the feed: ${JSON.stringify(String(kind).slice(0, 40))}`); return kind; };
const dateOf = date => { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('An update in the feed has no YYYY-MM-DD date'); return date; };
const dayBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
/** True only for a YYYY-MM-DD string naming a day that exists (2026-02-30 does not). */
export const isCalendarDay = day => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
};
export const yesterday = (now = new Date()) => dayBefore(now.toISOString().slice(0, 10), 1);

/** The entries dated in the seven days ending on `end` (inclusive), in feed order. */
export function weekOf(feed, end) {
  if (!isCalendarDay(end)) throw new Error('The week must end on a real calendar day, YYYY-MM-DD');
  const start = dayBefore(end, 6);
  return { start, end, entries: feed.updates.filter(entry => entry.date >= start && entry.date <= end) };
}

// Feed text is shown in Mattermost, which decodes markdown escapes and HTML entities before it looks for mentions. So
// text is never escaped character by character: it goes out as an inline code span, where Mattermost renders no
// markdown, decodes no entity and detects no mention. A backtick inside the text (which would end the span) becomes ',
// and line breaks become spaces.
export const inert = text => `\`${String(text).replace(/\s+/g, ' ').replace(/`/g, "'").trim() || ' '}\``;
// A link target must resolve inside the R&D site (an absolute or protocol-relative URL elsewhere is refused, never
// posted), and it cannot close the markdown link early: parentheses and spaces are percent-encoded.
export function absolute(href) {
  const url = new URL(String(href), SITE);
  if (!url.href.startsWith(SITE) || url.username || url.password) throw new Error('An update in the feed links outside the R&D site');
  return url.href.replace(/[()\s]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

export function formatWeek({ start, end, entries }) {
  const lines = [`#### R&D floor this week (${humanDay(start)} to ${humanDay(end)})`];
  if (!entries.length) lines.push('', 'Nothing new was published on the R&D floor this week.');
  else {
    lines.push('', `${entries.length} new record${entries.length === 1 ? '' : 's'}:`, '');
    for (const entry of entries) {
      const label = entry.experiment ? `${entry.experiment}: ${entry.title}` : entry.title;
      // kind and date are checked against their closed forms; every free-text field goes out as a code span.
      lines.push(`- **${kindOf(entry.kind)}** · ${humanDay(dateOf(entry.date))} · [${inert(label)}](${absolute(entry.href)})  `, `  ${inert(entry.text)}`);
    }
  }
  lines.push('', `[All updates](${SITE}updates/) · [Work with us](${SITE}work-with-us/)`);
  return lines.join('\n');
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  // Not configured at all: skip before reading any input, so an unconfigured repository never fails a run.
  const webhook = process.env.ODIN_MM_RND_WEBHOOK_URL;
  if (!dryRun && !webhook) {
    console.log('R&D weekly summary is not configured (ODIN_MM_RND_WEBHOOK_URL is unset); skipping.');
    return;
  }
  const end = process.env.RND_WEEK_END || yesterday();
  if (!isCalendarDay(end)) throw new Error('RND_WEEK_END must be a real calendar day, YYYY-MM-DD');
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
