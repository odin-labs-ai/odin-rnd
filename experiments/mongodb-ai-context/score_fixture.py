"""Independent arithmetic on retained model coordinates; no database result implied."""
import datetime
import hashlib
import json
import math
from pathlib import Path
import uuid

ROOT=Path(__file__).resolve().parent


def canonical(obj):
    return json.dumps(obj,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()


def context(family, arm, revision):
    obj={'fixtureFamily':family,'model':'authored-answer-v1'}
    if arm=='trusted-tenant-model-policy-corpus':
        obj.update(tenant='a',policy=revision,corpus=revision)
    return json.dumps(obj,sort_keys=True,separators=(',',':'))


def main():
    latest=json.loads((ROOT/'latest-inference.json').read_text())
    assert latest['status']=='passed'
    source=ROOT/latest['path']/'embeddings.json'
    model=json.loads(source.read_text());fixture=json.loads((ROOT/'fixture.json').read_text());protocol=json.loads((ROOT/'protocol.json').read_text())
    assert model['status']=='passed' and model['processStopped'] and model['unauthenticatedRequestRejected']
    assert hashlib.sha256(canonical(fixture)).hexdigest()==protocol['fixtureSha256']==model['fixtureSha256']
    vectors={}
    for batch in model['rawResponses']:
        records=sorted(batch['response']['data'],key=lambda r:r['index'])
        for key,record in zip(batch['ids'],records):
            raw=record['embedding'];assert len(raw)==2048 and all(math.isfinite(x) for x in raw)
            v=raw[:512];norm=math.sqrt(math.fsum(x*x for x in v));vector=[x/norm for x in v]
            assert vector==model['embeddings'][key]
            assert abs(math.fsum(x*x for x in vector)-1)<1e-12
            assert key not in vectors;vectors[key]=vector
    assert len(vectors)==64
    observations=[]
    for case in fixture['cases']:
        cosine=math.fsum(a*b for a,b in zip(vectors[case['family']+':cached-prompt'],vectors[case['queryId']]))
        score=(1+cosine)/2
        for threshold in protocol['thresholds']:
            for arm in protocol['cacheArms']:
                stored=context(case['family'],arm,'v1');requested=context(case['family'],arm,case['trustedPolicyRevision'])
                hit=stored==requested and score>=threshold
                observations.append(dict(**case,threshold=threshold,arm=arm,cosine=cosine,mongoCosineScore=score,contextMatched=stored==requested,oracleHit=hit,oracleReturnedAnswer='YES' if hit else None,incompatibleReuse=hit and case['expectedAnswer']!='YES',validHit=hit and case['expectedAnswer']=='YES'))
    summaries=[]
    for threshold in protocol['thresholds']:
        for arm in protocol['cacheArms']:
            rows=[r for r in observations if r['threshold']==threshold and r['arm']==arm]
            summaries.append(dict(threshold=threshold,arm=arm,cases=len(rows),hits=sum(r['oracleHit'] for r in rows),incompatibleReuses=sum(r['incompatibleReuse'] for r in rows),validHits=sum(r['validHit'] for r in rows),validOpportunities=sum(r['expectedAnswer']=='YES' for r in rows),incompatibleByVariant={v:sum(r['incompatibleReuse'] for r in rows if r['variant']==v) for v in sorted({r['variant'] for r in rows})}))
    out=ROOT/('analysis-'+uuid.uuid4().hex[:10]);out.mkdir(mode=0o700)
    report=dict(schema='context-score-diagnostic/1',status='passed',checkedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),command='python3 score_fixture.py',inferenceSource=latest['path']+'/embeddings.json',inferenceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),fixtureSha256=protocol['fixtureSha256'],counts=protocol['counts'],observations=observations,summaries=summaries,databaseExecution='NOT RUN by this arithmetic audit; adapter results must be recorded separately',limitations=protocol['interpretationLimits'])
    (out/'score-result.json').write_text(json.dumps(report,indent=2)+'\n')
    compact=dict(schema='recorded-voyage-vectors/1',status='passed',protocolSha256=hashlib.sha256((ROOT/'protocol.json').read_bytes()).hexdigest(),fixtureSha256=protocol['fixtureSha256'],inferenceSha256=report['inferenceSha256'],model=model['modelSha256'],embeddings=vectors)
    (ROOT/'vectors.json').write_text(json.dumps(compact,separators=(',',':'))+'\n')
    (ROOT/'latest-analysis.json').write_text(json.dumps(dict(path=out.name,status='passed'),indent=2)+'\n')
    print(json.dumps(dict(status='passed',run=out.name,embeddingsAudited=len(vectors),oracleCases=len(observations),summaries=summaries)))


if __name__=='__main__':main()
