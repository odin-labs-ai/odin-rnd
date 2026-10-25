// The Lab 01 question intake (mission rnd-labs-human-first-1024, vision-plan bundle 3 WO-01). It reads the questions
// visitors sent through the "Ask the agents" form (.github/ISSUE_TEMPLATE/ask-the-agents.yml), screens each one, and
// writes the questions file the agent space films a session from (odin-questions v1, checked against the vendored
// scripts/schemas/odin-dispatch-questions-v1.schema.json), plus a report of every question and why it was or was not
// kept:
//
//   gh issue list --label ask-the-agents --state open --json number,title,body,author,createdAt,state > issues.json
//   node scripts/lab-intake.mjs --issues issues.json --session <YYYY-Www> --out <file> [--report <file>] [--approve <file>]
//
// The operator runs gh; this script makes no network call of any kind. The questions file holds only questions whose
// screen verdict is ok, oldest first, at most MAX_QUESTIONS; every other question is in the report (default
// <out>.report.json): `refused` (it can never be asked as written), `held` (a person decides), `deferred` (ok, but over
// the cap: next session) or `skipped` (a closed issue). A question is ok only when no check below objects; when a
// check is unsure it holds, never passes.
//   form           the body is the form's, unchanged: its three headings and nothing else (else held); the issue is
//                  open (else skipped) and not from a bot (else held)
//   length         at most 300 characters after whitespace is collapsed, counted both as code points and as UTF-16
//                  units, so the space never cuts it (else refused); at least 3 characters (else refused)
//   consent        "My question is public and may appear in a recording." is ticked (else refused)
//   injection      no instructions to the agent about its rules, prompt, keys or secrets, no role-play or claim to
//                  be staff, no link or domain, no code block, markup or prompt tokens, no hidden characters (refused);
//                  inline code formatting and speaking "as a <role>" are held
//   personal-data  no email, phone, postcode, street address or listed place (the publisher's screen), no @mention of
//                  anyone but the asker, no "my name is" (refused); "I live in", "I'm from" and the like are held
//   ip-boundary    the publisher's text screen (scripts/lab-dispatch-publish.mjs, screenHits): no restricted name,
//                  price, local or IP address, file path or file name (refused). It runs over every string the
//                  questions file carries (id, agent, asker, session), not only the question
//   on-topic       one question, in the form of a question, made only of words in a closed vocabulary (plain
//                  function words and the space's own subjects); any other word holds it for a person, so an
//                  instruction or a sensitive subject no rule names is held, not passed. A listed sensitive subject
//                  (politics, health, money, ...) and two questions in one issue are held too
//   duplicate      the same question as an older ok one (by its letters) is held
// A held question (never a refused one, a form problem or a duplicate) becomes ok only through --approve: an
// odin-intake-approvals v1 file, {"format": "odin-intake-approvals", "version": 1, "by": "<label>", "approve":
// [{"issue": <n>, "textSha256": "<the report's textSha256 for that row>"}]}, so a person passes exactly the text they read.
// The agent asked is the one chosen in the form; with "Any of them", the agent the text addresses ("Atlas, ", "atlas: ")
// when it is one of the three, else Odin, as the space itself does. A text that addresses another agent than the one
// chosen is held. The asker is recorded as github:@<login>; the author's display name is never read out.
// It REFUSES (exit 1, every reason listed, nothing written) when the issues file is not a gh issue list, when the
// session is not YYYY-Www, when the questions file it built does not match the vendored schema or carries a string
// the screen refuses, or when --out or --report resolves under site/ or dist/ (the report quotes refused text, and
// neither file is published). Exit codes: 0 written, 1 refused, 3 usage.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalise, screenHits } from './lab-dispatch-publish.mjs';
import { outProblems } from './lab-dispatch-drafts.mjs';
import { validate } from './json-schema-lite.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const QUESTIONS_SCHEMA_FILE = join(here, 'schemas/odin-dispatch-questions-v1.schema.json');
export const FORMAT = 'odin-questions v1';
export const REPORT_FORMAT = 'odin-questions-intake-report';
export const MAX_QUESTIONS = 8;
export const MAX_TEXT = 300;
export const AGENTS = ['Odin', 'Atlas', 'Juno'];
export const DEFAULT_AGENT = 'Odin';
export const CHECKS = ['injection', 'personal-data', 'ip-boundary', 'on-topic'];
// The form's labels, as GitHub renders them as headings in the issue body (a test holds them to the template).
export const LABELS = { question: 'Your question', agent: 'Which agent should answer? (optional)', consent: 'Before you send it' };
export const CONSENT = 'My question is public and may appear in a recording.';
export const ANY_AGENT = 'Any of them';
const NO_RESPONSE = '_No response_';
const sha256 = data => createHash('sha256').update(data).digest('hex');

/** The form's fields from a rendered issue body: { question, agent, consent } or { problem } when it is not the form. */
export function parseBody(body) {
  if (typeof body !== 'string') return { problem: 'the issue has no body' };
  const sections = new Map();
  let current = null;
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^### (.*)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      if (!Object.values(LABELS).includes(current)) return { problem: `a heading the form does not have: ${JSON.stringify(current.slice(0, 60))}` };
      if (sections.has(current)) return { problem: `the heading ${JSON.stringify(current)} appears twice` };
      sections.set(current, []);
    } else if (current) sections.get(current).push(line);
    else if (line.trim()) return { problem: 'text before the form\'s first heading' };
  }
  for (const label of Object.values(LABELS)) if (!sections.has(label)) return { problem: `no ${JSON.stringify(label)} heading: not the form` };
  const value = label => { const text = sections.get(label).join('\n').trim(); return text === NO_RESPONSE ? '' : text; };
  const consentLines = value(LABELS.consent).split('\n').map(line => line.trim()).filter(Boolean);
  return {
    question: value(LABELS.question),
    agent: value(LABELS.agent),
    consent: consentLines.length === 1 && consentLines[0].toLowerCase() === `- [x] ${CONSENT}`.toLowerCase(),
  };
}

/** Whitespace and control characters collapsed to single spaces, as the space cleans a question before it asks it. */
export const clean = text => text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

// The publisher's screen reasons, by the check they belong to here. A reason not listed counts as ip-boundary.
const PUBLISHER_CHECK = [
  [/^a restricted name/, 'ip-boundary'], [/^a place name/, 'personal-data'], [/^a price/, 'ip-boundary'],
  [/^an email/, 'personal-data'], [/^a phone/, 'personal-data'], [/^a postcode/, 'personal-data'],
  [/^a street address/, 'personal-data'], [/^a local or IP/, 'ip-boundary'], [/^a file path/, 'ip-boundary'],
  [/^a link/, 'injection'],
];
const checkFor = reason => PUBLISHER_CHECK.find(([pattern]) => pattern.test(reason))?.[1] ?? 'ip-boundary';

const ROLES = '(?:admin(?:istrator)?|developer|dev|staff|employee|founder|owner|operator|moderator|mod|ceo|cto|engineer|maintainer|root|superuser|sysadmin|support staff)';
// Each [pattern, check, reason, verdict], matched on the normalised text (lowercase Latin, look-alikes folded).
const RULES = [
  [/\b(?:ignore|disregard|forget|override|bypass|skip|drop)\b[^.?!]{0,40}\b(?:instructions?|rules?|prompts?|guidelines?|guardrails?|polic(?:y|ies)|filters?|screen(?:ing)?|previous|above|prior|earlier)\b/, 'injection', 'an instruction to set aside the agent\'s rules', 'refused'],
  [/system\s*prompt|initial\s*prompt|hidden\s*prompt|developer\s*(?:mode|message)|jail\s*break|do anything now|\bdan mode\b|prompt\s*injection/, 'injection', 'a reference to the agent\'s prompt or a jailbreak', 'refused'],
  [/\b(?:reveal|print|show|tell|give|leak|dump|output|repeat|share|list|send|paste|read out|what (?:is|are))\b[^.?!]{0,40}\b(?:api[\s_-]*keys?|keys?|secrets?|tokens?|passwords?|credentials?|instructions|prompt|env(?:ironment)?(?: variables?)?|config(?:uration)?|\.env)\b/, 'injection', 'a request for keys, secrets, the prompt or the configuration', 'refused'],
  [/\b(?:you are now|you're now|from now on,? you|pretend (?:to be|you)|act as|acting as|role[\s-]?play|impersonate|speak as|answer as|respond as|reply as|simulate)\b/, 'injection', 'an instruction to role-play', 'refused'],
  [new RegExp(`\\b(?:i am|i'm|im|this is) (?:an? |the |your |odin's )?${ROLES}\\b`), 'injection', 'a claim to be staff', 'refused'],
  // "As a developer, how do I ..." is an ordinary question; "as your admin" may not be. A person reads it.
  [new RegExp(`\\bas (?:an? |the |your |odin's )${ROLES}\\b`), 'injection', 'speaks as a role (staff or not), for a person to judge', 'held'],
  [/```|~~~/, 'injection', 'a code block', 'refused'],
  [/<\s*\/?\s*[a-z!?][^>]*>/, 'injection', 'markup (an HTML tag)', 'refused'],
  [/\[\s*\/?\s*(?:inst|system|sys|user|assistant)\s*\]|<\|[^|]*\|>|\{\{|\}\}|^\s*(?:system|assistant|user)\s*:/, 'injection', 'prompt tokens or a role marker', 'refused'],
  [/\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\]\(|\b[a-z0-9-]+\.(?:com|net|org|io|ai|dev|app|nl|be|de|eu|uk|co|xyz|me|info|ly|gg|tv|to|sh|so|site|online|link|page)\b/, 'injection', 'a link or a domain name', 'refused'],
  [/`/, 'injection', 'code formatting', 'held'],
  [/\bmy (?:full |real |last |first )?name is\b|\bmy (?:phone|number|address|email|e-mail|whatsapp)\b/, 'personal-data', 'the asker\'s own name or contact details', 'refused'],
  [/\b(?:i live|i'm from|i am from|im from|i work (?:at|for)|my (?:company|employer|school|street|town|city|village|wife|husband|son|daughter|kid|boss))\b/, 'personal-data', 'a detail about the asker (where they live or work, their family)', 'held'],
  [/\b(?:politic\w*|election\w*|vot(?:e|es|ing)|religio\w*|church|war|wars|weapons?|guns?|drugs?|medical|medicine|doctor|diagnos\w*|symptoms?|therapy|suicid\w*|kill\w*|sex\w*|porn\w*|crypto\w*|bitcoin|stocks?|invest\w*|gambl\w*|bet|betting|lawyer|lawsuit|legal advice)\b/, 'on-topic', 'a sensitive subject, for a person to judge', 'held'],
];
// Hidden or format characters, judged on the raw text: they can carry text a reader does not see.
const HIDDEN = /[\p{Cf}͏ᅟᅠㅤﾠ\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const QUESTION_WORD = /^(?:(?:odin|atlas|juno)[,:]\s*)?(?:who|whom|whose|what|what's|whats|when|where|where's|why|how|how's|which|can|could|do|does|did|is|are|was|were|will|would|should|shall|may|might|have|has|any|if)\b/;
// The words a question about the space may be made of: plain function words, and the space's own subjects (its agents,
// what they do, how an answer is proven). It is closed on purpose. A deny-list cannot name every way to instruct an
// agent ("set aside all prior instructions") or every sensitive subject ("should I stop taking insulin"), so a
// question is ok only when every word is one of these; any other word holds it for a person (--approve). Words that
// steer an agent (instructions, rules, prompt, commands, ignore, follow, pretend, secret, key) are deliberately absent.
const FUNCTION_WORDS = `a an the and or but if so then than that this these those there their they them it its it's i i'm i've me my
  mine we us our you you're you've your yours yourself yourselves he she his her who whom whose what what's whats when where
  where's why how how's which can can't cannot could couldn't do does doesn't did didn't don't is isn't are aren't was wasn't
  were weren't will won't would wouldn't should shall may might must have has had having be been being am not no yes of in on
  at to for from with without about into by as up out over through between before after during while just also only still
  yet really very much many more most some any all each every other another same such own one two first last next new now
  today right again ever never always often already something anything everything someone anyone everyone nothing kind sort
  way thing things lot bit please hi hello hey thanks thank ok okay well like get got go going goes went come comes came
  make makes made use uses used using say says said tell ask asks asked want wants need needs mean means do doing done
  happen happens happening different difference better best good same around together else`;
const SPACE_WORDS = `odin atlas juno agent agents space lab labs world campus library desk help helps helping support guide
  knowledge base wiki page pages notes entry entries tool tools memory memories remember record records recording recorded
  session sessions question questions answer answers answered proof proofs card cards evidence source sources reason reasons
  check checks checked trust trusted true wrong mistake mistakes know knows knew known learn learns learned think thinks
  see sees saw look looks find finds found read reads walk walks talk talks visitor visitors follower followers people
  person build built builds work works worked start started begin plug add own brain structure structures live here
  meet chat move moving watch clip film filmed sure certain`;
const VOCABULARY = new Set(`${FUNCTION_WORDS} ${SPACE_WORDS}`.split(/\s+/).filter(Boolean));
const known = word => [word, word.replace(/'s$/, ''), word.replace(/s$/, ''), word.replace(/es$/, ''), word.replace(/ed$/, ''),
  word.replace(/ing$/, ''), word.replace(/d$/, '')].some(form => VOCABULARY.has(form));
/** The words of the normalised text that are not in the space's vocabulary, in order, each once. */
export const unknownWords = plain => [...new Set((plain.match(/[\p{L}\p{N}]+(?:'\p{L}+)?/gu) ?? []).filter(word => !known(word)))];

/**
 * One question's screen: { verdict: 'ok' | 'held' | 'refused', reasons: [{ check, reason, verdict }], text, to }.
 * `login` is the asker's GitHub login: the one handle the text may mention.
 */
export function screenQuestion({ question, agent, consent }, login = '') {
  const reasons = [];
  const say = (check, reason, verdict) => reasons.push({ check, reason, verdict });
  const text = clean(question ?? '');
  if (!consent) say('consent', `"${CONSENT}" is not ticked`, 'refused');
  if ([...text].length > MAX_TEXT || text.length > MAX_TEXT) say('length', `${[...text].length} characters, over ${MAX_TEXT}`, 'refused');
  if ([...text].length < 3) say('length', 'no question text', 'refused');
  if (HIDDEN.test((question ?? '').replace(/[\t\n\r]/g, ''))) say('injection', 'hidden or format characters', 'refused');
  if (/^(?: {4}|\t)\S/m.test(question ?? '')) say('injection', 'an indented code block', 'refused');
  for (const reason of new Set(screenHits(text).map(hit => hit.reason))) say(checkFor(reason), `${reason} (the publisher's screen)`, 'refused');
  const plain = normalise(text);
  for (const [pattern, check, reason, verdict] of RULES) if (pattern.test(plain)) say(check, reason, verdict);
  for (const m of plain.matchAll(/(?:^|[^\w.@])@([a-z0-9][a-z0-9-]{0,38})\b/g)) {
    if (m[1] !== login.toLowerCase()) { say('personal-data', 'an @mention of someone other than the asker', 'refused'); break; }
  }
  let to = DEFAULT_AGENT;
  // An address at the start ("Atlas, ...", "atlas: ...") in any case; a known agent is written as the form spells it.
  const said = /^(\p{L}{2,20})\s*[,:]\s/u.exec(normalise(text))?.[1] ?? null;
  const lead = said ? AGENTS.find(name => name.toLowerCase() === said) ?? said : null;
  if (agent && agent !== ANY_AGENT && !AGENTS.includes(agent)) say('form', `an agent the form does not offer: ${JSON.stringify(agent.slice(0, 40))}`, 'held');
  else if (agent && agent !== ANY_AGENT) to = agent;
  else if (lead && AGENTS.includes(lead)) to = lead;
  if (lead && /^(?:who|what|when|where|why|how|which|hi|hello|hey|thanks|please|so|ok|okay|well|yes|no)$/i.test(lead) === false && lead !== to) {
    say('on-topic', `the text addresses ${lead}, but it is put to ${to}`, 'held');
  }
  const marks = (plain.match(/\?/g) ?? []).length;
  if (marks > 1) say('on-topic', 'more than one question', 'held');
  if (!(marks === 1 && /\?$/.test(plain)) && !QUESTION_WORD.test(plain)) say('on-topic', 'not in the form of a question', 'held');
  const unknown = unknownWords(plain);
  if (unknown.length) say('on-topic', `words outside the space's vocabulary, for a person to judge: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ', ...' : ''}`, 'held');
  if (plain.split(/\s+/).filter(Boolean).length < 2) say('on-topic', 'a single word', 'held');
  const verdict = reasons.some(r => r.verdict === 'refused') ? 'refused' : reasons.length ? 'held' : 'ok';
  return { verdict, reasons, text, to };
}

/** Why the issues file is not a gh issue list (the fields this script asks gh for). */
export function issuesProblems(issues) {
  if (!Array.isArray(issues)) return ['the issues file is not a JSON array (gh issue list --json ...)'];
  const problems = [];
  const seen = new Set();
  issues.forEach((issue, i) => {
    if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) { problems.push(`issue [${i}]: not an object`); return; }
    if (!Number.isInteger(issue.number) || issue.number < 1) problems.push(`issue [${i}]: no issue number`);
    else if (seen.has(issue.number)) problems.push(`issue #${issue.number}: listed twice`);
    else seen.add(issue.number);
    if (typeof issue.createdAt !== 'string' || Number.isNaN(Date.parse(issue.createdAt))) problems.push(`issue [${i}]: no createdAt date`);
    if (typeof issue.state !== 'string') problems.push(`issue [${i}]: no state`);
  });
  return problems;
}

const SESSION = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const letters = text => normalise(text).replace(/[^\p{L}\p{N}]/gu, '');

export const APPROVALS_FORMAT = 'odin-intake-approvals';
// A person may pass a held question only for these checks: what the screen could not judge. A form problem (not the
// form, a bot, no login), a duplicate and every refusal stay as they are.
export const APPROVABLE = ['injection', 'personal-data', 'on-topic'];
/** The hash a person's approval names: the question exactly as the intake read it (cleaned), so an edit voids it. */
export const textSha256 = text => sha256(text);

/** Why an approvals file may not be used: { problems, byIssue } (byIssue maps an issue number to its text hash). */
export function approvalsProblems(doc) {
  const problems = [];
  const byIssue = new Map();
  if (doc === null || typeof doc !== 'object' || doc.format !== APPROVALS_FORMAT || doc.version !== 1) problems.push(`the approvals file is not ${APPROVALS_FORMAT} v1`);
  else {
    if (typeof doc.by !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(doc.by)) problems.push('the approvals file does not say who approved (a lowercase label)');
    if (!Array.isArray(doc.approve)) problems.push('the approvals file has no approve list');
    else doc.approve.forEach((entry, i) => {
      if (!Number.isInteger(entry?.issue) || entry.issue < 1 || !/^[0-9a-f]{64}$/.test(entry?.textSha256 ?? '')) problems.push(`approve [${i}]: not { issue, textSha256 }`);
      else if (byIssue.has(entry.issue)) problems.push(`approve [${i}]: issue #${entry.issue} is approved twice`);
      else byIssue.set(entry.issue, entry.textSha256);
    });
  }
  return { problems, byIssue, by: doc?.by };
}

/**
 * The intake, in memory: { problems, questions, report }. Nothing is written here; `problems` lists why nothing may be.
 * Issues are taken oldest first (createdAt, then number), so the cap and the duplicate check keep the earlier asker.
 * `approvals` (odin-intake-approvals v1) passes a held question a person has read: only when every reason it was held
 * for is one of APPROVABLE, and only for the exact text the person read.
 */
export function intake(issues, session, approvals = null) {
  const problems = issuesProblems(issues);
  const approved = approvals ? approvalsProblems(approvals) : { problems: [], byIssue: new Map() };
  problems.push(...approved.problems);
  if (!SESSION.test(String(session))) problems.push(`--session ${JSON.stringify(session)} is not YYYY-Www (an ISO week, e.g. 2026-W44)`);
  if (problems.length) return { problems };
  const rows = [];
  const kept = [];
  const seenText = new Set();
  const ordered = [...issues].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number);
  for (const issue of ordered) {
    const login = typeof issue.author?.login === 'string' ? issue.author.login : '';
    const row = { issue: issue.number, createdAt: issue.createdAt, verdict: 'ok', reasons: [] };
    rows.push(row);
    if (issue.state !== 'OPEN') { Object.assign(row, { verdict: 'skipped', reasons: [{ check: 'form', reason: `the issue is ${String(issue.state).toLowerCase()}`, verdict: 'skipped' }] }); continue; }
    const form = parseBody(issue.body);
    if (form.problem) { Object.assign(row, { verdict: 'held', reasons: [{ check: 'form', reason: form.problem, verdict: 'held' }] }); continue; }
    const screen = screenQuestion(form, login);
    row.text = screen.text;
    row.to = screen.to;
    row.reasons = screen.reasons;
    if (!LOGIN.test(login)) row.reasons.push({ check: 'form', reason: 'no GitHub login for the asker', verdict: 'held' });
    // The asker's handle is carried in the file the space reads, so it passes the same screen as the question.
    else for (const reason of new Set(screenHits(`github:@${login}`).map(hit => hit.reason))) row.reasons.push({ check: checkFor(reason), reason: `the asker's login: ${reason}`, verdict: 'refused' });
    if (issue.author?.is_bot === true) row.reasons.push({ check: 'form', reason: 'the issue was opened by a bot', verdict: 'held' });
    row.verdict = row.reasons.some(r => r.verdict === 'refused') ? 'refused' : row.reasons.length ? 'held' : 'ok';
    const approval = approved.byIssue.get(issue.number);
    if (approval !== undefined) {
      if (row.verdict !== 'held') row.approval = `not applied: the question is ${row.verdict}, and only a held question can be approved`;
      else if (approval !== textSha256(screen.text)) row.approval = 'not applied: the text is not the one approved (edited since?)';
      else if (!row.reasons.every(r => APPROVABLE.includes(r.check))) row.approval = `not applied: held for ${[...new Set(row.reasons.filter(r => !APPROVABLE.includes(r.check)).map(r => r.check))].join(', ')}, which a person cannot pass`;
      else { row.verdict = 'ok'; row.approval = `approved by ${approved.by}`; }
    } else if (row.verdict === 'held') row.textSha256 = textSha256(screen.text);
    if (row.verdict !== 'ok') continue;
    const key = letters(screen.text);
    if (seenText.has(key)) { Object.assign(row, { verdict: 'held', reasons: [{ check: 'duplicate', reason: 'the same question as an older one', verdict: 'held' }] }); continue; }
    seenText.add(key);
    if (kept.length >= MAX_QUESTIONS) { Object.assign(row, { verdict: 'deferred', reasons: [{ check: 'cap', reason: `over ${MAX_QUESTIONS} questions in one session: next session`, verdict: 'deferred' }] }); continue; }
    row.id = `q-${issue.number}`;
    kept.push({ id: row.id, to: screen.to, text: screen.text, askedBy: `github:@${login}`, issue: issue.number, screen: { verdict: 'ok', checks: [...CHECKS] } });
  }
  const questions = { format: FORMAT, session, questions: kept };
  problems.push(...questionsProblems(questions));
  const counts = Object.fromEntries(['ok', 'deferred', 'held', 'refused', 'skipped'].map(v => [v, rows.filter(r => r.verdict === v).length]));
  const report = { format: REPORT_FORMAT, version: 1, session, issuesSha256: sha256(JSON.stringify(issues)), counts,
    note: 'Not published: it quotes refused and held questions as sent. Held questions wait for a person; nothing here is asked.', rows };
  return { problems, questions, report };
}

/**
 * Why a questions file may not go to the space: the vendored schema, the format, at most MAX_QUESTIONS, unique ids,
 * every question ok with the four checks, at most MAX_TEXT characters, and every string it carries through the
 * publisher's screen (so an asker's login cannot carry a restricted name either).
 */
export function questionsProblems(doc) {
  const problems = validate(JSON.parse(readFileSync(QUESTIONS_SCHEMA_FILE, 'utf8')), doc).map(p => `questions#${p} (does not match the vendored questions schema)`);
  if (problems.length) return problems;
  if (doc.format !== FORMAT) problems.push(`questions#/format: not ${FORMAT}`);
  if (!SESSION.test(String(doc.session))) problems.push('questions#/session: not YYYY-Www');
  if (doc.questions.length > MAX_QUESTIONS) problems.push(`questions#/questions: ${doc.questions.length}, over ${MAX_QUESTIONS}`);
  if (new Set(doc.questions.map(q => q.id)).size !== doc.questions.length) problems.push('questions#/questions: an id is used twice');
  doc.questions.forEach((q, i) => {
    const at = `questions#/questions/${i}`;
    if (q.screen.verdict !== 'ok') problems.push(`${at}/screen/verdict: not ok`);
    if (JSON.stringify(q.screen.checks) !== JSON.stringify(CHECKS)) problems.push(`${at}/screen/checks: not ${CHECKS.join(', ')}`);
    if (!AGENTS.includes(q.to)) problems.push(`${at}/to: not one of ${AGENTS.join(', ')}`);
    if ([...q.text].length > MAX_TEXT || q.text.length > MAX_TEXT) problems.push(`${at}/text: over ${MAX_TEXT} characters`);
    if (!/^github:@[A-Za-z0-9-]{1,39}$/.test(q.askedBy ?? '')) problems.push(`${at}/askedBy: not github:@<login>`);
    if (!Number.isInteger(q.issue) || q.issue < 1) problems.push(`${at}/issue: not an issue number`);
    for (const [key, value] of Object.entries({ id: q.id, to: q.to, text: q.text, askedBy: q.askedBy })) {
      for (const hit of screenHits(String(value))) problems.push(`${at}/${key}: ${hit.reason}`);
    }
  });
  for (const hit of screenHits(String(doc.session))) problems.push(`questions#/session: ${hit.reason}`);
  return problems;
}

/** The default report path: next to the questions file. */
export const reportPath = out => out.endsWith('.json') ? `${out.slice(0, -'.json'.length)}.report.json` : `${out}.report.json`;

/** Run the intake from files and write both outputs; nothing is written unless every check passes. */
export function runIntake({ issuesFile, session, out, report = reportPath(out), approvalsFile = null, roots }) {
  // The shared check names drafts; here it guards the questions file and its report, which quotes what visitors sent.
  const problems = [...outProblems(out, roots), ...outProblems(report, roots)]
    .map(problem => problem.replace(/: drafts are never published$/, ': the questions file and its report are never published'));
  if (resolve(out) === resolve(report)) problems.push('--out and --report are the same file');
  let issues;
  try { issues = JSON.parse(readFileSync(issuesFile, 'utf8')); } catch (error) { problems.push(`${issuesFile}: ${error.message}`); }
  if (problems.length) return { problems };
  let approvals = null;
  if (approvalsFile) try { approvals = JSON.parse(readFileSync(approvalsFile, 'utf8')); } catch (error) { return { problems: [`${approvalsFile}: ${error.message}`] }; }
  const result = intake(issues, session, approvals);
  if (result.problems.length) return result;
  for (const [file, doc] of [[out, result.questions], [report, result.report]]) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`); }
  return { ...result, out, reportFile: report };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--issues', '--session', '--out', '--report', '--approve'].includes(flag) && argv[i + 1]) out[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (!out.issues || !out.session || !out.out) throw new Error('--issues <file>, --session <YYYY-Www> and --out <file> are required');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-intake.mjs --issues <gh issue list json> --session <YYYY-Www> --out <file> [--report <file>] [--approve <file>]\n${error.message}`);
    process.exit(3);
  }
  const out = resolve(options.out);
  const result = runIntake({ issuesFile: resolve(options.issues), session: options.session, out, report: resolve(options.report ?? reportPath(out)), approvalsFile: options.approve ? resolve(options.approve) : null });
  if (result.problems.length) {
    console.error(`REFUSED ${options.issues}: ${result.problems.length} reason${result.problems.length === 1 ? '' : 's'}; nothing was written.`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const { counts } = result.report;
  console.log(`SCREENED ${result.report.rows.length} issues for ${options.session}: ${counts.ok} to ask, ${counts.deferred} deferred, ${counts.held} held, ${counts.refused} refused, ${counts.skipped} skipped -> ${result.out} (report ${result.reportFile}). Held questions wait for a person.`);
}
