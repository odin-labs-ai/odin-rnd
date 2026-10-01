// Test helper: the text of a rendered page, for assertions about what a reader sees. Each removal is applied
// repeatedly until the string stops changing (CodeQL js/incomplete-multi-character-sanitization: a single pass can
// leave a tag behind when one is nested or overlaps another, as in `<scr<script>ipt>`), and a '<' or '>' left
// over once no complete tag remains is replaced too, so nothing tag-like survives. Tests only: no page is built with it.

/** Applies `re` (global) to `text` until the string stops changing. */
export function untilStable(text, re, replacement) {
  let out = String(text), prev;
  do { prev = out; out = out.replace(re, replacement); } while (out !== prev);
  return out;
}

/** Removes every `<name …>…</name>` block of the named elements (script, style, pre…), to a fixed point. */
export const stripBlocks = (html, names, replacement = ' ') => untilStable(html, new RegExp(`<(${names.join('|')})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), replacement);

/** Removes every tag, to a fixed point, then any '<' or '>' left over (a fragment of a tag; real text is escaped). */
export const stripTags = (html, replacement = ' ') => untilStable(untilStable(html, /<[^>]*>/g, replacement), /[<>]/g, replacement);
