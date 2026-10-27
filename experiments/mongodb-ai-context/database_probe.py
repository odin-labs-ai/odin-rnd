"""Actual pinned MongoDB adapters, plus a PostgreSQL exact-vector control.

Consumes recorded real model outputs. No inference or generative answers occur here.
The runner supplies fresh internal-network disposables and retains this worker's output.
"""
import datetime
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import time
import urllib.parse

from langchain_core.embeddings import Embeddings
from langchain_core.outputs import Generation
from langchain_mongodb.cache import MongoDBAtlasSemanticCache
from langgraph.store.mongodb import MongoDBStore, create_vector_index_config
from pymongo import MongoClient
import psycopg
from psycopg.rows import dict_row

from score_fixture import canonical, context

ROOT=Path('/work')
OUT=Path('/out')


def wait(label, fn, timeout=180):
    started=time.monotonic()
    last=None
    while time.monotonic()-started<timeout:
        try:
            value=fn()
            if value:return value
        except Exception as exc:
            last=type(exc).__name__
        time.sleep(1)
    raise RuntimeError(label+' visibility timeout; last exception class='+str(last))


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()


def main():
    label=sys.argv[1]
    assert label in ['251','252'], 'Only the two fixed repetition labels are allowed'
    OUT.mkdir(parents=True,exist_ok=True)
    fixture=json.loads((ROOT/'fixture.json').read_text())
    protocol=json.loads((ROOT/'protocol.json').read_text())
    recorded=json.loads((ROOT/'vectors.json').read_text())
    assert recorded['status']=='passed'
    assert hashlib.sha256(canonical(fixture)).hexdigest()==recorded['fixtureSha256']==protocol['fixtureSha256']
    assert hashlib.sha256((ROOT/'protocol.json').read_bytes()).hexdigest()==recorded['protocolSha256']
    vectors=recorded['embeddings']
    assert len(vectors)==64
    for v in vectors.values():
        assert len(v)==512 and all(math.isfinite(x) for x in v)
        assert abs(math.fsum(x*x for x in v)-1)<1e-10

    class RecordedVoyage(Embeddings):
        document_lookup={x['text']:vectors[x['id']] for x in fixture['inputs'] if x['role']=='document'}
        query_lookup={x['text']:vectors[x['id']] for x in fixture['inputs'] if x['role']=='query'}
        def embed_documents(self,texts):return [self.document_lookup[t] for t in texts]
        def embed_query(self,text):return self.query_lookup[text]

    queries={x['id']:x['text'] for x in fixture['inputs'] if x['role']=='query'}
    families={x['id']:x for x in fixture['families']}
    package_versions={p:importlib.metadata.version(p) for p in ['langchain-mongodb','langgraph-store-mongodb','langchain-core','pymongo','psycopg']}
    assert package_versions['langchain-mongodb']=='0.12.1' and package_versions['langgraph-store-mongodb']=='0.4.0'
    result=dict(schema='mongodb-context-adapter-result/1',status='running',repetitionLabel=label,repetitionMeaning='Same frozen fixture in a separately named fresh database; not an independent corpus or new model inference',startedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),command='python /work/database_probe.py '+label,sourceHashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['fixture.json','protocol.json','vectors.json','database_probe.py','score_fixture.py']},packages=package_versions,cache=[],postgresControl=[],memory={},limitations=protocol['interpretationLimits'])
    def save():
        (OUT/('database-result-'+label+'.json')).write_text(json.dumps(result,indent=2,default=str)+'\n')
    save()
    client=None
    conn=None
    try:
        client=MongoClient(os.environ['MONGO_URI'],serverSelectionTimeoutMS=10000)
        wait('MongoDB ping',lambda:client.admin.command('ping')['ok']==1)
        conn=psycopg.connect(os.environ['PG_URI'],autocommit=True,row_factory=dict_row)
        conn.execute('CREATE EXTENSION IF NOT EXISTS vector')
        table='context_memory_'+label
        conn.execute('CREATE TABLE '+table+' (tenant text NOT NULL, key text NOT NULL, value jsonb NOT NULL, embedding vector(512) NOT NULL, PRIMARY KEY(tenant,key))')
        db=client['context_probe_'+label]
        result['versions']={'mongodb':client.server_info()['version'],'postgresql':conn.execute('SHOW server_version').fetchone()['server_version'],'pgvector':conn.execute("SELECT extversion FROM pg_extension WHERE extname='vector'").fetchone()['extversion']}
        embed=RecordedVoyage()
        cache=MongoDBAtlasSemanticCache(os.environ['MONGO_URI'],embed,database_name=db.name,collection_name='semantic_cache',index_name='cache_vector',score_threshold=.8)
        cache.create_vector_search_index(dimensions=512,filters=['llm_string'],wait_until_complete=180)
        stored_keys=[]
        for family in fixture['families']:
            for arm in protocol['cacheArms']:
                key=context(family['id'],arm,'v1')
                cache.update(family['seedPrompt'],key,[Generation(text='YES')])
                stored_keys.append((family['id'],key))

        def cached_rows(family,key,vector):
            return list(db.semantic_cache.aggregate([{'$vectorSearch':{'index':'cache_vector','path':'embedding','queryVector':vector,'exact':True,'filter':{'llm_string':key},'limit':1}},{'$project':{'_id':0,'score':{'$meta':'vectorSearchScore'}}}]))

        wait('all seeded cache rows',lambda:all(len(cached_rows(f,k,vectors[f+':cached-prompt']))==1 for f,k in stored_keys))
        for case in fixture['cases']:
            vector=vectors[case['queryId']]
            cosine=math.fsum(a*b for a,b in zip(vector,vectors[case['family']+':cached-prompt']))
            score=(1+cosine)/2
            for threshold in protocol['thresholds']:
                cache.score_threshold=threshold
                for arm in protocol['cacheArms']:
                    key=context(case['family'],arm,case['trustedPolicyRevision'])
                    context_match=key==context(case['family'],arm,'v1')
                    expected_hit=context_match and score>=threshold
                    found=cache.lookup(queries[case['queryId']],key)
                    answers=[x.text for x in found] if found else []
                    direct=cached_rows(case['family'],key,vector)
                    observed=dict(**case,threshold=threshold,arm=arm,oracleCosine=cosine,oracleMongoScore=score,oracleHit=expected_hit,adapterAnswers=answers,actualExactScores=[x['score'] for x in direct],incompatibleReuse=bool(answers) and case['expectedAnswer']!='YES')
                    result['cache'].append(observed)
                    save()
                    assert answers==(['YES'] if expected_hit else []), 'Adapter/oracle mismatch: '+case['id']+' '+arm+' '+str(threshold)
                    if direct:assert abs(direct[0]['score']-score)<1e-5
        assert len(result['cache'])==240
        result['cacheStatus']='passed: all 240 actual adapter lookups agree with frozen arithmetic'
        save()
        print(json.dumps({'stage':'cache','status':'passed','lookups':240,'repetitionLabel':label}),flush=True)

        store=MongoDBStore(db.memories,index_config=create_vector_index_config(dims=512,embed=embed,fields=['text'],name='memory_vector'),auto_index_timeout=180)
        current={}
        for tenant in ['a','b']:
            for family in fixture['families']:
                key=family['id'];value={'tenant':tenant,'text':family['oldPolicy'],'revision':1}
                store.put(('tenant',tenant,'policies'),key,value)
                conn.execute('INSERT INTO '+table+' VALUES (%s,%s,%s::jsonb,%s::vector)',(tenant,key,json.dumps(value),json.dumps(vectors[key+':old-policy'])))
                current[(tenant,key)]=(value,vectors[key+':old-policy'])

        def search(tenant,query):return store.search(('tenant',tenant,'policies'),query=query,limit=20)
        def expected_score(query_id,tenant,key):
            return (1+math.fsum(a*b for a,b in zip(vectors[query_id],current[(tenant,key)][1])))/2
        initial_query=queries[fixture['families'][0]['id']+':memory-query']
        wait('all initial semantic memories',lambda:all(len(search(t,initial_query))==8 for t in ['a','b']))
        neighbor_before=list(db.memories.find({'namespace':['tenant','b','policies']}).sort('key',1))
        result['memory']['neighborBeforeSha256']=digest(neighbor_before)
        result['memory']['corrections']=[]

        def pg_control(stage,tenant):
            for family in fixture['families']:
                qid=family['id']+':memory-query';v=vectors[qid]
                rows=conn.execute('SELECT key,value,1-(embedding <=> %s::vector) AS cosine FROM '+table+' WHERE tenant=%s ORDER BY embedding <=> %s::vector,key LIMIT 5',(json.dumps(v),tenant,json.dumps(v))).fetchall()
                truth=sorted([{'key':key,'value':value,'cosine':math.fsum(a*b for a,b in zip(v,vec))} for (t,key),(value,vec) in current.items() if t==tenant],key=lambda r:(-r['cosine'],r['key']))[:5]
                result['postgresControl'].append(dict(stage=stage,tenant=tenant,query=qid,rows=rows,exhaustive=truth))
                assert [r['key'] for r in rows]==[r['key'] for r in truth]
                assert all(r['value']['tenant']==tenant for r in rows)
                assert all(abs(r['cosine']-e['cosine'])<1e-5 for r,e in zip(rows,truth))

        for tenant in ['a','b']:pg_control('before',tenant)
        for family in fixture['families']:
            key=family['id'];selector={'namespace':['tenant','a','policies'],'key':key}
            before=db.memories.find_one(selector)
            assert before is not None and before['embedding']==vectors[key+':old-policy']
            value={'tenant':'a','text':family['newPolicy'],'revision':2}
            store.put(('tenant','a','policies'),key,value)
            after=db.memories.find_one(selector)
            assert after['value']==value and after['embedding']==vectors[key+':new-policy']
            delta=max(abs(a-b) for a,b in zip(before['embedding'],after['embedding']))
            assert delta>1e-8
            conn.execute('UPDATE '+table+' SET value=%s::jsonb,embedding=%s::vector WHERE tenant=%s AND key=%s',(json.dumps(value),json.dumps(vectors[key+':new-policy']),'a',key))
            current[('a',key)]=(value,vectors[key+':new-policy'])
            result['memory']['corrections'].append(dict(key=key,beforeValue=before['value'],afterValue=after['value'],beforeEmbedding=before['embedding'],afterEmbedding=after['embedding'],maximumCoordinateChange=delta))
            save()

        def corrected_visible():
            rows=search('a',initial_query)
            qid=fixture['families'][0]['id']+':memory-query'
            return len(rows)==8 and all(r.value['revision']==2 and r.value['tenant']=='a' and abs(r.score-expected_score(qid,'a',r.key))<1e-5 for r in rows)
        wait('corrected semantic values and search scores',corrected_visible)
        result['memory']['semanticAfterCorrection']=[]
        for tenant in ['a','b']:
            for family in fixture['families']:
                qid=family['id']+':memory-query';rows=search(tenant,queries[qid])
                result['memory']['semanticAfterCorrection'].append(dict(tenant=tenant,query=qid,rows=[dict(key=r.key,namespace=r.namespace,value=r.value,score=r.score,expectedCurrentVectorScore=expected_score(qid,tenant,r.key)) for r in rows]))
                assert len(rows)==8
                assert {r.key for r in rows}==set(families)
                assert all(tuple(r.namespace)==('tenant',tenant,'policies') and r.value==current[(tenant,r.key)][0] for r in rows)
                assert all(abs(r.score-expected_score(qid,tenant,r.key))<1e-5 for r in rows), 'Search scores do not match the current recorded vectors'
            pg_control('corrected',tenant)
        result['memory']['staleVectorDiscrimination']=[]
        for family in fixture['families']:
            key=family['id']
            changes=[abs(math.fsum(a*b for a,b in zip(vectors[q['id']+':memory-query'],vectors[key+':old-policy']))-math.fsum(a*b for a,b in zip(vectors[q['id']+':memory-query'],vectors[key+':new-policy'])))/2 for q in fixture['families']]
            assert max(changes)>1e-5, 'Frozen queries cannot distinguish this old search vector at the declared score tolerance'
            result['memory']['staleVectorDiscrimination'].append(dict(key=key,maximumExpectedScoreChange=max(changes),scoreTolerance=1e-5))
        for family in fixture['families']:
            store.delete(('tenant','a','policies'),family['id'])
            assert store.get(('tenant','a','policies'),family['id']) is None
            del current[('a',family['id'])]
        conn.execute('DELETE FROM '+table+' WHERE tenant=%s',('a',))
        wait('all deleted memories absent from semantic search',lambda:all(not search('a',queries[f['id']+':memory-query']) for f in fixture['families']))
        neighbor_after=list(db.memories.find({'namespace':['tenant','b','policies']}).sort('key',1))
        assert neighbor_after==neighbor_before
        result['memory'].update(neighborAfterSha256=digest(neighbor_after),deletedDirectCount=db.memories.count_documents({'namespace':['tenant','a','policies']}),deletedSemanticQueries=8,neighborRecordsPreserved=len(neighbor_after))
        assert result['memory']['deletedDirectCount']==0
        for tenant in ['a','b']:pg_control('deleted',tenant)
        result['memoryStatus']='passed: eight persisted embeddings replaced, corrected search values/scores agree with current vectors and discriminate old vectors, deletion absent, eight neighboring records byte-preserved'
        assert len(result['postgresControl'])==48
        result['status']='passed'
    except Exception as exc:
        message=type(exc).__name__+': '+str(exc)
        for key in ['MONGO_URI','PG_URI']:
            uri=os.environ.get(key,'')
            if uri:
                message=message.replace(uri,'[REDACTED CONNECTION]')
                password=urllib.parse.urlparse(uri).password
                if password:message=message.replace(password,'[REDACTED]')
        result.update(status='failed',error=message)
        print(json.dumps({'status':'failed','error':message}),flush=True)
    finally:
        if conn is not None:conn.close()
        if client is not None:client.close()
        result['endedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
    print(json.dumps({'status':result['status'],'repetitionLabel':label,'actualCacheLookups':len(result['cache']),'postgresExactObservations':len(result['postgresControl'])}),flush=True)
    assert result['status']=='passed'


if __name__=='__main__':main()
