// A pull request's text, laid out as files for the site's leak gate (scripts/leak-gate.mjs --terms-only): its title
// (the squash subject the lander uses), its body and every commit message in it. The repository is public, so this
// text is as public as the site: the publish workflow screens the site and the tracked tree, and pr-text.yml screens
// this, with the same salted term set, on every pull request, every edit and every push.
//
//   node scripts/pr-text-screen.mjs --event <event.json> --commits <commits.json> --out <dir>
//
// event.json is the pull_request event (GITHUB_EVENT_PATH); commits.json is the API's list of the PR's commits
// (gh api --paginate --slurp). Fail closed: a missing event, a PR without a title, a commit list that is not exactly
// the PR's commit count (the API caps a list at 250), or a commit without a message, stops the screen.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';

/** -> [{file, text}] for one pull request: title.txt, body.md, commits/<sha>.txt. */
export function prTextFiles(event, pages) {
  const pr = event?.pull_request;
  if (!pr || typeof pr.title !== 'string' || !pr.title.trim()) throw new Error('pr-text: the event has no pull request title');
  const commits = (Array.isArray(pages?.[0]) ? pages.flat() : pages) ?? [];
  if (!Array.isArray(commits) || commits.length !== pr.commits) throw new Error(`pr-text: ${Array.isArray(commits) ? commits.length : 'no'} commits read, the pull request has ${pr.commits}`);
  const files = [{ file: 'title.txt', text: pr.title }, { file: 'body.md', text: pr.body ?? '' }];
  for (const c of commits) {
    if (!/^[0-9a-f]{40}$/.test(c?.sha ?? '') || typeof c?.commit?.message !== 'string') throw new Error('pr-text: a commit without a sha or a message');
    files.push({ file: `commits/${c.sha}.txt`, text: c.commit.message });
  }
  return files;
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!opt.event || !opt.commits || !opt.out) throw new Error('pr-text: --event, --commits and --out are required');
  const files = prTextFiles(JSON.parse(readFileSync(opt.event, 'utf8')), JSON.parse(readFileSync(opt.commits, 'utf8')));
  mkdirSync(join(opt.out, 'commits'), { recursive: true });
  for (const { file, text } of files) writeFileSync(join(opt.out, file), text);
  console.log(`pr-text: ${files.length - 2} commit messages, the title and the body written for the leak gate.`);
}

const invoked = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && invoked()) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
