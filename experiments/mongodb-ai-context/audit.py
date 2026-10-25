"""Separate calculation on downloaded observations, not an independent runtime replay."""
import datetime
import hashlib
import json
import math
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    artifacts=Path(sys.argv[1]).resolve()
    runtime=json.loads((artifacts/'runtime-receipt.json').read_text())
    assert runtime['status']=='passed'
    assert runtime['manifestSha256']=='2aa195f0d32b743ef949a49dc382ca0fc12408003f325f1ddadd1a16554e596a'
    assert runtime['networkRemoved'] and len(runtime['cleanup'])==4 and all(r['removed'] for r in runtime['cleanup'])
    prefix='mai-context-'+runtime['runId']+'-'+runtime['runAttempt']
    assert {r['container'] for r in runtime['cleanup']}=={prefix+'-'+kind for kind in ['mongo','postgres','worker','filesystem-baseline']}
    assert all(not d['portBindings'] for d in runtime['isolation'].values())
    ready=next(r for r in runtime['resources'] if r['stage']=='ready')
    for kind,cap in [('mongo',1024),('postgres',256),('worker',256)]:
        assert ready['containers'][kind]['state']['pidsLimit']==cap
        assert not ready['containers'][kind]['state']['oomKilled']
    storage=ready['containers']['mongo'];fs=storage['searchFilesystem'];metric=storage['diskMetrics']
    assert fs['filesystemType']=='tmpfs' and fs['blockSize']*fs['blocks']==512*1024*1024
    assert metric['totalBytes']==512*1024*1024 and 0<=metric['freeBytes']<=metric['totalBytes']
    assert abs(metric['usedFraction']-(1-metric['freeBytes']/metric['totalBytes']))<1e-12 and metric['usedFraction']<.8
    assert storage['searchMount']=={'/data/mongot':'rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700'}
    for name,digest in runtime['artifacts'].items():assert sha(artifacts/name)==digest,name
    fixture=json.loads((ROOT/'fixture.json').read_text())
    protocol=json.loads((ROOT/'protocol.json').read_text())
    vectors=json.loads((ROOT/'vectors.json').read_text())['embeddings']
    cases={x['id']:x for x in fixture['cases']}
    families={x['id']:x for x in fixture['families']}
    cosine=lambda a,b:math.fsum(x*y for x,y in zip(a,b))
    results=[]
    for label in ['251','252']:
        path=artifacts/('database-result-'+label+'.json')
        result=json.loads(path.read_text())
        assert result['status']=='passed' and result['repetitionLabel']==label
        for name,digest in result['sourceHashes'].items():assert digest==runtime['payload']['files'][name]
        assert result['sourceHashes']['fixture.json']==sha(ROOT/'fixture.json')
        assert result['sourceHashes']['protocol.json']==sha(ROOT/'protocol.json')
        assert result['sourceHashes']['vectors.json']==sha(ROOT/'vectors.json')
        assert len(result['cache'])==240
        seen=set()
        for row in result['cache']:
            case=cases[row['id']]
            assert all(row[k]==v for k,v in case.items())
            key=(row['id'],row['arm'],row['threshold']);assert key not in seen;seen.add(key)
            assert row['arm'] in protocol['cacheArms'] and row['threshold'] in protocol['thresholds']
            raw=cosine(vectors[case['family']+':cached-prompt'],vectors[case['queryId']]);score=(1+raw)/2
            match=row['arm']=='model-only' or case['trustedPolicyRevision']=='v1'
            hit=match and score>=row['threshold']
            assert abs(row['oracleCosine']-raw)<1e-12 and abs(row['oracleMongoScore']-score)<1e-12
            assert row['adapterAnswers']==(['YES'] if hit else [])
            assert row['incompatibleReuse']==(hit and case['expectedAnswer']!='YES')
            assert row['oracleHit']==hit
            assert len(row['actualExactScores'])==(1 if match else 0)
            assert all(abs(x-score)<1e-5 for x in row['actualExactScores'])
        summaries=[]
        for threshold in protocol['thresholds']:
            for arm in protocol['cacheArms']:
                rows=[x for x in result['cache'] if x['threshold']==threshold and x['arm']==arm]
                assert len(rows)==40
                summaries.append(dict(threshold=threshold,arm=arm,cases=40,hits=sum(bool(x['adapterAnswers']) for x in rows),incompatibleReuses=sum(x['incompatibleReuse'] for x in rows),validHits=sum(bool(x['adapterAnswers']) and x['expectedAnswer']=='YES' for x in rows),validOpportunities=sum(x['expectedAnswer']=='YES' for x in rows)))
        memory=result['memory'];assert len(memory['corrections'])==8
        assert {r['key'] for r in memory['corrections']}==set(families)
        for row in memory['corrections']:
            key=row['key'];family=families[key]
            assert row['beforeValue']==dict(tenant='a',text=family['oldPolicy'],revision=1)
            assert row['afterValue']==dict(tenant='a',text=family['newPolicy'],revision=2)
            assert row['beforeEmbedding']==vectors[key+':old-policy']
            assert row['afterEmbedding']==vectors[key+':new-policy']
            assert max(abs(a-b) for a,b in zip(row['beforeEmbedding'],row['afterEmbedding']))>1e-8
        assert len(memory['semanticAfterCorrection'])==16
        observed=set()
        for observation in memory['semanticAfterCorrection']:
            tenant,qid=observation['tenant'],observation['query'];identity=(tenant,qid);assert identity not in observed;observed.add(identity)
            assert tenant in ['a','b'] and qid in [key+':memory-query' for key in families]
            assert len(observation['rows'])==8 and {x['key'] for x in observation['rows']}==set(families)
            for row in observation['rows']:
                family=families[row['key']];version=2 if tenant=='a' else 1
                assert row['namespace']==['tenant',tenant,'policies']
                assert row['value']==dict(tenant=tenant,text=family['newPolicy'] if version==2 else family['oldPolicy'],revision=version)
                score=(1+cosine(vectors[qid],vectors[family['id']+(':new-policy' if version==2 else ':old-policy')]))/2
                assert abs(row['score']-score)<1e-5 and abs(row['expectedCurrentVectorScore']-score)<1e-12
        assert len(memory['staleVectorDiscrimination'])==8 and {x['key'] for x in memory['staleVectorDiscrimination']}==set(families)
        for row in memory['staleVectorDiscrimination']:
            key=row['key'];maximum=max(abs(cosine(vectors[q+':memory-query'],vectors[key+':old-policy'])-cosine(vectors[q+':memory-query'],vectors[key+':new-policy']))/2 for q in families)
            assert abs(row['maximumExpectedScoreChange']-maximum)<1e-12 and maximum>row['scoreTolerance']==1e-5
        assert memory['deletedDirectCount']==0 and memory['deletedSemanticQueries']==8 and memory['neighborRecordsPreserved']==8
        assert memory['neighborBeforeSha256']==memory['neighborAfterSha256']
        assert len(result['postgresControl'])==48
        observed=set()
        for observation in result['postgresControl']:
            stage,tenant,qid=observation['stage'],observation['tenant'],observation['query'];identity=(stage,tenant,qid);assert identity not in observed;observed.add(identity)
            assert stage in ['before','corrected','deleted'] and tenant in ['a','b']
            assert qid in [key+':memory-query' for key in families]
            expected=[]
            if not(stage=='deleted' and tenant=='a'):
                new=stage!='before' and tenant=='a'
                for key,family in families.items():
                    value=dict(tenant=tenant,text=family['newPolicy'] if new else family['oldPolicy'],revision=2 if new else 1)
                    expected.append(dict(key=key,value=value,cosine=cosine(vectors[qid],vectors[key+(':new-policy' if new else ':old-policy')])))
                expected=sorted(expected,key=lambda x:(-x['cosine'],x['key']))[:5]
            assert [r['key'] for r in observation['rows']]==[r['key'] for r in expected]
            for row,truth in zip(observation['rows'],expected):
                assert row['value']==truth['value'] and abs(row['cosine']-truth['cosine'])<1e-5
        results.append(dict(repetitionLabel=label,resultSha256=sha(path),cacheLookups=240,postgresExactObservations=48,updatedMemoryVectors=8,indexScoreObservations=128,summaries=summaries))
    assert results[0]['summaries']==results[1]['summaries']
    report=dict(status='passed',checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),command='python3 audit_adapter_results.py <downloaded-artifact-root>',scope='Separate arithmetic on saved observations and source/hash/cleanup checks; not an independent database execution or production authorization proof',runId=runtime['runId'],runAttempt=runtime['runAttempt'],executionRevision=runtime['sourceRevision'],manifestSha256=runtime['manifestSha256'],repetitions=results,resources=runtime.get('resources',[]),defaultSearchFilesystem=runtime['defaultSearchFilesystem'],earlierAttempts=['40232379286 and40233143414 failed beforesemanticobservations; both retained separately'],notes=['Two repeats of the same authored fixture are not independent corpora.', 'Neighbor full-document preservation is attested by the live worker equality assertion plus equal before/after digests; raw neighbor documents are not independently reconstructed by this audit.', 'The search index uses a disposable bounded RAM filesystem; this is not an index-durability or production-storage result.'])
    # Public reproduction is read-only; redirect stdout to save a separate report.
    print(json.dumps({k:report[k] for k in ['status','runId','manifestSha256','repetitions']}))


if __name__=='__main__':main()
