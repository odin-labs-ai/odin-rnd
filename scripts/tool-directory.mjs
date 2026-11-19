// Present the existing release and experiment cards after the build has applied its result
// and attribution checks. The long published wording remains available with each tool.
const entries = {
  '001': { purpose: 'Odin’s engine checks code against the architecture rules you write.', notes: 'Release details' },
  '002': { purpose: 'Try ConvAI Innovations’ decision model in your browser after the model downloads.', notes: 'Browser checks and attribution' },
  '003': { purpose: 'Reproduce the blueprint paper’s checks with Odin’s examples and recorded runs.', notes: 'Archive details' },
  '004': { purpose: 'Inspect the study of Jev as a first-pass reviewer for architecture changes.', notes: 'Study scope and results' },
  '000': { purpose: 'Run the experiments in this public repository or propose a new one.', notes: 'Repository details' },
};

export function presentTools(section) {
  return section.replace(/<article\b[^>]*>[\s\S]*?<\/article>/g, row => {
    const number = /class="project-number">(\d{3})</.exec(row)?.[1];
    const entry = entries[number];
    if (!entry) return row;
    const fields = /^(?<title>[\s\S]*?<\/h3>)(?<intro>[\s\S]*?)(?<actions><div class="project-links">[\s\S]*?<\/div>)(?<notes>[\s\S]*?)<\/div>(?<spec><dl class="project-spec">[\s\S]*?<\/dl>)<\/article>$/.exec(row)?.groups;
    if (!fields) throw new Error('Missing title, actions or specifications in tool ' + number);
    // Keep study and usage links beside the title. The field note and
    // cross-references belong with the longer account of what happened.
    const references = [];
    const actions = fields.actions.replace(/<a href="([^"]+)"[^>]*>.*?<\/a>/g, (anchor, href) => {
      if (!/^#station-|^journal\/system-1-decisions-without-lock-in\.html$/.test(href)) return anchor;
      references.push(anchor);
      return '';
    });
    const related = references.length ? '<div class="project-links">' + references.join('') + '</div>' : '';
    return fields.title + '<p class="tool-purpose">' + entry.purpose + '</p>' + actions +
      '<details class="tool-notes"><summary>' + entry.notes + '</summary>' +
      fields.intro + fields.notes + related + fields.spec + '</details></div></article>';
  });
}
