// FIXTURE helpers: synthetic tool calls for EXP 006's classifier tests and for the stream-json fake's rehearsal mode.
// They describe what a reviewer's tools WOULD return in a staged workspace, built from the corpus patch alone (no
// workspace, no model): `git status --short`, `git diff` (the tracked changes), and a Read of each added file. They
// prove the classifier and the record builder, not the client; the live probe pins the real output formats.

/** The raw sections of a unified git patch, one per `diff --git` header, with the file's kind and hunk lines. */
export function patchSections(patch) {
  const out = [];
  let cur = null, inHunk = false;
  for (const line of patch.split('\n')) {
    const head = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
    if (head) { cur = { from: head[1], to: head[2], kind: 'modified', lines: [line], plus: [] }; out.push(cur); inHunk = false; continue; }
    if (!cur) continue;
    cur.lines.push(line);
    if (!inHunk) {
      if (/^new file mode/.test(line)) cur.kind = 'added';
      else if (/^deleted file mode/.test(line)) cur.kind = 'deleted';
      else if (/^rename from /.test(line)) cur.kind = 'renamed';
      if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('+')) cur.plus.push(line.slice(1));
  }
  return out.map(s => ({ ...s, text: s.lines.join('\n').replace(/\n+$/, '') }));
}

/** What the workspace shows after `git apply` (the change uncommitted): short status, git diff, added files' text. */
export function workspaceView(patch) {
  const sections = patchSections(patch);
  const status = sections.flatMap(s => (s.kind === 'added' ? [`?? ${s.to}`] : s.kind === 'deleted' ? [` D ${s.from}`] : s.kind === 'renamed' ? [` D ${s.from}`, `?? ${s.to}`] : [` M ${s.to}`]));
  const diff = sections.filter(s => s.kind !== 'added').map(s => s.text).join('\n');
  const added = Object.fromEntries(sections.filter(s => s.kind === 'added').map(s => [s.to, s.plus]));
  return { status: `${status.join('\n')}\n`, diff: diff ? `${diff}\n` : '', added };
}

/** A Read tool_result's text: every line with its line-number prefix, `N→` (arrow) or `N<TAB>` (tab). */
export const readOutput = (lines, prefix = 'arrow') => lines.map((l, i) => `${String(i + 1).padStart(6)}${prefix === 'tab' ? '\t' : '→'}${l}`).join('\n');

/** Tool calls of a run that SAW the change: status, diff, and a Read of every added file. */
export function seenCalls(patch, { prefix = 'arrow', repo = '<ws>/repo' } = {}) {
  const v = workspaceView(patch);
  return [
    { tool: 'Bash', input: { command: 'git status --short' }, isError: false, output: v.status },
    { tool: 'Bash', input: { command: 'git diff' }, isError: false, output: v.diff },
    ...Object.entries(v.added).map(([path, lines]) => ({ tool: 'Read', input: { file_path: `${repo}/${path}` }, isError: false, output: readOutput(lines, prefix) })),
  ];
}

/** A root commit's `git show` of a set of files: every line as a `+` diff line (what the base commit shows). */
export function rootCommitShow(files, header = 'commit 3e35e4e274932a61bc0d92f378f8d506a9bb4ce0\nAuthor: base <base@example.invalid>\n\n    base\n') {
  return `${header}${Object.entries(files).map(([path, text]) => {
    const lines = text.split('\n');
    return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}`;
  }).join('\n')}\n`;
}

/** Tool calls of a run that only saw the BASE: git show HEAD, git log -p, and a Read of every base file. */
export function baseOnlyCalls(files, { prefix = 'arrow', repo = '<ws>/repo' } = {}) {
  const show = rootCommitShow(files);
  return [
    { tool: 'Bash', input: { command: 'git show HEAD' }, isError: false, output: show },
    { tool: 'Bash', input: { command: 'git log -p' }, isError: false, output: show },
    { tool: 'Bash', input: { command: 'git status --short > "$TMPDIR/st.txt" 2>&1; git diff > "$TMPDIR/d.txt"' }, isError: true, output: 'permission denied' },
    ...Object.entries(files).map(([path, text]) => ({ tool: 'Read', input: { file_path: `${repo}/${path}` }, isError: false, output: readOutput(text.split('\n'), prefix) })),
  ];
}
