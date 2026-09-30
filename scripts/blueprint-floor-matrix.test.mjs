import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { citations, loadMatrix, runMatrix } from '../experiments/blueprint-floor/matrix.mjs';

// EXP 007 refute r8 (commander decision): every engine sentence is backed by a row of engine-matrix.json, and every row is
// run through the adapter and the installed bce-engine 0.3.1 here.
const LONG = { timeout: 1_200_000 };
const matrix = loadMatrix();
const ids = new Set(matrix.rows.map(r => r.id));

test('the matrix: unique ids m01..mNN, each row a single constraint with an expected RED or GREEN and a note', () => {
  assert(matrix.rows.length >= 35);
  matrix.rows.forEach((r, i) => {
    assert.equal(r.id, `m${String(i + 1).padStart(2, '0')}`);
    assert(['RED', 'GREEN', 'REFUSED'].includes(r.expected) && typeof r.note === 'string' && r.note.length > 10, r.id);
    assert(Array.isArray(r.constraints) && r.constraints.length === 1, r.id);
  });
  assert.equal(ids.size, matrix.rows.length);
});

test('every row gives its expected verdict through the real adapter and bce 0.3.1 (RED means the row\'s own constraint fired)', LONG, async () => {
  const results = await runMatrix();
  const wrong = results.filter((r, i) => r.label !== matrix.rows[i].expected).map((r, i) => `${r.id}: ${r.label}`);
  assert.deepEqual(wrong, []);
});

// An engine sentence: it names a constraint type or the checker AND says what it detects.
const ENGINE = /\b(forbiddenDependency|forbiddenEgress|forbiddenPattern|forbiddenFile|the checker|the engine|every read file|a read file)\b/i;
const DETECTS = /\b(fires?|FAIL when|matche[sd]|recogni[sz]es|parses|does not fire|never fires|never matches|is not matched|refuses)\b/;
const sentences = text => text.replace(/`[^`]*`/g, m => m.replace(/[.!?]/g, '·')).split(/\n\s*\n|\n- |(?<=[.!?])\s+(?=[A-Z])/);
const sources = () => {
  const w = JSON.parse(readFileSync('experiments/blueprint-floor/whitelist.json', 'utf8'));
  const r = JSON.parse(readFileSync('experiments/blueprint-floor/preregistration.json', 'utf8'));
  return {
    'contract.md': readFileSync('experiments/blueprint-floor/contract.md', 'utf8'),
    'protocol.md': readFileSync('experiments/blueprint-floor/protocol.md', 'utf8'),
    'whitelist.json plugin notes': w.plugin.map(t => `${t.type}: ${t.note}`).join('\n\n'),
    'preregistration limits': r.limits.join('\n\n'),
  };
};

test('every engine sentence cites matrix rows, and every cited row exists', () => {
  const missing = [], unknown = [];
  for (const [name, text] of Object.entries(sources())) {
    for (const s of sentences(text)) {
      if (ENGINE.test(s) && DETECTS.test(s) && citations(s).length === 0) missing.push(`${name}: ${s.slice(0, 120)}`);
      for (const c of citations(s)) if (!ids.has(c)) unknown.push(`${name}: ${c}`);
    }
  }
  assert.deepEqual(missing, [], 'an engine sentence without a cited row');
  assert(sentences('forbiddenDependency fires on imports. It is fine [m01].').some(x => ENGINE.test(x) && DETECTS.test(x) && citations(x).length === 0), 'the check catches an uncited engine sentence');
  assert.deepEqual(unknown, [], 'a cited row that does not exist');
});

test('every matrix row is cited somewhere, so no row is dead weight', () => {
  const cited = new Set(Object.values(sources()).flatMap(citations));
  assert.deepEqual(matrix.rows.map(r => r.id).filter(id => !cited.has(id)), []);
});

// Refute r9 P2: a cited row must test the constraint type its sentence is about. A sentence's types are the types it names,
// else the types its block (paragraph or bullet) names; a sentence with no type in sight may cite any row.
const TYPES = ['forbiddenDependency', 'forbiddenEgress', 'forbiddenPattern', 'forbiddenFile'];
const named = t => TYPES.filter(x => t.includes(x));
test('refute r9 P2: every cited row tests the constraint type its sentence is about', () => {
  const typeOf = Object.fromEntries(matrix.rows.map(r => [r.id, r.constraints[0].type]));
  const wrong = [];
  for (const [name, text] of Object.entries(sources())) {
    for (const block of text.split(/\n\s*\n|\n- /)) {
      const blockTypes = named(block);
      for (const s of sentences(block)) {
        const types = named(s).length ? named(s) : blockTypes;
        if (!types.length) continue;
        for (const c of citations(s)) if (!types.includes(typeOf[c])) wrong.push(`${name}: ${c} (${typeOf[c]}) in "${s.slice(0, 90)}"`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});
