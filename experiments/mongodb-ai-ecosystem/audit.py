"""Recalculate the public observation packet using only the Python standard library."""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'site/data/mongodb-ai-ecosystem'
read = lambda name: json.loads((ROOT / name).read_text())
fixture, model, integration, summary = [read(n) for n in ['fixture.json', 'model-result.json', 'integration-result.json', 'summary.json']]
assert model['protocol']['revision'] == 2 and model['status'] == integration['status'] == 'passed'
assert hashlib.sha256(json.dumps(fixture, sort_keys=True).encode()).hexdigest() == model['protocol']['fixtureSha256']
assert len(model['embeddings']) == 36
for batch in model['rawResponses']:
    for key, row in zip(batch['keys'], sorted(batch['response']['data'], key=lambda x: x['index'])):
        raw = row['embedding'][:512]
        norm = math.sqrt(sum(x*x for x in raw))
        assert all(abs(a-b/norm) < 1e-12 for a, b in zip(model['embeddings'][key], raw))
vectors = model['embeddings']
ranks = {}
for q in fixture['queries']:
    ordered = sorted(fixture['documents'], key=lambda d: (-sum(a*b for a,b in zip(vectors['query:' + q['id']], vectors['doc:' + d['id']])), d['id']))
    ranks[q['id']] = next(i+1 for i,d in enumerate(ordered) if d['id'] == q['expected'])
assert sum(v == 1 for v in ranks.values()) == 11 and all(v <= 5 for v in ranks.values())
assert model['quality']['top1'] == 11/12 and model['quality']['mrr'] == sum(1/r for r in ranks.values())/12
assert len(integration['retrieval']) == 48
assert len({(x['engine'], x['tenant'], x['query']) for x in integration['retrieval']}) == 48
for obs in integration['retrieval']:
    qvec = vectors['query:' + obs['query']]
    expected = sorted(fixture['documents'], key=lambda d: (-sum(a*b for a,b in zip(qvec, vectors['doc:' + d['id']])), d['id']))[:5]
    assert [r['id'] for r in obs['rows']] == [obs['tenant'] + ':' + d['id'] for d in expected]
    for row, doc in zip(obs['rows'], expected):
        cosine = sum(a*b for a,b in zip(qvec, vectors['doc:' + doc['id']]))
        score = (1+cosine)/2 if obs['engine'] == 'mongo' else cosine
        assert abs(row['score']-score) < 2e-5
        assert row['tenant'] == obs['tenant']
memory = integration['memoryLifecycle']
assert memory['before']['a'][0]['owner'] == 'Mara' and memory['before']['b'][0]['owner'] == 'Nia'
assert memory['corrected'][0]['owner'] == 'Ivo' and memory['corrected'][0]['version'] == 2
assert memory['deletedSearch'] == [] and memory['neighborAfter'] == memory['before']['b']
cosine = sum(a*b for a,b in zip(vectors['memory:allow'], vectors['memory:deny-query']))
checks = integration['cacheContradictionChecks']
assert [r['threshold'] for r in checks] == [.8, .9, .95]
assert [bool(r['oldContextAnswer']) for r in checks] == [((1+cosine)/2 >= r['threshold']) for r in checks]
assert all(r['newPolicyCorpusContextAnswer'] == [] for r in checks)
workflows = read('workflow-recovery.json')
assert len(workflows['workflowRecoveries']) == 8
for row in workflows['workflowRecoveries']:
    assert row['workerExit'] == 73 and row['effectAttempts'] == 2 and row['effectRecords'] == 1
    stem = f"workflow-receipts/{row['engine']}-{row['repetition']}-{row['tenant']}"
    prep, crash, resume = [read(stem + '-' + phase + '.json') for phase in ['prepare', 'crash', 'resume']]
    assert prep['pid'] != resume['pid']
    assert crash['effectAcknowledged'] and crash['exitCode'] == 73
    assert prep['after']['next'] == resume['before']['next'] == ['tool']
    assert 'effect' not in resume['before']['values'] and resume['after']['next'] == []
    assert resume['after']['values']['answer'] == row['tenant'] + ':policy-' + row['tenant']
    own = [r for r in resume['effects'] if r['tenant'] == row['tenant']]
    assert len(own) == 1 and own[0]['attempts'] == 2
source = Path(__file__).resolve().parent
for name, digest in json.loads((source / 'source-manifest.json').read_text()).items():
    assert hashlib.sha256((source / name).read_bytes()).hexdigest() == digest, name
for name, digest in read('workflow-phases.json')['sourceHashes'].items():
    assert hashlib.sha256((source / 'previous' / name).read_bytes()).hexdigest() == digest, name
for name, digest in read('evidence-manifest.json')['sha256'].items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
print(json.dumps({'status': 'passed', 'labelledQuestions': len(ranks), 'top1': 11, 'exactRetrievalObservations': 48, 'workflowRecoveries': 8, 'cacheQueryDocumentCosine': cosine, 'cacheMongoScore': (1+cosine)/2}))
