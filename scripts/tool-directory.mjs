import { escapeHtml } from './site-chrome.mjs';
import { toolGuide, toolHref } from './tool-guide.mjs';

const noteLabels = {
  '001': 'Release and evidence',
  '002': 'Browser checks and attribution',
  '003': 'Archive details',
  '004': 'Study scope and results',
  '000': 'Repository details',
};

export function renderToolHeading(key, level = 3) {
  return `<h${level}>${escapeHtml(toolGuide[key].title)}</h${level}>`;
}

export function renderToolGuideBody(key, up = '') {
  const tool = toolGuide[key];
  const start = escapeHtml(toolHref(tool.startHref, up));
  const source = escapeHtml(toolHref(tool.sourceHref, up));
  const links = `<a class="tool-start" href="${start}">${escapeHtml(tool.startLabel)} <span aria-hidden="true">→</span></a>` +
    (source === start ? '' : `<a class="tool-source" href="${source}">${escapeHtml(tool.sourceLabel)}</a>`);
  return `<div class="tool-guide-body"><p class="tool-definition">${escapeHtml(tool.what)}</p><p class="tool-use">${escapeHtml(tool.use)}</p><div class="project-links">${links}</div></div>`;
}

// The result and attribution gates write the original rows before this presentation pass.
// Keep their complete evidence and any historical link that the first-step links do not cover.
function homeTool(key, row) {
  const tool = toolGuide[key];
  let notes = '';
  let article = '<article class="project-row">';
  if (row) {
    article = row.slice(0, row.indexOf('>') + 1);
    const fields = /<h3>(?<title>[\s\S]*?)<\/h3>(?<intro>[\s\S]*?)(?<actions><div class="project-links">[\s\S]*?<\/div>)(?<tail>[\s\S]*)<\/article>$/.exec(row)?.groups;
    if (!fields) throw new Error('Missing title or actions in tool ' + key);
    const used = new Set([tool.startHref, tool.sourceHref]);
    const references = [];
    for (const [anchor, href] of (fields.title + fields.actions).matchAll(/<a href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g)) {
      if (!used.has(href)) references.push(anchor);
      used.add(href);
    }
    const related = references.length ? '<div class="project-links">' + references.join('') + '</div>' : '';
    if (key === '005') {
      const gatedNotes = /^(<details class="tool-notes"><summary>[^<]+<\/summary>)([\s\S]*<\/details>)<\/div>$/.exec(fields.tail);
      if (!gatedNotes) throw new Error('Missing gated nina evidence');
      notes = gatedNotes[1] + related + gatedNotes[2];
    } else {
      const spec = /^([\s\S]*)<\/div>(<dl class="project-spec">[\s\S]*<\/dl>)$/.exec(fields.tail);
      if (!spec) throw new Error('Missing tool evidence in ' + key);
      notes = `<details class="tool-notes"><summary>${noteLabels[key]}</summary>${fields.intro}${related}${spec[1]}${spec[2]}</details>`;
    }
  }
  return article.replace(/>$/, ` data-tool="${key}">`) + `<div class="project-description">${renderToolHeading(key)}${renderToolGuideBody(key)}${notes}</div></article>`;
}

export function presentTools(section) {
  const articles = [...section.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)];
  const number = row => /class="project-number">(\d{3})</.exec(row)?.[1];
  if (!articles.some(([row]) => number(row))) return section;
  const rows = new Map();
  for (const [row] of articles) {
    const key = number(row);
    if (!toolGuide[key] || rows.has(key)) throw new Error('Unrecognized or duplicate home tool ' + key);
    rows.set(key, row);
  }
  const groups = new Map();
  for (const [key, tool] of Object.entries(toolGuide)) {
    if (key === '005' && !rows.has(key)) continue;
    if (key in noteLabels && !rows.has(key)) throw new Error('Missing home tool ' + key);
    if (!groups.has(tool.group)) groups.set(tool.group, []);
    groups.get(tool.group).push(homeTool(key, rows.get(key)));
  }
  const content = [...groups].map(([group, cards]) =>
    `<div class="tool-guide-group" role="group" aria-label="${escapeHtml(group)}"><p class="tool-group-label">${escapeHtml(group)}</p><div class="tool-guide-grid">${cards.join('\n')}</div></div>`
  ).join('\n');
  const last = articles.at(-1);
  return section.slice(0, articles[0].index) + content + section.slice(last.index + last[0].length);
}
