"""Framework retrieval/cache plumbing with synthetic vectors; no semantic-quality claim."""
import datetime
import hashlib
import inspect
import json
import os
from pathlib import Path
import time

from langchain_core.embeddings import Embeddings
from langchain_core.outputs import Generation
from langchain_mongodb import MongoDBAtlasVectorSearch
from langchain_mongodb.cache import MongoDBCache, MongoDBAtlasSemanticCache
from langchain_mongodb.retrievers import MongoDBAtlasHybridSearchRetriever
from langgraph.store.mongodb import MongoDBStore, create_vector_index_config
from pymongo import MongoClient
from pymongo.operations import SearchIndexModel

os.umask(0o077)
OUT = Path(os.environ['TRIAL_OUTPUT'])
URI = os.environ['MONGO_URI']
client = MongoClient(URI, serverSelectionTimeoutMS=10000)
db = client.ai_probe
result = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'embedding': 'four-dimensional deterministic keyword fixture; no trained model, semantic-quality or cost claim'}


class FixtureEmbeddings(Embeddings):
    def embed_documents(self, texts):
        return [self.embed_query(t) for t in texts]

    def embed_query(self, text):
        topic = next((i for i, word in enumerate(['rotation', 'recovery', 'handoff']) if word in text.lower()), 3)
        return [1.0 if i == topic else 0.01 for i in range(4)]


embed = FixtureEmbeddings()


def wait(label, fn, seconds=180):
    started = time.monotonic()
    errors = []
    while time.monotonic() - started < seconds:
        try:
            value = fn()
            if value:
                return value
        except Exception as exc:
            errors.append(type(exc).__name__ + ': ' + str(exc)[:400])
        time.sleep(1)
    raise RuntimeError(label + ' not ready: ' + json.dumps(errors[-3:]))


def cache_text(cache, prompt, model):
    row = cache.lookup(prompt, model)
    return row[0].text if row else None


def model_key(tenant, corpus='v1'):
    return json.dumps({'tenant': tenant, 'model': 'fixture-v1', 'policy': 'v1', 'corpus': corpus}, sort_keys=True)


prompt = 'rotation owner'
exact = MongoDBCache(URI, database_name='ai_probe', collection_name='exact_shared')
exact.update(prompt, 'fixture-v1', [Generation(text='private-A')])
negative_exact = cache_text(exact, prompt, 'fixture-v1')
assert negative_exact == 'private-A'
exact.update(prompt, 'fixture-v1', [Generation(text='private-B')])
assert cache_text(exact, prompt, 'fixture-v1') == 'private-B'
scoped_exact = {}
for tenant in ['a', 'b']:
    cache = MongoDBCache(URI, database_name='ai_probe', collection_name='exact_' + tenant)
    cache.update(prompt, 'fixture-v1', [Generation(text='private-' + tenant)])
    cache.close()
    cache = MongoDBCache(URI, database_name='ai_probe', collection_name='exact_' + tenant)
    assert cache_text(cache, prompt, 'fixture-v1') == 'private-' + tenant
    assert cache_text(cache, prompt, 'fixture-v2') is None
    scoped_exact[tenant] = cache
scoped_exact['a'].clear()
assert cache_text(scoped_exact['a'], prompt, 'fixture-v1') is None
assert cache_text(scoped_exact['b'], prompt, 'fixture-v1') == 'private-b'
result['exactCache'] = {'sharedCollectionNegativeControl': {'observedByCallerB': negative_exact, 'overwriteAffectingCallerA': 'private-B'}, 'tenantCollectionsReopenAndLookup': True, 'changedModelMiss': True, 'clearTenantAKeepsB': True, 'boundary': 'application-selected collection; synthetic privileged DB client, not production identity authorization'}

semantic = MongoDBAtlasSemanticCache(URI, embed, database_name='ai_probe', collection_name='semantic_cache', index_name='cache_vector', score_threshold=.99)
semantic.create_vector_search_index(dimensions=4, filters=['llm_string'], wait_until_complete=180)
semantic.update(prompt, 'fixture-v1', [Generation(text='private-A')])
wait('shared semantic cache', lambda: cache_text(semantic, prompt, 'fixture-v1') == 'private-A')
negative_semantic = cache_text(semantic, 'rotation responsibility', 'fixture-v1')
assert negative_semantic == 'private-A'
for tenant in ['a', 'b']:
    semantic.update(prompt, model_key(tenant), [Generation(text='private-' + tenant)])
    wait('scoped semantic ' + tenant, lambda: cache_text(semantic, prompt, model_key(tenant)) == 'private-' + tenant)
assert cache_text(semantic, prompt, model_key('a', corpus='v2')) is None
assert cache_text(semantic, 'recovery owner', model_key('a')) is None
semantic.clear(llm_string=model_key('a'))
wait('semantic delete visibility', lambda: cache_text(semantic, prompt, model_key('a')) is None)
assert cache_text(semantic, prompt, model_key('b')) == 'private-b'
result['semanticCache'] = {'sharedCollectionNegativeControl': {'observedByCallerB': negative_semantic}, 'trustedTenantModelPolicyCorpusKeys': True, 'newCorpusVersionMiss': True, 'differentTopicMiss': True, 'deleteTenantAKeepsB': True, 'boundary': 'caller-generated trusted context key, not authenticated tenant access; deterministic identical-topic vectors'}

docs = []
topics = ['rotation RKEY742 credential renewal', 'recovery RCV918 snapshot restore', 'handoff HND635 work transfer', 'approval APR264 review gate']
for tenant in ['a', 'b']:
    for i, text in enumerate(topics):
        docs.append({'_id': tenant + '-' + str(i), 'tenant': tenant, 'text': text, 'embedding': embed.embed_query(text)})
db.retrieval.insert_many(docs)
db.retrieval.create_search_index(SearchIndexModel(name='retrieval_vector', type='vectorSearch', definition={'fields': [{'type': 'vector', 'path': 'embedding', 'numDimensions': 4, 'similarity': 'cosine'}, {'type': 'filter', 'path': 'tenant'}]}))
db.retrieval.create_search_index(SearchIndexModel(name='retrieval_text', definition={'mappings': {'dynamic': False, 'fields': {'text': {'type': 'string', 'analyzer': 'lucene.standard'}, 'tenant': {'type': 'token'}}}}))
wait('retrieval indexes', lambda: len(list(db.retrieval.list_search_indexes())) == 2 and all(i.get('queryable') for i in db.retrieval.list_search_indexes()))
vector = MongoDBAtlasVectorSearch(db.retrieval, embed, index_name='retrieval_vector')
rows = []
for tenant in ['a', 'b']:
    hybrid = MongoDBAtlasHybridSearchRetriever(vectorstore=vector, search_index_name='retrieval_text', k=1, pre_filter={'tenant': {'$eq': tenant}}, auto_create_index=False)
    for i, text in enumerate(topics):
        query = text.split()[0] + ' ' + text.split()[1]
        v = wait('vector population', lambda: vector.similarity_search(query, k=1, pre_filter={'tenant': {'$eq': tenant}}))
        h = wait('hybrid population', lambda: hybrid.invoke(query))
        for mode, found in [('vector', v), ('hybrid', h)]:
            assert len(found) == 1 and found[0].metadata['tenant'] == tenant
            assert found[0].page_content == text
            rows.append({'tenant': tenant, 'mode': mode, 'query': query, 'text': found[0].page_content, 'metadata': found[0].metadata})
# Explicitly probe lexical arm with a vector pointing elsewhere: tests routing, not relevance.
class WrongTopic(FixtureEmbeddings):
    def embed_query(self, text):
        return [0.01, 1.0, 0.01, 0.01]

wrong_vector = MongoDBAtlasVectorSearch(db.retrieval, WrongTopic(), index_name='retrieval_vector')
lexical = MongoDBAtlasHybridSearchRetriever(vectorstore=wrong_vector, search_index_name='retrieval_text', k=1, vector_weight=0, fulltext_weight=1, pre_filter={'tenant': {'$eq': 'a'}}, auto_create_index=False)
lexical_rows = lexical.invoke('RKEY742')
assert len(lexical_rows) == 1 and lexical_rows[0].metadata['tenant'] == 'a' and lexical_rows[0].page_content == topics[0]
result['retrieval'] = {'fixture': docs, 'observations': rows, 'lexicalArmWithWrongVector': {'query': 'RKEY742', 'text': lexical_rows[0].page_content, 'tenant': lexical_rows[0].metadata['tenant']}, 'indexDefinitions': list(db.retrieval.list_search_indexes()), 'limits': 'No PostgreSQL matched retrieval trial here; no real embedding model or held-out natural-language relevance labels.'}

# The official long-term Store semantic path, rather than a hand-written query.
store = MongoDBStore(db.semantic_memory, index_config=create_vector_index_config(dims=4, embed=embed, fields=['text'], name='memory_vector'), auto_index_timeout=180)
for tenant in ['a', 'b']:
    store.put(('tenant', tenant, 'knowledge'), 'rotation', {'tenant': tenant, 'text': 'rotation owner', 'owner': tenant + '-owner'})
semantic_memory = {}
for tenant in ['a', 'b']:
    def search_memory():
        r = store.search(('tenant', tenant), query='rotation responsibility', limit=1)
        return r if r else None
    found = wait('long-term semantic memory', search_memory)
    assert len(found) == 1 and found[0].value['tenant'] == tenant
    semantic_memory[tenant] = [{'namespace': r.namespace, 'key': r.key, 'value': r.value, 'score': r.score} for r in found]
result['semanticMemory'] = semantic_memory
result['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
(OUT / 'retrieval-cache.json').write_text(json.dumps(result, indent=2, default=str) + '\n')
print(json.dumps({'status': 'passed', 'adapterRetrievalExecutions': len(rows), 'cacheNegativeControlsReproduced': ['exact', 'semantic'], 'semanticMemoryTenants': len(semantic_memory)}))
