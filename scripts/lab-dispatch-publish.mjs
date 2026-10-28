// The Lab 01 dispatch publisher (mission rnd-labs-human-first-1024, vision-plan bundle 3 WO-03). It reads one session
// the agent space filmed (`odin-dispatch` v1: manifest.json, clip.webm, poster.png, stills/, proofs/<evidence-id>.json),
// downloaded from its private source, and writes only the public part into this site:
//   site/data/labs/agent-space/dispatches/<session>.json   (odin-lab-dispatch v1, scripts/schemas/odin-lab-dispatch.schema.json)
//   site/assets/labs/agent-space/<session>/                (clip, poster, stills, copied unchanged)
//
//   node scripts/lab-dispatch-publish.mjs --session <dir> --answers-screen <file> [--site <dir>] [--check]
//   node scripts/lab-dispatch-publish.mjs --fingerprint "<term>"     (prints the hash to add to lab-screen-terms.json)
//
// It keeps the questions that were asked, each with its answer, its why, the kind of source and the evidence id the
// clip's card shows. It drops the space's local URL, the source commit, the run ids, who asked, timings and file refs.
// It REFUSES (exit 1, every reason listed, nothing written) when the manifest does not match the vendored schema, when
// the answers' human screen is not recorded for every proof, or when any text the clip's cards or the page show, or
// any string of the dispatch it would write (session name, file names, screen labels), contains what is listed below.
// Every field of every proof and question it reads is walked, known or not; the few that are never published (when and
// how long, the run, the asker, the intake screen) must have their expected shape and carry no restricted name or place.
// The text screen refuses:
//   - a restricted name or a listed place (scripts/lab-screen-terms.json, hashed): matched after Unicode NFKC, with
//     format and combining characters removed and common Cyrillic/Greek look-alikes folded, on single words, on runs of
//     up to six adjacent words written together ("x y z", "x.y.z") and, for terms of seven letters or more, anywhere
//     in the letters of the text;
//   - a price or currency amount, an email address, a phone number or long number, a postcode or street address, a
//     local or IP address, a link anywhere but exactly github.com under this lab's repository, or a file path or file name with a code or config extension.
// What it does NOT catch: a place or name missing from the term list, a name spelled with digits or deliberately
// misspelled, and anything burned into the clip, poster or stills (it cannot read pixels). Those rest on the human
// answer screen, which is mandatory. scripts/labs.mjs runs the same checks (dispatchProblems) over every committed
// dispatch when the site builds, so a hand-written dispatch fails the build the same way. It never rewrites a text:
// the clip shows the same card, so a fix belongs at the source.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE_SCHEMA_FILE = join(here, 'schemas/odin-dispatch-v1.schema.json');
export const PUBLIC_SCHEMA_FILE = join(here, 'schemas/odin-lab-dispatch.schema.json');
export const TERMS_FILE = join(here, 'lab-screen-terms.json');
export const MAX_CLIP_BYTES = 3 * 1024 * 1024;
const sha256 = data => createHash('sha256').update(data).digest('hex');

const terms = JSON.parse(readFileSync(TERMS_FILE, 'utf8'));
const NAMES = new Set(terms.names), PLACES = new Set(terms.places);
const LONG_TERM = 7;

// Look-alike letters from other scripts that NFKC leaves alone, folded to the Latin letter they imitate.
const CONFUSABLE = { 'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't',
  'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ӏ': 'l', 'α': 'a', 'β': 'b', 'ε': 'e',
  'η': 'n', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ı': 'i', 'ℓ': 'l' };

/** The text a reader sees, in plain lowercase Latin: NFKC, no format or combining characters, look-alikes folded. */
export const normalise = text => fold(text).toLowerCase();

// The same, keeping case (a postcode is digits and capitals). Hangul fillers and U+034F are invisible but not \p{Cf}.
// Exported for the lab kit's page screen (scripts/lab-kit.mjs).
export function fold(text) {
  return text.normalize('NFKD').replace(/[\p{Cf}\p{M}\u034f\u115f\u1160\u3164\uffa0]/gu, '').normalize('NFKC')
    .replace(/./gsu, ch => { const lower = ch.toLowerCase(), latin = CONFUSABLE[lower]; return !latin ? ch : ch === lower ? latin : latin.toUpperCase(); });
}

/** The hash a term is listed under: its letters only, normalised. */
export const fingerprint = term => sha256(normalise(term).replace(/[^\p{L}]/gu, ''));
/**
 * Add names to the screen, never remove one: the tests plant a random made-up name registered this way instead of
 * spelling a real restricted name in this public repository (the site's leak gate refuses the real ones in source).
 */
export function addScreenNames(...names) {
  // Test-scoped: only under `node --test`, never in a site build (the publish workflow's verify job sets ODIN_SITE_BUILD).
  // A test file is a *.test.mjs the runner started (it sets NODE_TEST_CONTEXT); an inline script or a build is refused.
  // The variables can be set by hand, so this is a guard against accidents, not a security boundary; the boundary is
  // that the hook can only ADD names (a call can never weaken a screen) and that only test code may call it (a test
  // in leak-gate.test.mjs refuses any other caller in the tracked tree).
  const testFile = /\.test\.mjs$/.test(process.argv[1] ?? '');
  if (!process.env.NODE_TEST_CONTEXT || !testFile || process.env.ODIN_SITE_BUILD) throw new Error('addScreenNames is for the tests only (node --test), never a build');
  for (const name of names) NAMES.add(fingerprint(name));
}
/**
 * True when the text names a restricted name (any listed or added one), by the same screen. With anyWindow, every run
 * of 3 or more letters inside a word is looked up too, as an unbounded substring check would ("…xyz…" inside a token).
 */
export function namesRestricted(text, { anyWindow = false } = {}) {
  if (termHits(text).some(hit => hit.kind === 'names')) return true;
  if (!anyWindow) return false;
  const run = [...normalise(text).matchAll(/\p{L}/gu)].map(m => m[0]).join('');
  for (let length = 3; length < LONG_TERM; length++) for (let i = 0; i + length <= run.length; i++) if (NAMES.has(sha256(run.slice(i, i + length)))) return true;
  return false;
}

/** Which listed term set the text hits ('names', 'places'), with the offset in the normalised text. */
function termHits(text) {
  // Words are cut at every non-letter-or-digit and at camelCase seams ("XYZEngine" -> "xyz", "engine").
  const tokens = [...fold(text).matchAll(/\p{Lu}?\p{Ll}+|\p{Lu}+(?!\p{Ll})|\p{N}+|\p{L}+/gu)].map(m => ({ word: m[0].toLowerCase(), at: m.index }));
  const plain = normalise(text);
  const hits = [];
  const seen = new Set();
  const hit = (set, kind, value, at) => { if (!seen.has(kind) && set.has(sha256(value))) { seen.add(kind); hits.push({ kind, at }); } };
  for (let i = 0; i < tokens.length; i++) {
    let joined = '';
    for (let j = i; j < Math.min(tokens.length, i + 6); j++) {
      joined += tokens[j].word;
      hit(NAMES, 'names', joined, tokens[i].at);
      hit(PLACES, 'places', joined, tokens[i].at);
    }
  }
  const letters = [...plain.matchAll(/\p{L}/gu)];
  const run = letters.map(m => m[0]).join('');
  for (let length = LONG_TERM; length <= 16; length++) {
    for (let i = 0; i + length <= run.length; i++) {
      const window = run.slice(i, i + length);
      hit(NAMES, 'names', window, letters[i].index);
      hit(PLACES, 'places', window, letters[i].index);
    }
  }
  return hits;
}

const SHORT_WORDS = ['am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we'];
const PATTERNS = [
  [/[€$£¥]\s?\d|\d\s?(?:[€$£¥¢]|(?:eur|usd|gbp|euros?|dollars?|cents?)(?![\p{L}]))|\b(?:eur|usd|gbp)\s?\d/iu, 'a price or currency amount'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/u, 'an email address'],
  [/\d{9,}|\+\d[\d ().-]{7,}\d|(?:\(\d{2,4}\)|\b\d{2,4})[ .-]\d{3,4}[ .-]\d{3,4}\b/u, 'a phone number, timestamp or long internal id'],
  // A Dutch postcode in any case (1234 AB, 1234ab, 1234 Ab); in lower or mixed case not when the two letters are a
  // common short word ("in 2026 we"), which an upper-case postcode never needs.
  [new RegExp(`\\b\\d{4} ?[A-Z]{2}\\b|\\b\\d{4} ?(?!(?:${SHORT_WORDS.map(w => [...w].map(c => `[${c}${c.toUpperCase()}]`).join('')).join('|')})\\b)[A-Za-z]{2}\\b`, 'u'), 'a postcode'],
  [/\b\d+[a-z]?,? (?:\p{L}+ )+(?:street|road|avenue|lane|boulevard)\b|\p{L}+(?:straat|weg|laan|plein|gracht|kade|dreef|singel)\s+\d+/iu, 'a street address'],
  [/localhost|\b127\.\d|\b\d{1,3}(?:\.\d{1,3}){3}\b|\[::1\]/iu, 'a local or IP address'],
  [/\/users\/|\/home\/|\b[a-z]:\\|[\w.-]+\/[\w./-]*\.[a-z0-9]{1,5}\b|\b[\w-]+\.(?:py|mjs|cjs|js|jsx|ts|tsx|json|jsonl|ya?ml|sh|bash|toml|ini|cfg|conf|env|lock|md|txt|csv|sql|db|sqlite|log|cpp|hpp|cc|c|h|cs|rs|go|java|kt|rb|php|lua|gd|uasset|umap)\b/iu, 'a file path or file name'],
];

// The lab's own repository, the only place a public text may link to.
const LAB_REPO = '/odin-labs-ai/odin-rnd';

/** The URL, parsed: null when it is not one. Its path is percent-decoded, so an escaped dot or slash is seen. */
function parseUrl(url) {
  try { const u = new URL(url); return { protocol: u.protocol, host: u.hostname, port: u.port, user: u.username || u.password, path: decodeURIComponent(u.pathname), rest: decodeURIComponent(`${u.search} ${u.hash}`) }; }
  catch { return null; }
}

/** A link into this lab's repository: https, exactly github.com, the repository's path or a path under it (decoded, no dot segments). */
export function isLabLink(url) {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && u.host === 'github.com' && !u.port && !u.user && !/(^|\/)\.{1,2}(\/|$)|\\/.test(u.path)
    && (u.path === LAB_REPO || u.path.startsWith(`${LAB_REPO}/`));
}

/** Why one public string may not be published: [{ reason, at }] (empty when it may). */
export function screenHits(text) {
  const hits = termHits(text).map(({ kind, at }) => ({ at, reason: kind === 'names'
    ? 'a restricted name (the private project, a game studio, a partner or a customer)' : 'a place name' }));
  const rest = fold(text);
  for (const [pattern, reason] of PATTERNS) { const match = pattern.exec(rest); if (match) hits.push({ reason, at: match.index }); }
  const away = [...rest.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()]+/giu)].find(m => !isLabLink(m[0].replace(/[.,;:!?]+$/, '')));
  if (away) hits.push({ reason: 'a link to somewhere other than this lab', at: away.index });
  return hits;
}

/** The reasons alone. */
export const screenText = text => screenHits(text).map(hit => hit.reason);

/**
 * A URL the page links to: https, its host exactly one of `hosts` (on github.com only this lab's repository), and its
 * host, path and query pass the screen. `templates` lets the query name a form template file.
 */
export function urlProblems(url, hosts, { templates = false } = {}) {
  if (typeof url !== 'string' || !/^https:\/\/[^\s"<>]+$/.test(url)) return ['not an https URL'];
  const u = parseUrl(url);
  if (!u) return ['not a URL'];
  const problems = [];
  if (!hosts.includes(u.host) || u.port || u.user) problems.push(`not on an allowed host (${hosts.join(', ')})`);
  else if (u.host === 'github.com' && !isLabLink(url)) problems.push('a GitHub link outside this lab\'s repository');
  problems.push(...screenText(`${u.host} ${u.path.replaceAll('/', ' ')}`));
  const query = screenText(u.rest.replace(/[?&=#]/g, ' '));
  problems.push(...(templates ? query.filter(reason => !reason.startsWith('a file path')) : query));
  return problems;
}

// A window of the text around a hit, so the reason can be checked by eye.
const excerpt = (text, at) => {
  const from = Math.max(0, at - 50), to = Math.min(text.length, at + 70);
  return JSON.stringify(`${from > 0 ? '...' : ''}${text.slice(from, to)}${to < text.length ? '...' : ''}`);
};

/**
 * Screen every field under `value`; each hit is "<where>#<pointer>: <reason> (<excerpt>)". Nothing is skipped: a key
 * named in `internal` (top level only) is a field the public dispatch never carries, and instead of the page-text screen
 * it must have its expected shape and still carry no restricted name or place. Every other field, known or not, is
 * screened as page text.
 */
export function screenTree(value, where, internal = {}, at = '') {
  if (typeof value === 'string') return screenHits(value).map(hit => `${where}#${at || '/'}: ${hit.reason} (${excerpt(normalise(value), hit.at)})`);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => key in internal
    ? internalProblems(child, internal[key], where, `${at}/${key}`)
    : screenTree(child, where, {}, `${at}/${key}`));
}

function internalProblems(value, shape, where, at) {
  if (!shape(value)) return [`${where}#${at}: not the expected shape for a field that is not published`];
  const strings = [];
  (function walk(v, p) { if (typeof v === 'string') strings.push([v, p]); else if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) walk(c, `${p}/${k}`); })(value, at);
  return strings.flatMap(([text, p]) => screenHits(text).filter(hit => /^a (restricted|place) name/.test(hit.reason))
    .map(hit => `${where}#${p}: ${hit.reason} (${excerpt(normalise(text), hit.at)})`));
}

const isNumber = v => typeof v === 'number' && Number.isFinite(v);
const exactKeys = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
// Fields of a proof record that never reach the page: when it was recorded (t), how long it took (ms) and which run
// (lens). The public dispatch is built from a fixed list of fields, so these cannot reach it, and its schema refuses
// them by name. They must still look like what they are, and hold no restricted name or place.
const PROOF_INTERNAL = {
  t: isNumber, ms: v => Number.isInteger(v) && v >= 0,
  lens: v => exactKeys(v, ['run', 'seq']) && typeof v.run === 'string' && /^[a-z0-9-]{1,64}$/.test(v.run) && (v.seq === undefined || Number.isInteger(v.seq)),
};
// A question's asker, issue number and intake screen stay out of the page, under the same rule.
const QUESTION_INTERNAL = {
  asked_by: v => typeof v === 'string' && /^[a-z0-9-]+:@?[\w.-]{1,39}$/i.test(v), issue: v => Number.isInteger(v) && v > 0,
  screened: v => exactKeys(v, ['ok', 'by', 'note', 'checks']),
};

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

/**
 * Why one published asset path may not ship: it carries a restricted name or place (being a path, it is not refused as
 * a path), it is not under `under`, or, with `root`, it is missing there or its bytes do not hash to `sha`. The
 * dispatches and the lab's films (scripts/lab-films.mjs) pin their bytes through this one check.
 */
export function pinnedAssetProblems(path, at, { under, underLabel = under, root = null, sha }) {
  const problems = screenHits(path).filter(hit => !hit.reason.startsWith('a file path')).map(hit => `${at}: ${hit.reason} (${excerpt(normalise(path), hit.at)})`);
  if (!path.startsWith(under)) problems.push(`${at}: not under ${underLabel}`);
  if (root && !existsSync(join(root, path))) problems.push(`${at}: ${path} is missing`);
  else if (root && sha256(readFileSync(join(root, path))) !== sha) problems.push(`${at}: ${path} does not match its recorded sha256`);
  return problems;
}

/**
 * Everything that makes a public dispatch unpublishable, for the publisher (before it writes) and the build (for every
 * committed dispatch): the public schema, the screen over every string it carries (asset paths are screened for names
 * and places; being paths, they are not refused as paths), a passing human screen for every evidence id it shows, and
 * asset paths under its own session. With `root`, every asset must exist there.
 */
export function dispatchProblems(dispatch, where, root = null) {
  const problems = validate(JSON.parse(readFileSync(PUBLIC_SCHEMA_FILE, 'utf8')), dispatch).map(problem => `${where}#${problem} (does not match odin-lab-dispatch v1)`);
  if (problems.length) return problems;
  const assets = [['/clip/src', dispatch.clip.src], ['/poster', dispatch.poster], ...dispatch.stills.map((still, i) => [`/stills/${i}`, still])];
  const { source, poster, stills, clip: { src, ...clip }, ...rest } = dispatch;
  problems.push(...screenTree({ ...rest, clip }, where));
  for (const [at, path] of assets) {
    problems.push(...pinnedAssetProblems(path, `${where}#${at}`, { under: `assets/labs/agent-space/${dispatch.session}/`, underLabel: 'its own session\'s assets', root, sha: dispatch.source.assetsSha256[path] }));
  }
  const listed = new Set(assets.map(([, path]) => path));
  for (const path of Object.keys(dispatch.source.assetsSha256)) if (!listed.has(path)) problems.push(`${where}#/source/assetsSha256: ${path} is not one of this dispatch's assets`);
  for (const path of listed) if (!(path in dispatch.source.assetsSha256)) problems.push(`${where}#/source/assetsSha256: no recorded sha256 for ${path}`);
  if (!dispatch.session.startsWith(`session-${dispatch.date}`)) problems.push(`${where}#/session: the name does not carry the session date`);
  const screened = new Map(dispatch.answersScreen.answers.map(answer => [answer.evidence, answer]));
  for (const [i, question] of dispatch.questions.entries()) {
    if (!screened.has(question.evidence)) problems.push(`${where}#/questions/${i}/evidence: ${question.evidence} has no passing answer screen`);
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

  const base = `assets/labs/agent-space/${session}`;
  const files = [[manifest.clip.file, `${base}/clip.webm`], [manifest.poster, `${base}/poster.png`],
    ...manifest.stills.map(still => [still, `${base}/${still}`])];
  const dispatch = {
    format: 'odin-lab-dispatch', version: 1, lab: 'agent-space', session, date: manifest.date,
    clip: { src: `${base}/clip.webm`, bytes: manifest.clip.bytes, mime: manifest.clip.mime, seconds: manifest.clip.seconds },
    poster: `${base}/poster.png`, stills: manifest.stills.map(still => `${base}/${still}`), questions,
    answersScreen: { by: answerScreen?.by ?? '', answers: (Array.isArray(answerScreen?.answers) ? answerScreen.answers : [])
      .filter(answer => proofs.has(answer?.evidence)).map(({ evidence, verdict, checks }) => ({ evidence, verdict, checks })) },
    source: { schema: 'odin-dispatch-v1', schemaSha256: sha256(sourceSchemaRaw), manifestSha256: sha256(manifestRaw),
      // Every published asset's bytes, as copied unchanged from the session: the build re-hashes each one and refuses a mismatch.
      assetsSha256: Object.fromEntries(files.filter(([from]) => existsSync(join(sessionDir, from))).map(([from, to]) => [to, sha256(readFileSync(join(sessionDir, from)))])) },
  };
  // The dispatch as it would be written is screened as a whole, so a session or file name carries nothing either.
  if (!problems.length) problems.push(...dispatchProblems(dispatch, 'dispatch'));
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
    else if (['--session', '--answers-screen', '--site', '--fingerprint'].includes(flag) && argv[i + 1]) out[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (!out.session && !out.fingerprint) throw new Error('--session <dir> is required');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-dispatch-publish.mjs --session <dir> --answers-screen <file> [--site <dir>] [--check]\n${error.message}`);
    process.exit(2);
  }
  if (options.fingerprint) { console.log(fingerprint(options.fingerprint)); process.exit(0); }
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
