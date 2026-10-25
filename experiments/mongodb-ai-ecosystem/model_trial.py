"""Real local Voyage embeddings over a frozen, researcher-authored retrieval fixture."""
import datetime
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import unicodedata

os.umask(0o077)
ROOT = Path(__file__).resolve().parent
DOCS = [
    ('rotation', 'Rotate an expiring credential by creating a replacement, updating the worker secret, verifying new authentication, and only then revoking the old key. Preserve queued work during the change.'),
    ('snapshot', 'A tenant snapshot restores the captured tenant state. Writes acknowledged after capture are outside that snapshot and need a separate replay or recovery mechanism.'),
    ('idempotency', 'When a tool commits its effect and the worker dies before saving the checkpoint, replay may attempt the tool again. A stable operation identifier and a unique effect ledger prevent a duplicate effect.'),
    ('namespace', 'Conversation thread names and memory namespaces are routing identifiers. Derive their tenant component from authenticated application context; a caller-selected name is not authorization.'),
    ('cache', 'A private response cache must include trusted tenant, model, policy, and corpus versions. Similar questions alone do not establish that a cached answer is authorized or current.'),
    ('filter', 'Filtered approximate vector search can return too few neighbors when the tenant is rare. Verify actual query plans, iterative scanning, and an exhaustive in-tenant control.'),
    ('lexical', 'Hybrid retrieval combines lexical matching of opaque identifiers with vector similarity. Exact ticket and error codes can distinguish otherwise similar operations documents.'),
    ('embedding', 'An embedding model transforms text into vectors. The same vectors can be stored in different databases, so a better embedding model does not establish a better database.'),
    ('extraction', 'Conversation recording and extraction of long-term facts are different stages. The background extractor may take time; observe a usable long-term memory instead of assuming immediate availability.'),
    ('deletion', 'A corrected or deleted fact must disappear from semantic retrieval as well as direct lookup. Wait for search visibility and check that another tenant’s surviving memory is unchanged.'),
    ('readonly', 'A database agent tool should use read-only operation and a scoped database identity. Disabling write tools does not grant permission to read every tenant.'),
    ('residency', 'The database region and model inference region are separate choices. Confirm the inference endpoint and key scope independently from the location of stored vectors.'),
    ('distractor-rotation', 'Rotate an image in the document viewer using the toolbar. This changes the page orientation and does not update database credentials.'),
    ('distractor-snapshot', 'Take a screenshot of the dashboard to attach to a support ticket. A screenshot cannot restore database rows or replay writes.'),
    ('distractor-thread', 'Increase the CPU thread count when local inference underuses the processor. This setting does not identify a conversation or a tenant.'),
    ('distractor-cache', 'The operating system page cache stores recently read file blocks. Its contents are unrelated to authorization for cached language-model responses.'),
]
QUESTIONS = [
    ('q01', 'How can we replace a soon-to-expire access key without losing waiting jobs?', 'rotation'),
    ('q02', 'Will restoring yesterday’s captured tenant data also recover an insertion acknowledged this morning?', 'snapshot'),
    ('q03', 'What stops a tool from producing its effect twice if a process dies immediately after committing it?', 'idempotency'),
    ('q04', 'Can someone gain access to another organization by choosing its conversation identifier?', 'namespace'),
    ('q05', 'Which context belongs in a key for reusing a private model answer safely?', 'cache'),
    ('q06', 'Why can nearest-neighbor search miss the only surviving record for a very small tenant?', 'filter'),
    ('q07', 'How can retrieval distinguish an exact error code when several notes have nearly the same meaning?', 'lexical'),
    ('q08', 'If we improve the text-to-vector model, must we switch the database too?', 'embedding'),
    ('q09', 'Does accepting a new chat message mean its long-term facts are already searchable?', 'extraction'),
    ('q10', 'After removing a stale preference, what else must we verify besides direct document lookup?', 'deletion'),
    ('q11', 'Does turning off mutating agent tools establish access control over every tenant’s information?', 'readonly'),
    ('q12', 'Does storing embeddings in Europe prove that the model processed the text in Europe?', 'residency'),
]
MEMORY = {
    'old-a': 'The escalation owner for the amber service is Mara.',
    'new-a': 'The escalation owner for the amber service is Ivo. This replaces the earlier owner Mara.',
    'b': 'The escalation owner for the amber service is Nia.',
    'query': 'Who should receive an urgent amber service escalation?',
    'allow': 'The amber service may restart automatically after a failed readiness probe.',
    'deny': 'The amber service must not restart automatically after a failed readiness probe.',
    'allow-query': 'Is an unattended restart permitted when the amber service health check fails?',
    'deny-query': 'The current policy forbids unattended restarts after a failed amber service health check. Is an automatic restart allowed?',
}
fixture = {'documents': [{'id': k, 'text': v} for k, v in DOCS], 'queries': [{'id': k, 'text': v, 'expected': e} for k, v, e in QUESTIONS], 'memory': MEMORY}
protocol = {'revision': 1, 'frozenAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'model': 'MongoDB/voyage-4-nano-GGUF', 'modelRevision': '03547551689253732502486d62de4cd0970d6564', 'quantization': 'Q8_0', 'modelSha256': 'c6ed6cc898d50ae1a4492809affadc6c0d023f8ac05c07a37abe20c563152560', 'runtime': 'llama.cpp b11865; Darwin x86_64; CPU; authenticated UNIX socket', 'embedding': '2048 dimensions, first 512 then L2 normalization for database trial', 'prompts': {'document': 'Represent the document for retrieval: ', 'query': 'Represent the query for retrieving supporting documents: '}, 'normalization': 'Unicode NFC before tokenization', 'fixtureSha256': hashlib.sha256(json.dumps(fixture, sort_keys=True).encode()).hexdigest(), 'qualityMethod': 'Frozen researcher-authored expected document per query. Small closed-world fixture; not an independent human-labelled benchmark.', 'qualityTuning': 'None; all questions and ranks retained, including misses.', 'databaseGate': 'Both engines must match exhaustive in-tenant top-five IDs using identical model vectors; compare quality separately from correctness.', 'cacheDiagnostic': 'Record the cosine similarity of contradictory permissions before selecting any cache threshold; no threshold fitted to this fixture.', 'paidInference': False}
protocol.update(revision=2, amendment='amendment-01.json; explicit changed-policy premise in cache query, thresholds unchanged')
(ROOT / 'fixture.json').write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + '\n')
(ROOT / 'protocol.json').write_text(json.dumps(protocol, indent=2) + '\n')
assert hashlib.sha256((ROOT / 'voyage-4-nano-Q8_0.gguf').read_bytes()).hexdigest() == protocol['modelSha256']
secret = secrets.token_urlsafe(32)
sockdir = Path(tempfile.mkdtemp(prefix='ov-'))
sockpath = sockdir / 'embed.sock'


class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(str(sockpath))


def request(path, payload=None, *, authenticated=True):
    conn = UnixHTTP('localhost', timeout=120)
    headers = {'Content-Type': 'application/json'}
    if authenticated:
        headers['Authorization'] = 'Bearer ' + secret
    conn.request('POST' if payload else 'GET', path, body=json.dumps(payload) if payload else None, headers=headers)
    resp = conn.getresponse()
    raw = resp.read()
    conn.close()
    return resp.status, json.loads(raw)


def normalize(v):
    norm = math.sqrt(sum(x*x for x in v))
    return [x/norm for x in v]


started = datetime.datetime.now(datetime.timezone.utc).isoformat()
env = dict(os.environ, LLAMA_API_KEY=secret)
binary = ROOT / 'llama/llama-b11865/llama-server'
log = (ROOT / 'model-server.log').open('w')
process = subprocess.Popen([str(binary), '-m', str(ROOT / 'voyage-4-nano-Q8_0.gguf'), '--embedding', '--host', str(sockpath), '-c', '1024', '-b', '1024', '-ub', '1024', '-np', '1', '-t', '4', '-ngl', '0', '--no-webui'], env=env, stdout=log, stderr=subprocess.STDOUT)
result = {'startedAt': started, 'command': 'python model_trial.py', 'protocol': protocol}
try:
    for _ in range(90):
        if process.poll() is not None:
            raise RuntimeError('embedding process exited during startup; inspect retained log')
        try:
            if request('/health')[0] == 200:
                break
        except (OSError, ValueError):
            pass
        time.sleep(1)
    else:
        raise RuntimeError('embedding process not ready within 90 seconds')
    assert request('/v1/embeddings', {'input': ['authentication negative control']}, authenticated=False)[0] == 401
    sockpath.chmod(0o600)
    inputs = [('doc:' + k, v, 'document') for k, v in DOCS] + [('query:' + k, v, 'query') for k, v, _ in QUESTIONS]
    inputs += [('memory:' + k, v, 'query' if 'query' in k else 'document') for k, v in MEMORY.items()]
    embeddings = {}
    raw_responses = []
    for offset in range(0, len(inputs), 4):
        chunk = inputs[offset:offset+4]
        payload = {'input': [unicodedata.normalize('NFC', protocol['prompts'][kind] + text) for _, text, kind in chunk]}
        status, response = request('/v1/embeddings', payload)
        assert status == 200, response
        data = sorted(response['data'], key=lambda x: x['index'])
        assert len(data) == len(chunk)
        for (key, _, _), item in zip(chunk, data):
            vector = item['embedding']
            assert len(vector) == 2048 and all(math.isfinite(x) for x in vector)
            embeddings[key] = normalize(vector[:512])
        raw_responses.append({'offset': offset, 'keys': [k for k, _, _ in chunk], 'response': response})
        print(json.dumps({'embedded': min(offset+4, len(inputs)), 'total': len(inputs)}), flush=True)
    ranks = []
    for qid, _, expected in QUESTIONS:
        q = embeddings['query:' + qid]
        ordered = sorted(({'id': did, 'cosine': sum(a*b for a,b in zip(q, embeddings['doc:' + did]))} for did, _ in DOCS), key=lambda x: (-x['cosine'], x['id']))
        rank = next(i+1 for i, x in enumerate(ordered) if x['id'] == expected)
        ranks.append({'query': qid, 'expected': expected, 'rank': rank, 'ordered': ordered})
    result.update(status='passed', embeddings=embeddings, rawResponses=raw_responses, labelledRanks=ranks, quality={'queries': len(ranks), 'top1': sum(x['rank'] == 1 for x in ranks)/len(ranks), 'top5': sum(x['rank'] <= 5 for x in ranks)/len(ranks), 'mrr': sum(1/x['rank'] for x in ranks)/len(ranks)}, contradictionCosine=sum(a*b for a,b in zip(embeddings['memory:allow'], embeddings['memory:deny'])), authenticationNegativeControl=True)
finally:
    process.terminate()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)
    log.close()
    (ROOT / 'model-server.log').write_text((ROOT / 'model-server.log').read_text().replace(secret, '[REDACTED]'))
    if sockpath.exists():
        sockpath.unlink()
    sockdir.rmdir()
    result.update(endedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), processStopped=process.poll() is not None)
    (ROOT / 'model-result.json').write_text(json.dumps(result, indent=2) + '\n')
assert result.get('status') == 'passed'
print(json.dumps({k: result[k] for k in ['status', 'quality', 'contradictionCosine', 'processStopped']}))
