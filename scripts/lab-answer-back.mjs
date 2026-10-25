// The Lab 01 answer-back drafts (mission rnd-labs-human-first-1024, vision-plan bundle 3 WO-04). When a session is
// published, everyone whose question it asked gets a reply on their issue. From the public dispatch
// (odin-lab-dispatch v1, as scripts/lab-dispatch-publish.mjs writes it) and the questions file the session was
// filmed from (odin-questions v1, as scripts/lab-intake.mjs writes it), it drafts one reply per asked question that
// came from an issue, for the founder to read and post by hand:
//   <out>/issue-<n>.md     the question as asked, the agent's answer quoted verbatim and whole as the card shows it,
//                          its why, where it came from, and the dispatch's place on the lab page
//   <out>/summary.json     which issues got a draft, which questions of the file the dispatch did not answer, and
//                          which asked questions had no issue (our own seed questions)
//
//   node scripts/lab-answer-back.mjs --dispatch <published dispatch json> --questions <odin-questions file> --out <dir>
//
// Nothing here posts, sends or calls anything: the script makes no network call of any kind, and replying to a person
// stays the founder's own act (odin-labs rule 36). A question is joined to its issue by its id; a follow-up the session
// asked on its own carries no issue and gets no draft.
// It REFUSES (exit 1, every reason listed, nothing written, the out dir not even created) when the dispatch does not
// pass the publisher's own checks (dispatchProblems), when the questions file does not pass the intake's
// (questionsProblems), when a question the dispatch answered reads or is addressed differently in the questions file
// (the asker asked something else), when any draft fails the publisher's text screen or does not link the dispatch
// (the drafts generator's draftProblems), or when --out resolves under site/ or dist/ (its outProblems).
// Exit codes: 0 done, 1 refused, 3 usage.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchProblems } from './lab-dispatch-publish.mjs';
import { dispatchUrl, draftProblems, outProblems } from './lab-dispatch-drafts.mjs';
import { questionsProblems } from './lab-intake.mjs';
import { sourceKind } from './labs.mjs';

const BANNER = 'DRAFT — the founder posts. Nothing here is sent.';
const longDate = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const quote = text => text.split('\n').map(line => `> ${line}`).join('\n');

/** The reply for one asked question, as markdown. */
export function reply(dispatch, question, issue, url) {
  return [`<!-- ${BANNER} The reply to issue #${issue}: post it there as a comment, by hand. -->`, '',
    `Thank you for asking. Your question was asked in the agent space on ${longDate(dispatch.date)}, and ${question.to} answered it live${question.followUp ? ', as a follow-up' : ''}.`, '',
    quote(`“${question.text}”`), '',
    `${question.to}'s answer, as its card shows it:`, '',
    quote(question.answer), '',
    ...(question.why ? [`**Why:** ${question.why}`, ''] : []),
    `**Where it came from:** ${sourceKind(question.source)} (evidence \`${question.evidence}\`)`, '',
    `The recording, with every question and every card: ${url}`, ''].join('\n');
}

/**
 * Every reply for one dispatch, in memory: { problems, files, summary }. All are built and screened first; only when
 * nothing is refused are they returned to be written.
 */
export function answerBack(dispatch, questionsDoc, where = { dispatch: 'dispatch', questions: 'questions' }) {
  const problems = [...dispatchProblems(dispatch, where.dispatch), ...questionsProblems(questionsDoc).map(p => `${where.questions}: ${p}`)];
  if (problems.length) return { problems, files: {} };
  const url = dispatchUrl(dispatch);
  const byId = new Map(questionsDoc.questions.map(q => [q.id, q]));
  const files = {};
  const summary = { format: 'odin-answer-back-summary', version: 1, session: dispatch.session, questionsSession: questionsDoc.session, url, drafted: [], notAnswered: [], noIssue: [] };
  const answered = new Set();
  for (const [i, question] of dispatch.questions.entries()) {
    const asked = byId.get(question.id);
    if (!asked || !Number.isInteger(asked.issue)) { summary.noIssue.push(question.id); continue; }
    if (asked.text !== question.text) problems.push(`${where.dispatch}#/questions/${i}/text: not the question issue #${asked.issue} asked`);
    if (asked.to !== question.to) problems.push(`${where.dispatch}#/questions/${i}/to: ${question.to} answered, the questions file put it to ${asked.to}`);
    if (answered.has(asked.issue)) problems.push(`${where.dispatch}#/questions/${i}: issue #${asked.issue} is answered twice`);
    answered.add(asked.issue);
    const file = `issue-${asked.issue}.md`;
    files[file] = reply(dispatch, question, asked.issue, url);
    summary.drafted.push({ issue: asked.issue, id: question.id, file });
  }
  for (const q of questionsDoc.questions) if (!answered.has(q.issue)) summary.notAnswered.push({ issue: q.issue, id: q.id });
  problems.push(...draftProblems(files, url));
  if (problems.length) return { problems, files: {} };
  return { problems: [], files, summary, url };
}

/** Write the replies into `out`; nothing is written unless every check passes. */
export function writeAnswerBack(dispatchFile, questionsFile, out, roots) {
  const problems = outProblems(out, roots);
  const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { problems.push(`${file}: ${error.message}`); return null; } };
  const dispatch = read(dispatchFile), questionsDoc = read(questionsFile);
  if (problems.length) return { problems };
  const result = answerBack(dispatch, questionsDoc, { dispatch: dispatchFile, questions: questionsFile });
  if (result.problems.length) return result;
  mkdirSync(out, { recursive: true });
  for (const [file, text] of Object.entries(result.files)) writeFileSync(join(out, file), text);
  writeFileSync(join(out, 'summary.json'), `${JSON.stringify(result.summary, null, 1)}\n`);
  return result;
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (['--dispatch', '--questions', '--out'].includes(flag) && argv[i + 1]) out[flag.slice(2)] = argv[++i];
    else throw new Error(`unknown or incomplete argument ${flag}`);
  }
  if (!out.dispatch || !out.questions || !out.out) throw new Error('--dispatch <file>, --questions <file> and --out <dir> are required');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try { options = args(process.argv.slice(2)); } catch (error) {
    console.error(`usage: node scripts/lab-answer-back.mjs --dispatch <file> --questions <file> --out <dir>\n${error.message}`);
    process.exit(3);
  }
  const result = writeAnswerBack(resolve(options.dispatch), resolve(options.questions), resolve(options.out));
  if (result.problems.length) {
    console.error(`REFUSED ${options.dispatch}: ${result.problems.length} reason${result.problems.length === 1 ? '' : 's'}; nothing was written.`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const { drafted, notAnswered, noIssue } = result.summary;
  console.log(`DRAFTED ${drafted.length} repl${drafted.length === 1 ? 'y' : 'ies'} -> ${options.out} (${notAnswered.length} not answered in this dispatch, ${noIssue.length} without an issue); the founder posts.`);
}
