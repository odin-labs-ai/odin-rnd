// The two reproduction columns in EXP 021's published table. F1b and control runs are labelled context.
const faults = [
  ['F1', 'Node stopped', 'outage'],
  ['F2a', 'Node isolated', 'outage'],
  ['F3', 'Planned switchover', 'ack_gap'],
];
const source = 'data/failover/results.json';
// Every scenario key the published record carries, each rendered here or labelled context on the study page (F1b, the
// overhead runs, the Patroni floor). A key outside this set is a scenario the figure does not describe: it stops the build
// rather than leave the figure understating the study (review 2bb1b73a item 6).
const KNOWN = new Set(['default', 'tuned'].flatMap(config => ['F1', 'F1b', 'F2a', 'F2b', 'F3'].map(fault => config + '/' + fault))
  .concat(['overhead:default/F1', 'overhead:tuned/F1', 'floor/F1']));

export function failoverFigure(record) {
  if (record.experiment !== 'EXP 021' || !/^\d{4}-\d\d-\d\d$/.test(record.date)) {
    throw new Error('Expected the dated EXP 021 result record');
  }
  // The pattern admits days no calendar has (2026-02-30 would print as 2 Mar 2026): the date must read back unchanged.
  const day = new Date(record.date + 'T00:00:00Z');
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== record.date) throw new Error('EXP 021 date is not a calendar day: ' + record.date);
  for (const key of Object.keys(record.verdict.scenarios)) {
    if (!KNOWN.has(key)) throw new Error('EXP 021 scenario not described by the figure: ' + key);
  }
  for (const config of ['default', 'tuned']) {
    const key = config + '/F2b';
    const cell = record.verdict.scenarios[key];
    if (cell?.labelled_fault !== false || cell.compared_metric !== 'outage' ||
        cell.verdict !== 'postgres-fits' || cell.gates.mongo !== false || cell.gates.pg !== true) {
      throw new Error('EXP 021 comparison changed: ' + key);
    }
  }
  const rows = faults.map(([fault, label, metric]) => ({
    label,
    cells: ['default', 'tuned'].map(config => {
      const key = config + '/' + fault;
      const cell = record.verdict.scenarios[key];
      if (cell?.labelled_fault !== false || cell.compared_metric !== metric) throw new Error('Unexpected compared scenario: ' + key);
      if (cell.verdict === 'mongodb-fits' && cell.gates.mongo && cell.gates.pg && Number.isFinite(cell.repro_median_diff)) {
        if (cell.repro_median_diff < 0) return -cell.repro_median_diff;
        // Same comparison, but the result moved: MongoDB was not faster. The build stops so the "MongoDB faster by"
        // caption is never published over it; the figure and its caption are rewritten to say what the rerun found.
        throw new Error('EXP 021 result moved (MongoDB not faster): ' + key + '; rewrite the figure and caption');
      }
      throw new Error('EXP 021 comparison changed: ' + key);
    }),
  }));
  const longest = Math.max(...rows.flatMap(row => row.cells).filter(Number.isFinite));
  const renderCell = value => '<td><span class="failover-reading">' + value.toFixed(1) + ' s</span><span class="failover-bar" aria-hidden="true" style="width:' + (100 * value / longest).toFixed(1) + '%"></span></td>';
  const body = rows.map(row => '<tr><th scope="row">' + row.label + '</th>' + row.cells.map(renderCell).join('') + '</tr>').join('');
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(day);
  return '<figure class="failover-figure" aria-labelledby="failover-title">' +
    '<figcaption><span class="failover-stamp">EXP 021 · <time datetime="' + record.date + '">' + date + '</time></span>' +
    '<h2 id="failover-title">Database failover</h2></figcaption>' +
    '<p class="failover-key" id="failover-key">Time saved per fault on one host, compared with PostgreSQL.</p>' +
    '<table aria-labelledby="failover-title" aria-describedby="failover-key failover-method"><colgroup></colgroup><colgroup span="2"></colgroup><thead><tr><th scope="col" rowspan="2">Fault</th><th scope="colgroup" colspan="2">MongoDB faster by (s)</th></tr><tr><th scope="col">Default</th><th scope="col">Tuned</th></tr></thead><tbody>' + body + '</tbody></table>' +
    '<p class="failover-method" id="failover-method">Median paired difference in the repeat run. Switchover compares gaps between confirmed writes. The other two faults compare write outages. When peers were disconnected, only PostgreSQL passed the feed check at both settings.</p>' +
    '<div class="failover-links"><a href="journal/failover-results.html">Read the study</a><a href="' + source + '">Result JSON</a></div></figure>';
}
