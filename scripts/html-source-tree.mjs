// Source-offset HTML tree for the site's header and footer passes. The tag scanner follows the quote/comment/raw-text
// states used by lab-kit.mjs::shownText; parseAttributes is the site's existing first-attribute-wins reader. This
// retains the original bytes for replacement and keeps template contents separate from rendered descendants.
import { parseAttributes } from './number-provenance.mjs';

const WS = new Set([' ', '\t', '\n', '\f', '\r']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const asciiLower = text => text.replace(/[A-Z]/g, char => String.fromCharCode(char.charCodeAt(0) + 32));

/** Parse source HTML into elements, text and source offsets. Comments are omitted; template descendants stay inert. */
export function parse(html) {
  const root = { nodeName: '#document', childNodes: [], parentNode: null };
  const stack = [root];
  const lower = asciiLower(html);
  const text = (from, to) => { if (to > from) stack.at(-1).childNodes.push({ nodeName: '#text', value: html.slice(from, to), parentNode: stack.at(-1) }); };
  let i = 0;
  while (i < html.length) {
    const at = html.indexOf('<', i);
    if (at < 0) { text(i, html.length); break; }
    text(i, at);
    if (html.startsWith('<!--', at)) {
      const end = html.startsWith('<!-->', at) ? at + 5 : html.startsWith('<!--->', at) ? at + 6 : html.indexOf('-->', at + 4) + 3;
      if (end < at + 4) throw new Error('Unclosed HTML comment');
      i = end;
      continue;
    }
    const closing = html[at + 1] === '/';
    const nameAt = at + (closing ? 2 : 1);
    if (!/[A-Za-z]/.test(html[nameAt] ?? '')) {
      if (html[at + 1] === '!' || html[at + 1] === '?') { const end = html.indexOf('>', at + 2); i = end < 0 ? html.length : end + 1; continue; }
      text(at, at + 1); i = at + 1; continue;
    }
    let j = nameAt;
    while (j < html.length && !WS.has(html[j]) && html[j] !== '/' && html[j] !== '>') j++;
    const name = asciiLower(html.slice(nameAt, j));
    const attrsAt = j;
    let quote = '';
    while (j < html.length) {
      const char = html[j];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
      j++;
    }
    if (j >= html.length) throw new Error(`Unclosed HTML tag <${name}>`);
    const end = j + 1;
    if (closing) {
      const found = stack.findLastIndex(node => node.tagName === name);
      if (found > 0) {
        while (stack.length - 1 >= found) {
          const node = stack.pop();
          node.sourceCodeLocation.endOffset = end;
          if (node.tagName === name) node.sourceCodeLocation.endTag = { startOffset: at, endOffset: end };
        }
      }
      i = end;
      continue;
    }
    const attrs = [...parseAttributes(html.slice(attrsAt, j))].map(([key, value]) => ({ name: key, value }));
    const parent = stack.at(-1);
    const node = { nodeName: name, tagName: name, attrs, childNodes: [], parentNode: parent, sourceCodeLocation: { startOffset: at, endOffset: end, startTag: { startOffset: at, endOffset: end } } };
    parent.childNodes.push(node);
    // A trailing slash is part of an unquoted HTML attribute value, not a closing marker.
    // Only void HTML elements close themselves in the browser's HTML parsing mode.
    if (VOID.has(name)) { i = end; continue; }
    if (RAW_TEXT.has(name)) {
      let close = lower.indexOf(`</${name}`, end);
      while (close >= 0 && ![...WS, '/', '>'].includes(html[close + name.length + 2])) close = lower.indexOf(`</${name}`, close + 1);
      if (close < 0) throw new Error(`Unclosed raw HTML tag <${name}>`);
      const closeEnd = html.indexOf('>', close);
      if (closeEnd < 0) throw new Error(`Unclosed raw HTML tag </${name}>`);
      node.sourceCodeLocation.endTag = { startOffset: close, endOffset: closeEnd + 1 };
      node.sourceCodeLocation.endOffset = closeEnd + 1;
      i = closeEnd + 1;
      continue;
    }
    stack.push(node);
    i = end;
  }
  return root;
}
