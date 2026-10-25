"""Identical real Voyage vectors in MongoDB/PostgreSQL; actual memory/cache adapters."""
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import time

from langchain_core.embeddings import Embeddings
from langchain_core.outputs import Generation
from langchain_mongodb.cache import MongoDBAtlasSemanticCache
from langgraph.store.mongodb import MongoDBStore, create_vector_index_config
from pymongo import MongoClient
from pymongo.operations import SearchIndexModel
import psycopg
from psycopg.rows import dict_row

os.umask(0o077)
ROOT = Path('/work')
OUT = Path('/out')
fixture = json.loads((ROOT / 'fixture.json').read_text())
model = json.loads((ROOT / 'model-result.json').read_text())
vectors = model['embeddings']
assert model['status'] == 'passed' and model['processStopped']
assert hashlib.sha256(json.dumps(fixture, sort_keys=True).encode()).hexdigest() == model['protocol']['fixtureSha256']
memory = fixture['memory']
document_vectors = {d['text']: vectors['doc:' + d['id']] for d in fixture['documents']}
document_vectors.update({text: vectors['memory:' + k] for k, text in memory.items() if 'query' not in k})
query_vectors = {q['text']: vectors['query:' + q['id']] for q in fixture['queries']}
query_vectors.update({text: vectors['memory:' + k] for k, text in memory.items() if 'query' in k})


class RecordedVoyage(Embeddings):
    """Reuse recorded real model outputs; no replacement embedding algorithm."""
    def embed_documents(self, texts):
        return [document_vectors[t] for t in texts]

    def embed_query(self, text):
        return query_vectors[text]


def wait(label, fn, seconds=180):
    start = time.monotonic()
    last = None
    while time.monotonic() - start < seconds:
        try:
            value = fn()
            if value:
                return value
        except Exception as exc:
            last = str(exc)
        time.sleep(1)
    raise RuntimeError(label + ' timeout: ' + str(last))


client = MongoClient(os.environ['MONGO_URI'], serverSelectionTimeoutMS=10000)
db = client.ai_semantic
conn = psycopg.connect(os.environ['PG_URI'], autocommit=True, row_factory=dict_row)
conn.execute('CREATE EXTENSION vector')
conn.execute('CREATE TABLE docs(id text PRIMARY KEY,tenant text NOT NULL,text text NOT NULL,embedding vector(512))')
docs = [{'id': tenant + ':' + d['id'], 'tenant': tenant, 'text': d['text'], 'embedding': vectors['doc:' + d['id']]} for tenant in ['a', 'b'] for d in fixture['documents']]
db.docs.insert_many(docs)
for d in docs:
    conn.execute('INSERT INTO docs VALUES (%s,%s,%s,%s::vector)', (d['id'], d['tenant'], d['text'], json.dumps(d['embedding'])))
db.docs.create_search_index(SearchIndexModel(name='exact_vector', type='vectorSearch', definition={'fields': [{'type': 'vector', 'path': 'embedding', 'numDimensions': 512, 'similarity': 'cosine'}, {'type': 'filter', 'path': 'tenant'}]}))
wait('vector index', lambda: any(i.get('queryable') for i in db.docs.list_search_indexes()))
result = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': 'python database_trial.py', 'modelProtocol': model['protocol'], 'recordedModelResultSha256': hashlib.sha256((ROOT / 'model-result.json').read_bytes()).hexdigest(), 'retrieval': [], 'limits': ['Functional exact-retrieval agreement, not ANN scaling, latency or cost comparison.', 'Researcher-authored closed-world corpus and labels; no independent human relevance judgement.', 'Namespaced synthetic clients; no production tenant authorization proof.', 'Real embedding inference, no generative LLM or Agent Engine extraction service.']}


def mongo_rows(vector, tenant):
    return list(db.docs.aggregate([{'$vectorSearch': {'index': 'exact_vector', 'path': 'embedding', 'queryVector': vector, 'exact': True, 'filter': {'tenant': tenant}, 'limit': 5}}, {'$project': {'_id': 0, 'id': 1, 'tenant': 1, 'score': {'$meta': 'vectorSearchScore'}}}]))


for tenant in ['a', 'b']:
    for q in fixture['queries']:
        vector = vectors['query:' + q['id']]
        truth = sorted((d for d in docs if d['tenant'] == tenant), key=lambda d: (-sum(a*b for a,b in zip(vector, d['embedding'])), d['id']))[:5]
        expected_ids = [d['id'] for d in truth]
        mongo = wait('document index population', lambda: mongo_rows(vector, tenant))
        pg = [dict(x) for x in conn.execute('SELECT id,tenant,1-(embedding <=> %s::vector) AS score FROM docs WHERE tenant=%s ORDER BY embedding <=> %s::vector,id LIMIT 5', (json.dumps(vector), tenant, json.dumps(vector))).fetchall()]
        for engine, rows in [('mongo', mongo), ('postgres', pg)]:
            assert [x['id'] for x in rows] == expected_ids, (engine, q['id'], rows, expected_ids)
            assert all(x['tenant'] == tenant for x in rows)
            result['retrieval'].append({'engine': engine, 'tenant': tenant, 'query': q['id'], 'expectedRelevantId': tenant + ':' + q['expected'], 'exhaustiveTop5': expected_ids, 'rows': rows})

embed = RecordedVoyage()
store = MongoDBStore(db.memories, index_config=create_vector_index_config(dims=512, embed=embed, fields=['text'], name='memory_vector'), auto_index_timeout=180)
for tenant, content, owner in [('a', memory['old-a'], 'Mara'), ('b', memory['b'], 'Nia')]:
    store.put(('tenant', tenant, 'memory'), 'owner', {'text': content, 'owner': owner, 'tenant': tenant, 'version': 1})


def search(tenant):
    return store.search(('tenant', tenant), query=memory['query'], limit=3)


before = {}
for tenant, owner in [('a', 'Mara'), ('b', 'Nia')]:
    found = wait('memory population', lambda: search(tenant))
    assert len(found) == 1 and found[0].value['owner'] == owner and found[0].value['tenant'] == tenant
    before[tenant] = [x.value for x in found]
store.put(('tenant', 'a', 'memory'), 'owner', {'text': memory['new-a'], 'owner': 'Ivo', 'tenant': 'a', 'version': 2})


def corrected():
    found = search('a')
    return found if len(found) == 1 and found[0].value['owner'] == 'Ivo' else None


after = wait('corrected memory searchable', corrected)
assert [x.value for x in search('b')] == before['b']
store.delete(('tenant', 'a', 'memory'), 'owner')
wait('memory delete search visibility', lambda: not search('a'))
assert store.get(('tenant', 'a', 'memory'), 'owner') is None
assert [x.value for x in search('b')] == before['b']
result['memoryLifecycle'] = {'before': before, 'corrected': [x.value for x in after], 'deletedSearch': [x.value for x in search('a')], 'neighborAfter': [x.value for x in search('b')], 'source': 'official MongoDBStore using recorded real Voyage embeddings'}

cache = MongoDBAtlasSemanticCache(os.environ['MONGO_URI'], embed, database_name='ai_semantic', collection_name='cache', index_name='cache_vector', score_threshold=.8)
cache.create_vector_search_index(dimensions=512, filters=['llm_string'], wait_until_complete=180)
context = json.dumps({'tenant': 'a', 'model': 'fixture-answer-v1', 'policy': 'v1', 'corpus': 'v1'}, sort_keys=True)
next_context = json.dumps({'tenant': 'a', 'model': 'fixture-answer-v1', 'policy': 'v2', 'corpus': 'v2'}, sort_keys=True)
cache.update(memory['allow'], context, [Generation(text='AUTOMATIC RESTART ALLOWED')])
wait('cache population', lambda: len(list(db.cache.aggregate([{'$vectorSearch': {'index': 'cache_vector', 'path': 'embedding', 'queryVector': vectors['memory:allow-query'], 'exact': True, 'filter': {'llm_string': context}, 'limit': 1}}]))) == 1)
cache_checks = []
for threshold in [.8, .9, .95]:
    cache.score_threshold = threshold
    answer = cache.lookup(memory['deny-query'], context)
    new_answer = cache.lookup(memory['deny-query'], next_context)
    assert new_answer is None
    cache_checks.append({'threshold': threshold, 'query': memory['deny-query'], 'cachedPrompt': memory['allow'], 'oldContextAnswer': [x.text for x in answer] if answer else [], 'newPolicyCorpusContextAnswer': [], 'interpretation': 'A hit reuses an opposite-permission fixture answer. Similarity alone is not an entailment or policy-validity test; no threshold is selected from these results.'})
result['cacheContradictionChecks'] = cache_checks
result['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
result['status'] = 'passed'
(OUT / 'integration-result.json').write_text(json.dumps(result, indent=2, default=str) + '\n')
print(json.dumps({'status': result['status'], 'assertedExactRetrievalObservations': len(result['retrieval']), 'cacheChecks': cache_checks}))
conn.close()
client.close()
