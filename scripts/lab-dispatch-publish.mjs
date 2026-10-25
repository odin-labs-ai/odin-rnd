// The Lab 01 dispatch publisher (mission rnd-labs-human-first-1024, vision-plan bundle 3 WO-03). It reads one session
// the agent space filmed (`odin-dispatch` v1: manifest.json, clip.webm, poster.png, stills/, proofs/<evidence-id>.json),
// downloaded from its private source, and writes only the public part into this site:
//   site/data/labs/agent-space/dispatches/<session>.json   (odin-lab-dispatch v1, scripts/schemas/odin-lab-dispatch.schema.json)
//   site/assets/labs/agent-space/<session>/                (clip, poster, stills, copied unchanged)
//
//   node scripts/lab-dispatch-publish.mjs --session <dir> --answers-screen <file> [--site <dir>] [--check]
//
// It keeps the questions that were asked, each with its answer, its why, the kind of source and the evidence id the
// clip's card shows. It drops the space's local URL, the source commit, the run ids, who asked, timings and file refs.
// It REFUSES (exit 1, every reason listed) when the manifest does not match the vendored schema, when any text the
// clip or the page shows names a restricted name, a place or an address, a price, an email or a phone number, a local
// address or a file path, or a long internal id, and when the answers' screening is not recorded. It never rewrites a
// text: the clip shows the same card, so a fix belongs at the source. scripts/labs.mjs runs the same screen again over
// every committed dispatch when the site builds.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE_SCHEMA_FILE = join(here, 'schemas/odin-dispatch-v1.schema.json');
export const PUBLIC_SCHEMA_FILE = join(here, 'schemas/odin-lab-dispatch.schema.json');
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Restricted names, as sha256 fingerprints of a lowercased word (or of two adjacent words run together), so the names
// themselves are not written in this public file: the private project behind the space, a game studio, a compute
// partner and the lab's partners and customers. A word is cut at every non-letter-or-digit and at camelCase seams, so
// a label such as "<name>-heightfield-v1" yields the name as a word part.
const RESTRICTED = new Set([
  '40a935d9f7e2714b0e7b03c78302a9ca1833ee3e382647309c67b965e28f5419', '0d660d1fcb539d95918c654104d20674a71df0735f46c71c9d2be943ebc400a5',
  '2843b3bd8f16ba8bc7a154c59d676ad6aee2b316614aec2ed34a0f989da4d0d1', 'c2eb6a89ffcde79e6cdd97362ff7e05da9e03363bee636743b92d4e9545f667e',
  'c1edb8ce971e7a65cdc6f38a66d32312dfd045035bc62114aa21719dc3c81e1d', 'c5cc1117369cbb4359e441043c428421e641e349d861f450c0b107fb5900e44c',
  '47e69e04a2b2e21dd28d451490f53117d183de45a1221f169a60c864f164bce8', 'db8125a5a0a5825896a37524890fe5a4b7608cfc05c1125b0791cc65a61855b4',
  'a3c59678ef2ffc2712fb023a16730f3c2114015ae93f61585ad9ae0e0e13c400',
]);

const words = text => text.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
  .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const PATTERNS = [
  [/[€$£¥]\s?\d|\d\s?(?:[€$£¥¢]|(?:eur|usd|gbp|euros?|dollars?|cents?)(?![\p{L}]))|\b(?:eur|usd|gbp)\s?\d/iu, 'a price or currency amount'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/u, 'an email address'],
  [/\d{9,}|\+\d[\d ().-]{7,}\d|(?:\(\d{2,4}\)|\b\d{2,4})[ .-]\d{3,4}[ .-]\d{3,4}\b/u, 'a phone number, timestamp or long internal id'],
  [/\b\d{4} ?[A-Z]{2}\b/u, 'a postcode'],
  [/\b\d+[a-z]?,? (?:\p{L}+ )+(?:street|road|avenue|lane|boulevard)\b|\p{L}+(?:straat|weg|laan|plein|gracht|kade|dreef|singel)\s+\d+/iu, 'a street address'],
  [/localhost|\b127\.\d|\b\d{1,3}(?:\.\d{1,3}){3}\b|\[::1\]/iu, 'a local or IP address'],
  [/https?:\/\/(?!github\.com\/odin-labs-ai\/odin-rnd\b)/iu, 'a link to somewhere other than this lab'],
  [/(?:^|[\s("'`])(?:\.{0,2}\/)?[\w.-]+\/[\w./-]*\.(?:py|mjs|cjs|js|ts|tsx|json|ya?ml|sh|md|cpp|hpp|h|cs|rs|go|toml)\b|\/Users\/|\/home\/|\b[A-Z]:\\/u, 'a file path'],
];

/** Why one public string may not be published: [{ reason, at }] with the offset of each hit (empty when it may). */
export function screenHits(text) {
  const hits = [];
  const parts = words(text);
  const named = parts.findIndex((word, i) => RESTRICTED.has(sha256(word)) || (i > 0 && RESTRICTED.has(sha256(parts[i - 1] + word))));
  if (named >= 0) hits.push({ reason: 'a restricted name (the private project, a game studio, a partner or a customer)', at: text.toLowerCase().indexOf(parts[named]) });
  for (const [pattern, reason] of PATTERNS) { const match = pattern.exec(text); if (match) hits.push({ reason, at: match.index }); }
  return hits;
}

/** The reasons alone. */
export const screenText = text => screenHits(text).map(hit => hit.reason);

// A window of the text around a hit, so the reason can be checked by eye.
const excerpt = (text, at) => {
  const from = Math.max(0, at - 50), to = Math.min(text.length, at + 70);
  return JSON.stringify(`${from > 0 ? '...' : ''}${text.slice(from, to)}${to < text.length ? '...' : ''}`);
};

/** Screen every string under `value` (skipping `skip` keys); each hit is "<where>#<pointer>: <reason> (<excerpt>)". */
export function screenTree(value, where, skip = new Set(), at = '') {
  if (typeof value === 'string') return screenHits(value).map(hit => `${where}#${at || '/'}: ${hit.reason} (${excerpt(value, hit.at)})`);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => skip.has(key) ? [] : screenTree(child, where, skip, `${at}/${key}`));
}

// Fields of a proof record that never reach the page: when it was recorded, how long it took and which run (the lens).
// Every other string of a proof is screened, because the clip shows the whole card, whether or not the page repeats it.
// A question's asker, issue number and intake screen stay out of the page and are not screened here.
const PROOF_INTERNAL = new Set(['t', 'ms', 'lens']);
const QUESTION_INTERNAL = new Set(['asked_by', 'issue', 'screened']);

/** The answer-screening record this site keeps for a session (odin-answers-screen v1); a list of problems. */
export function answerScreenProblems(screen, session, evidenceIds) {
  if (!screen) return ['answers_screened is false in the manifest and no answer screen is recorded (pass --answers-screen <file>)'];
  const problems = [];
  if (screen.format !== 'odin-answers-screen' || screen.version !== 1) problems.push('the answer screen is not odin-answers-screen v1');
  if (screen.session !== session) problems.push(`the answer screen is for ${JSON.stringify(screen.session)}, not ${JSON.stringify(session)}`);
  if (typeof screen.by !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(screen.by)) problems.push('the answer screen does not say who screened it (a lowercase label)');
  const byId = new Map((Array.isArray(screen.answers) ? screen.answers : []).map(answer => [answer?.evidence, answer]));
  for (const id of evidenceIds) {
    const answer = byId.get(id);
    if (!answer) problems.push(`the answer screen does not cover evidence ${id}`);
    else if (answer.verdict !== 'ok') problems.push(`the answer screen did not pass evidence ${id} (verdict ${JSON.stringify(answer.verdict)})`);
    else if (!Array.isArray(answer.checks) || answer.checks.length === 0) problems.push(`the answer screen lists no checks for evidence ${id}`);
  }
  return problems;
}

const readJson = (file, problems, label) => {
  if (!existsSync(file)) { problems.push(`${label}: missing`); return null; }
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { problems.push(`${label}: not JSON (${error.message})`); return null; }
};

/** Read and screen one session dir. Returns { problems, dispatch, files } where files maps source → site path. */
export function prepare(sessionDir, answerScreen) {
  const problems = [];
  const sourceSchemaRaw = readFileSync(SOURCE_SCHEMA_FILE);
  const manifestRaw = existsSync(join(sessionDir, 'manifest.json')) ? readFileSync(join(sessionDir, 'manifest.json')) : null;
  const manifest = readJson(join(sessionDir, 'manifest.json'), problems, 'manifest.json');
  if (!manifest) return { problems, dispatch: null, files: [] };
  for (const problem of validate(JSON.parse(sourceSchemaRaw), manifest)) problems.push(`manifest.json#${problem} (does not match the vendored odin-dispatch v1 schema)`);
  if (problems.length) return { problems, dispatch: null, files: [] };

  const session = manifest.session;
  if (!/^session-\d{4}-\d{2}-\d{2}(-[a-z0-9]+)*$/.test(session)) problems.push(`manifest.json#/session: ${JSON.stringify(session)} is not a session-<date> name`);
  if (!session.startsWith(`session-${manifest.date}`)) problems.push('manifest.json#/session: the name does not carry the session date');
  const clipFile = join(sessionDir, manifest.clip.file);
  if (!existsSync(clipFile)) problems.push('clip.webm: missing');
  else {
    const bytes = statSync(clipFile).size;
    if (bytes !== manifest.clip.bytes) problems.push(`clip.webm: ${bytes} bytes on disk, the manifest says ${manifest.clip.bytes}`);
    if (bytes > MAX_CLIP_BYTES) problems.push(`clip.webm: ${bytes} bytes, over the ${MAX_CLIP_BYTES}-byte limit`);
  }
  for (const file of [manifest.poster, ...manifest.stills]) if (!existsSync(join(sessionDir, file))) problems.push(`${file}: missing`);

  const proofs = new Map();
  for (const file of manifest.proofs) {
    const proof = readJson(join(sessionDir, file), problems, file);
    if (!proof) continue;
    if (`proofs/${proof.id}.json` !== file) problems.push(`${file}#/id: the record's id does not match its file name`);
    proofs.set(proof.id, proof);
    problems.push(...screenTree(proof, file, PROOF_INTERNAL));
  }

  const asked = manifest.questions.filter(question => question.asked);
  const questions = [];
  manifest.questions.forEach((question, index) => {
    if (!question.asked) return;
    const where = `manifest.json#/questions/${index}`;
    problems.push(...screenTree(question, 'manifest.json', QUESTION_INTERNAL, `/questions/${index}`));
    const proof = proofs.get(question.evidence);
    if (!proof) { problems.push(`${where}/evidence: ${question.evidence} is not one of the session's proofs`); return; }
    const answer = question.follow_up && typeof question.reply === 'string' ? question.reply : proof.answer;
    if (typeof answer !== 'string' || !answer) problems.push(`proofs/${proof.id}.json#/answer: no answer`);
    questions.push({ id: question.id, to: question.to, text: question.text, followUp: question.follow_up, answer: answer ?? '',
      why: typeof proof.why === 'string' ? proof.why : '', source: String(proof.source ?? ''), evidence: proof.id });
  });
  if (asked.length === 0) problems.push('manifest.json#/questions: no question was asked');
  problems.push(...answerScreenProblems(answerScreen, session, [...proofs.keys()]));
  if (answerScreen?.by) problems.push(...screenText(answerScreen.by).map(reason => `answer screen#/by: ${reason}`));

  const base = `assets/labs/agent-space/${session}`;
  const files = [[manifest.clip.file, `${base}/clip.webm`], [manifest.poster, `${base}/poster.png`],
    ...manifest.stills.map(still => [still, `${base}/${still}`])];
  const dispatch = {
    format: 'odin-lab-dispatch', version: 1, lab: 'agent-space', session, date: manifest.date,
    clip: { src: `${base}/clip.webm`, bytes: manifest.clip.bytes, mime: manifest.clip.mime, seconds: manifest.clip.seconds },
    poster: `${base}/poster.png`, stills: manifest.stills.map(still => `${base}/${still}`), questions,
    answersScreen: { by: answerScreen?.by ?? '', checks: [...new Set((answerScreen?.answers ?? []).flatMap(answer => answer.checks ?? []))] },
    source: { schema: 'odin-dispatch-v1', schemaSha256: sha256(sourceSchemaRaw), manifestSha256: sha256(manifestRaw) },
  };
  if (!problems.length) for (const problem of validate(JSON.parse(readFileSync(PUBLIC_SCHEMA_FILE, 'utf8')), dispatch)) problems.push(`dispatch#${problem} (does not match odin-lab-dispatch v1)`);
  return { problems, dispatch, files };
}

/** Publish a prepared session into a site root. Returns the dispatch file it wrote. */
export function publish({ sessionDir, answerScreen, site }) {
  const { problems, dispatch, files } = prepare(sessionDir, answerScreen);
  if (problems.length) return { problems };
  for (const [from, to] of files) { mkdirSync(dirname(join(site, to)), { recursive: true }); copyFileSync(join(sessionDir, from), join(site, to)); }
  const out = join(site, 'data/labs/agent-space/dispatches', `${dispatch.session}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(dispatch, null, 1)}\n`);
  return { problems: [], dispatch, out };
}

function args(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--check') out.check = true;
    else if (['--session', '--answers-screen', '--site'].includes(flag) && argv[i + 1]) out[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (!out.session) throw new Error('--session <dir> is required');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-dispatch-publish.mjs --session <dir> --answers-screen <file> [--site <dir>] [--check]\n${error.message}`);
    process.exit(2);
  }
  const answerScreen = options['answers-screen'] ? JSON.parse(readFileSync(options['answers-screen'], 'utf8')) : null;
  const sessionDir = resolve(options.session);
  const result = options.check ? prepare(sessionDir, answerScreen) : publish({ sessionDir, answerScreen, site: resolve(options.site ?? join(here, '..', 'site')) });
  if (result.problems.length) {
    console.error(`REFUSED ${basename(sessionDir)}: ${result.problems.length} reason${result.problems.length === 1 ? '' : 's'}; nothing was written.`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(options.check ? `OK ${result.dispatch.session}: it may be published (--check, nothing written).` : `PUBLISHED ${result.dispatch.session} -> ${result.out}`);
}
