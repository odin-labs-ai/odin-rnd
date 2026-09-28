import { renderStations, renderStationLinks } from './station-render.mjs';
import { stations } from './station-contract.mjs';
import { validateRecords } from './witness-records.mjs';
import { renderWitness } from './witness-render.mjs';
const witnesses = await validateRecords();
import { readFileSync, writeFileSync, cpSync, copyFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { relative, dirname } from 'node:path';
import { apiOrigin } from '../site/assets/activity.mjs';
import { factoryFloor } from './floor.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateProvenance } from './recording-provenance.mjs';
import { checkRecord, recordPath, sha256 } from './jev-gate-prereg.mjs';
import { assertNoteCurrent, articlePath } from './jev-gate-journal.mjs';
import { checkAmendment, amendmentPath, publishedPath as amendmentPublishedPath } from './jev-gate-amendment.mjs';
import { amendNote, qualifyHome } from './jev-gate-amendment-note.mjs';
import { checkAmendment02, amendment02Path, published02Path } from './jev-gate-amendment-02.mjs';
import { amendNote02, qualifyHome02 } from './jev-gate-amendment-02-note.mjs';
const report = JSON.parse(readFileSync('site/data/experiments.json', 'utf8'));
validateProvenance(report);
if (report.runs.length !== 3 || report.runs.some(run => !run.passed)) throw new Error('All three real experiments must discriminate before publication');
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
// The EXP 005 pre-registration is published byte for byte; the record is validated against the files on disk first.
const preregistration = checkRecord();
assertNoteCurrent();
mkdirSync('site/data/jev-gate', { recursive: true });
copyFileSync(recordPath, 'site/data/jev-gate/preregistration.json');
// Amendment 01 names the parent by sha256 and is published byte for byte beside it.
const amendment = checkAmendment();
copyFileSync(amendmentPath, amendmentPublishedPath);
// Amendment 02 names amendment 01 and the pre-registration by sha256 and is published beside them.
const amendment02 = checkAmendment02();
copyFileSync(amendment02Path, published02Path);
rmSync('dist', { recursive: true, force: true });
cpSync('site', 'dist', { recursive: true });
if (sha256(readFileSync('dist/data/jev-gate/preregistration.json')) !== preregistration.sha256) throw new Error('Published pre-registration differs from '+recordPath);
if (sha256(readFileSync('dist/data/jev-gate/amendment-01.json')) !== amendment.sha256) throw new Error('Published amendment differs from '+amendmentPath);
if (sha256(readFileSync('dist/data/jev-gate/amendment-02.json')) !== amendment02.sha256) throw new Error('Published amendment 02 differs from '+amendment02Path);
// The built note is the parent's committed render plus each amendment's dated section, all from their records.
writeFileSync(`dist/${articlePath.slice('site/'.length)}`, amendNote02(amendNote(readFileSync(articlePath, 'utf8'), amendment.record, amendment.sha256), amendment02.record, amendment02.sha256));
const intakeConfig = JSON.parse(readFileSync('site/data/intake-config.json','utf8'));
if (Object.keys(intakeConfig).join(',') !== 'apiOrigin') throw new Error('Unexpected intake configuration');
apiOrigin(intakeConfig.apiOrigin);
let html = readFileSync('site/index.html', 'utf8');
html = html.replace('<!--FLOOR-->', factoryFloor());
html = html.replace('<!--STATION_CROP-->', factoryFloor({crop:true}));
html = html.replace('<!--STATION_LINKS-->', renderStationLinks());
html = html.replace('<!--STATION_EXHIBITS-->', renderStations(report,witnesses.reports));
html = html.replace('</body>', '<script type="application/json" id="station-data">'+JSON.stringify(stations).replaceAll('<','\\u003c')+'</script>\n</body>');
html = html.replace('<!--EXPERIMENT_BUTTONS-->', report.runs.map((run,index) => '<button class="experiment-choice" data-experiment="'+index+'" aria-pressed="'+(index===0)+'"><span>EXP / '+String(index+1).padStart(3,'0')+'</span>'+escape(run.title)+'</button>').join(''));
html = html.replace('<!--FIRST_TRANSCRIPT-->', escape(report.runs[0].transcript));
html = html.replace('<!--RUN_DATE-->', 'RECORDED '+escape(report.completedAt));
html = html.replace('<!--RUN_ORIGIN-->', 'Recording environment: '+escape(report.environment)+'.');
html = html.replace('<strong id="clean-result">—</strong>', '<strong id="clean-result">GREEN / '+report.runs[0].cleanScore+'</strong>');
html = html.replace('<strong id="drift-result">—</strong>', '<strong id="drift-result">RED / '+report.runs[0].driftScore+'</strong>');
html = html.replace('</body>', '<script type="application/json" id="experiment-data">'+JSON.stringify(report).replaceAll('<','\\u003c')+'</script>\n</body>');
// The parent's featured card says it was published before any gate runs; amendments 01 and 02 qualify it in place.
html = qualifyHome02(qualifyHome(html, amendment.record), amendment02.record);
if (/<!--[A-Z_]+-->/.test(html)) throw new Error('Unresolved content marker');
writeFileSync('dist/index.html', html);
mkdirSync('dist/data', { recursive: true });
const packageInfo = JSON.parse(readFileSync('package.json', 'utf8'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const workingTreeDirty = execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).length > 0;
const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {encoding:'utf8'}).split('\0').filter(file => file && /^(site\/|scripts\/|demos\/|package\.json$|pnpm-lock\.yaml$|\.github\/workflows\/publish\.yml$)/.test(file));
const sourceFilesSha256 = Object.fromEntries([...new Set(sourceFiles)].sort().map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
writeFileSync('dist/data/site.json', JSON.stringify({ name:'Odin R&D', version:packageInfo.version, builtAt:new Date().toISOString(), source:'https://github.com/odin-labs-ai/odin-rnd', revision, workingTreeDirty, sourceFilesSha256, revisionMeaning:'Base checkout revision; sourceFilesSha256 identifies actual build inputs including local changes.', engine:report.engine, experimentRecordedAt:report.completedAt, experimentRun:report.workflowRun, witnessRun:witnesses.manifest.workflowRun, witnessRecordedAt:witnesses.manifest.completedAt, drawing:'Conceptual software-factory assembly; not a map of deployed infrastructure.' }, null, 2)+'\n');
writeFileSync('dist/.nojekyll','');
console.log('Built static GitHub Pages site with three recorded experiments.');

for (const report of witnesses.reports) { const file = `projects/${report.project}/index.html`; writeFileSync(`dist/${file}`, renderWitness(readFileSync(`site/${file}`, 'utf8'), report)); }
const htmlFiles = directory => readdirSync(directory,{withFileTypes:true}).flatMap(entry => entry.isDirectory() ? htmlFiles(`${directory}/${entry.name}`) : entry.name.endsWith('.html') ? [`${directory}/${entry.name}`] : []);
for (const file of htmlFiles('dist')) {
  const modulePath = relative(dirname(file),'dist/assets/activity.mjs');
  const source = readFileSync(file,'utf8');
  writeFileSync(file,source.replace('</head>',`<script type="module" src="${modulePath}"></script>\n</head>`));
}
