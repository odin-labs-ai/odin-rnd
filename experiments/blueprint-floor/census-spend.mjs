// EXP 007 spend ledger (J2, WO-2-02, R6-3), enforced IN CODE. Every metered call of the census (canaries, the practice
// pair, the counted translator and adjudicator calls) appends ONE line to experiments/blueprint-floor/spend-ledger.jsonl,
// cost in dollars to 7 decimal places, from the client's total_cost_usd (an API-equivalent figure under subscription auth).
//   - Unknown cost (a timeout, a crash, no or a non-positive total_cost_usd): charged the upper bound, which the
//     pre-registration states (spend.unknownCost): three times the largest observed cost of that role, at least
//     $0.5000000. Never a $0 line; an unpaid round gets no line.
//   - Reserve (per role, refute r1 N2): the larger of the largest line of that role so far and the role's unknown-cost
//     bound, so an unknown-cost charge on the last call cannot cross the ceiling. A call is refused when the ledger total +
//     its reserve would exceed the $40 census ceiling (or the $100 cap).
//   - Integrity (refute r1 B3): the ledger must start with the bytes committed at HEAD, and an append-only MIRROR of every
//     line lives in a state directory shared by every worktree of the repository (the git common dir, chosen by the
//     runner): the ledger must contain the mirror's lines in order, and every uncommitted ledger line must be in the
//     mirror. A truncated or reset ledger, a second worktree's ledger, or a missing mirror beside uncommitted lines all
//     refuse every call. The pending sidecar lives in the same state directory.
//   - Crash safety (EXP 006 r4 N1): an INTENT line is appended to the gitignored pending sidecar before every spawn and
//     cleared after the ledger line is written; any line left in the sidecar refuses every later call (fail closed). A
//     corrupt ledger line refuses every call too.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const LEDGER = 'experiments/blueprint-floor/spend-ledger.jsonl';
export const LIMITS = Object.freeze({ capUsd: 100, ceilingUsd: 40, unknownFactor: 3, unknownFloorUsd: 0.5, reserveFloorUsd: 0.5, decimals: 7 });
export const KINDS = Object.freeze(['canary', 'practice', 'counted']);
export const ROLES = Object.freeze(['translator', 'adjudicator']);

export const round7 = v => Number(v.toFixed(LIMITS.decimals));
/** Sums in integer units of 1e-7 USD, so 7-dp figures add exactly. */
export const units = v => Math.round(v * 1e7);
export const fromUnits = u => u / 1e7;
export const sumUsd = lines => fromUnits(lines.reduce((s, l) => s + units(l.costUsd), 0));
/** A reported cost counts only if it is a finite number that survives rounding to 7 dp as positive. */
export const knownCost = v => typeof v === 'number' && Number.isFinite(v) && round7(v) > 0;

const LINE_KEYS = ['ts', 'kind', 'ruleId', 'role', 'model', 'costUsd', 'costBasis', 'reportedCostUsd', 'rehearsal', 'callId'];
/** A ledger line exactly as record() writes it; anything else makes the ledger corrupt (fail closed, never NaN). */
export function validLine(e) {
  return e !== null && typeof e === 'object' && !Array.isArray(e)
    && Object.keys(e).length === LINE_KEYS.length && LINE_KEYS.every(k => k in e)
    && typeof e.ts === 'string' && Number.isFinite(Date.parse(e.ts)) && KINDS.includes(e.kind)
    && typeof e.ruleId === 'string' && e.ruleId.length > 0 && ROLES.includes(e.role) && typeof e.model === 'string'
    && typeof e.costUsd === 'number' && Number.isFinite(e.costUsd) && e.costUsd > 0 && e.costUsd === round7(e.costUsd)
    && ['api-equivalent', 'upper-bound'].includes(e.costBasis)
    && (e.costBasis === 'upper-bound' || e.costUsd === round7(e.reportedCostUsd))
    && typeof e.rehearsal === 'boolean' && typeof e.callId === 'string';
}

export class CensusLedger {
  /**
   * `stateDir`: where the pending sidecar and the mirror live (the runner passes the git common dir's census dir for a
   * metered run). `headText`: the ledger as committed at HEAD. `mirror: false` only for unit tests of the arithmetic.
   */
  constructor(path, { stateDir = dirname(path), headText = '', mirror = true, limits = LIMITS } = {}) {
    this.path = path; this.limits = limits; this.headText = headText; this.mirror = mirror;
    this.pendingPath = join(stateDir, 'spend-ledger.pending.jsonl');
    this.mirrorPath = join(stateDir, 'spend-ledger.mirror.jsonl');
  }
  text() { return existsSync(this.path) ? readFileSync(this.path, 'utf8') : ''; }
  /** The integrity check (B3); a missing mirror beside a ledger equal to HEAD is initialised from it (bootstrap). */
  integrity() {
    const r = checkLedgerIntegrity({ ledgerText: this.text(), headText: this.headText, mirrorText: !this.mirror ? undefined : existsSync(this.mirrorPath) ? readFileSync(this.mirrorPath, 'utf8') : null });
    if (r.ok && r.bootstrap) { mkdirSync(dirname(this.mirrorPath), { recursive: true }); writeFileSync(this.mirrorPath, this.text(), { flag: 'wx' }); }
    return r;
  }

  /** Every line, validated; a corrupt line throws (the guard then refuses: fail closed). */
  entries() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map((l, i) => {
      let e = null;
      try { e = JSON.parse(l); } catch { /* invalid below */ }
      if (!validLine(e)) throw new Error(`spend ledger line ${i + 1} is corrupt: every call is refused until it is repaired`);
      return e;
    });
  }
  total(filter = () => true) { return sumUsd(this.entries().filter(filter)); }
  /** The largest line of a role so far (any basis), for the reserve. */
  largest(role) { return this.entries().filter(e => e.role === role).reduce((m, e) => Math.max(m, e.costUsd), 0); }
  /** The largest OBSERVED (reported) cost of a role so far, for the unknown-cost bound. */
  largestObserved(role) { return this.entries().filter(e => e.role === role && e.costBasis === 'api-equivalent').reduce((m, e) => Math.max(m, e.costUsd), 0); }
  reserve(role) { return round7(Math.max(this.largest(role), this.unknownBound(role), this.limits.reserveFloorUsd)); }
  /** The pre-registered unknown-cost bound: max(observed per role) x 3, at least $0.5000000. */
  unknownBound(role) { return round7(Math.max(this.largestObserved(role) * this.limits.unknownFactor, this.limits.unknownFloorUsd)); }
  /** Whether (kind, ruleId, role) already has a line: the resume key (R6-3), never re-called. */
  called(kind, ruleId, role, { rehearsal = false } = {}) { return this.entries().find(e => e.kind === kind && e.ruleId === ruleId && e.role === role && e.rehearsal === rehearsal) ?? null; }

  pendingLines() { return existsSync(this.pendingPath) ? readFileSync(this.pendingPath, 'utf8').split('\n').filter(Boolean) : []; }
  recordPending(meta) { mkdirSync(dirname(this.pendingPath), { recursive: true }); appendFileSync(this.pendingPath, `${JSON.stringify(meta)}\n`); }
  /** The intent line, before a spawn; if this append throws the caller must not spawn. */
  writeIntent({ callId, kind, ruleId, role }) {
    const intent = { intent: true, callId, kind, ruleId, role, upperBoundUsd: this.unknownBound(role), ts: new Date().toISOString() };
    this.recordPending(intent);
    return intent;
  }
  /** Removes only this call's own intent line, atomically (temp file + rename). */
  clearIntent(callId) {
    const own = l => { try { const e = JSON.parse(l); return e?.intent === true && e.callId === callId; } catch { return false; } };
    const keep = this.pendingLines().filter(l => !own(l));
    const tmp = `${this.pendingPath}.${process.pid}.tmp`;
    writeFileSync(tmp, keep.length ? `${keep.join('\n')}\n` : '');
    renameSync(tmp, this.pendingPath);
  }

  /** Whether one more call of `role` may start: {ok, reason, askFork, spent, reserve}. */
  check(role) {
    if (!ROLES.includes(role)) return { ok: false, reason: 'unknown-role', askFork: true };
    if (this.pendingLines().length) return { ok: false, reason: 'pending-ledger-line', askFork: true, pending: this.pendingPath.split('/').pop() };
    try { this.entries(); } catch (error) { return { ok: false, reason: 'corrupt-ledger', askFork: true, error: error.message }; }
    const integrity = this.integrity();
    if (!integrity.ok) return { ok: false, reason: integrity.reason, askFork: true };
    const spent = this.total(), reserve = this.reserve(role);
    const base = { spent, reserve, ceilingUsd: this.limits.ceilingUsd, capUsd: this.limits.capUsd };
    if (units(spent) + units(reserve) > units(this.limits.capUsd)) return { ok: false, reason: 'cap', askFork: true, ...base };
    if (units(spent) + units(reserve) > units(this.limits.ceilingUsd)) return { ok: false, reason: 'census-ceiling', askFork: true, ...base };
    return { ok: true, reason: null, askFork: false, ...base };
  }

  /** Appends the line for one metered call; an unknown cost is charged the bound. Returns the line written. */
  record({ ts, kind, ruleId, role, model, reportedCostUsd, rehearsal = false, callId }) {
    if (!KINDS.includes(kind)) throw new Error(`unknown ledger kind ${kind}`);
    if (!ROLES.includes(role)) throw new Error(`unknown role ${role}`);
    const known = knownCost(reportedCostUsd);
    const line = {
      ts, kind, ruleId, role, model,
      costUsd: known ? round7(reportedCostUsd) : this.unknownBound(role),
      costBasis: known ? 'api-equivalent' : 'upper-bound',
      reportedCostUsd: typeof reportedCostUsd === 'number' && Number.isFinite(reportedCostUsd) ? reportedCostUsd : null,
      rehearsal: Boolean(rehearsal), callId,
    };
    if (!validLine(line)) throw new Error('refusing to write an invalid ledger line (never a $0 line)');
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(line)}\n`);
    // Then the mirror (B3). If this append fails, the caller keeps the line pending and every later call refuses.
    if (this.mirror) { mkdirSync(dirname(this.mirrorPath), { recursive: true }); appendFileSync(this.mirrorPath, `${JSON.stringify(line)}\n`); }
    return line;
  }
}

const lines = t => t.split('\n').filter(Boolean);
/**
 * B3: the ledger starts with the bytes committed at HEAD; the mirror's lines appear in the ledger in order; every ledger
 * line after the committed ones is in the mirror. `mirrorText` null = no mirror file (allowed only when the ledger is
 * exactly HEAD's, and then the mirror is initialised from it); undefined = mirror not used (arithmetic unit tests).
 */
export function checkLedgerIntegrity({ ledgerText, headText, mirrorText }) {
  if (!ledgerText.startsWith(headText)) return { ok: false, reason: 'ledger-not-head-prefix' };
  if (mirrorText === undefined) return { ok: true };
  if (mirrorText === null) return ledgerText === headText ? { ok: true, bootstrap: true } : { ok: false, reason: 'mirror-missing' };
  const L = lines(ledgerText), M = lines(mirrorText), H = lines(headText);
  let j = 0;
  for (const l of L) if (j < M.length && l === M[j]) j += 1;
  if (j !== M.length) return { ok: false, reason: 'ledger-lacks-mirror' };
  const mirrored = new Set(M);
  if (L.slice(H.length).some(l => !mirrored.has(l))) return { ok: false, reason: 'ledger-line-not-mirrored' };
  return { ok: true };
}

/**
 * The pre-count (R6-3): projection = (#rules) x (practice pair cost) x 1.5 + spent. Above the $40 census ceiling the
 * commander asks the founder (ASK-FORK) before any counted call.
 */
export function projection({ rules, pairCostUsd, spentUsd, limits = LIMITS }) {
  if (!Number.isInteger(rules) || rules < 1) throw new Error('the projection needs the census rule count');
  if (!knownCost(pairCostUsd)) throw new Error('the projection needs a positive practice pair cost');
  const total = round7(rules * pairCostUsd * 1.5 + spentUsd);
  return { formula: '(#rules) x (practice pair cost) x 1.5 + spent', rules, pairCostUsd: round7(pairCostUsd), spentUsd: round7(spentUsd), totalUsd: total, ceilingUsd: limits.ceilingUsd, askFork: units(total) > units(limits.ceilingUsd) };
}
