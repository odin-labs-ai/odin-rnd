// "How it works" diagrams for lab pages (mission rnd-lab-pages-1113): every lab page opens, as /labs/agent-space/
// does, with what the lab is in plain words and a picture of how it runs. The picture is HTML, not an image or an
// SVG: its words stay real text (read aloud, found by search, wrapped on a phone), and it reflows from lanes side by
// side to lanes stacked. Styles: assets/labs.css (.lab-flow*), which every lab page already loads.
//
// A diagram is drawn only from what the caller passes, and the caller passes values from the lab's own record: this
// module types no fact, no number and no name of its own. Every string is escaped; nothing passed is ever markup.
import { escape } from './lab-kit.mjs';

const TONES = new Set(['neutral', 'bad', 'good']);

function node({ title, body = '', tone = 'neutral' }) {
  if (!title) throw new Error('lab-flow: a box needs a title');
  if (!TONES.has(tone)) throw new Error(`lab-flow: no tone ${tone}`);
  return `<li class="lab-flow-node lab-flow-${tone}"><strong>${escape(title)}</strong>${body ? `<span>${escape(body)}</span>` : ''}</li>`;
}

/**
 * The diagram: a caption, a row of source boxes (what goes in), then one lane per run, each a row of boxes read left
 * to right (stacked on a narrow screen), the last box being what came out.
 *   renderFlow({ caption, source: [{title, body}], lanes: [{label, tone, nodes: [{title, body, tone}]}] })
 */
export function renderFlow({ caption, source = [], lanes = [] }) {
  if (!caption) throw new Error('lab-flow: a diagram needs a caption');
  if (!lanes.length) throw new Error('lab-flow: a diagram needs at least one lane');
  const src = source.length ? `<ol class="lab-flow-row lab-flow-source" aria-label="What goes in">${source.map(node).join('')}</ol>` : '';
  const rows = lanes.map(lane => {
    if (!lane.label || !lane.nodes?.length) throw new Error('lab-flow: a lane needs a label and boxes');
    const tone = lane.tone ?? 'neutral';
    if (!TONES.has(tone)) throw new Error(`lab-flow: no tone ${tone}`);
    return `<div class="lab-flow-lane lab-flow-lane-${tone}"><p class="lab-flow-label">${escape(lane.label)}</p><ol class="lab-flow-row">${lane.nodes.map(node).join('')}</ol></div>`;
  }).join('');
  return `<figure class="lab-flow"><figcaption class="technical">${escape(caption)}</figcaption>${src}<div class="lab-flow-lanes">${rows}</div></figure>`;
}
