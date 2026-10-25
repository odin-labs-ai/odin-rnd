"""Freeze authored cases and hypotheses before any new inference or adapter run."""
import datetime
import hashlib
import json
import os
from pathlib import Path

os.umask(0o077)
ROOT = Path(__file__).resolve().parent
ROOT.chmod(0o700)
FAMILIES = [
    ('restart', 'The amber service may restart automatically after a failed readiness probe.', 'The amber service must not restart automatically after a failed readiness probe.', 'May the amber service restart automatically after a failed readiness probe?', 'Is an unattended restart allowed when the amber readiness check fails?', 'Is an automatic restart forbidden after a failed amber readiness probe?'),
    ('contacts', 'Raw customer contact details may be exported to the external analytics service.', 'Raw customer contact details must not be exported to the external analytics service.', 'May raw customer contact details be exported to the external analytics service?', 'Is it permitted to send unredacted customer contact data to the analytics provider?', 'Is exporting raw customer contact details to the external analytics service forbidden?'),
    ('retention', 'Security audit logs may be deleted after seven days.', 'Security audit logs must not be deleted after seven days.', 'May security audit logs be deleted after seven days?', 'Is removing security audit records a week after creation permitted?', 'Is deleting security audit logs after seven days forbidden?'),
    ('refund', 'Refunds above one hundred euros may be issued without human approval.', 'Refunds above one hundred euros must not be issued without human approval.', 'May refunds above one hundred euros be issued without human approval?', 'Can a refund larger than one hundred euros be sent without a person approving it?', 'Is issuing refunds above one hundred euros without human approval forbidden?'),
    ('backup', 'Customer backups may be copied to a region outside the European Union.', 'Customer backups must not be copied to a region outside the European Union.', 'May customer backups be copied to a region outside the European Union?', 'Is storing a customer backup in a non-EU region permitted?', 'Is copying customer backups outside the European Union forbidden?'),
    ('guest', 'External guests may read the confidential contract folder.', 'External guests must not read the confidential contract folder.', 'May external guests read the confidential contract folder?', 'Are people invited from outside the organization allowed to view the private contract documents?', 'Is reading the confidential contract folder forbidden for external guests?'),
    ('release', 'A production release may be deployed without a human approving the change.', 'A production release must not be deployed without a human approving the change.', 'May a production release be deployed without a human approving the change?', 'Is an unattended deployment to production permitted without a person signing off?', 'Is deploying a production release without human approval forbidden?'),
    ('logging', 'Audit logging may be disabled while responding to a security incident.', 'Audit logging must not be disabled while responding to a security incident.', 'May audit logging be disabled while responding to a security incident?', 'Is turning off audit records permitted during security incident response?', 'Is disabling audit logging during a security incident forbidden?'),
]


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def main():
    if (ROOT / 'protocol.json').exists() or (ROOT / 'fixture.json').exists():
        raise SystemExit('Frozen files already exist; amendments must use new files, never overwrite.')
    families = []
    inputs = []
    cases = []
    for key, old, new, seed, paraphrase, negated in FAMILIES:
        denied = new + ' ' + seed
        memory_query = 'What is the current rule? ' + seed
        family = dict(id=key, oldPolicy=old, newPolicy=new, seedPrompt=seed, cachedAnswer='YES')
        families.append(family)
        inputs.extend([
            dict(id=key+':old-policy', role='document', text=old),
            dict(id=key+':new-policy', role='document', text=new),
            dict(id=key+':cached-prompt', role='document', text=seed),
            dict(id=key+':exact', role='query', text=seed),
            dict(id=key+':paraphrase', role='query', text=paraphrase),
            dict(id=key+':polarity', role='query', text=negated),
            dict(id=key+':denial', role='query', text=denied),
            dict(id=key+':memory-query', role='query', text=memory_query),
        ])
        for variant, query, revision, answer in [
            ('exact', 'exact', 'v1', 'YES'),
            ('paraphrase', 'paraphrase', 'v1', 'YES'),
            ('polarity', 'polarity', 'v1', 'NO'),
            ('denial', 'denial', 'v2', 'NO'),
            ('changed-version-same-question', 'exact', 'v2', 'NO'),
        ]:
            cases.append(dict(id=key+':'+variant, family=key, variant=variant, queryId=key+':'+query, trustedPolicyRevision=revision, expectedAnswer=answer))
    fixture = dict(schema='authored-context-cache-fixture/1', families=families, inputs=inputs, cases=cases)
    protocol = dict(
        schema='mongodb-ai-context-protocol/1', revision=1,
        frozenAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        fixtureSha256=hashlib.sha256(canonical(fixture)).hexdigest(),
        model=dict(id='MongoDB/voyage-4-nano-GGUF', revision='03547551689253732502486d62de4cd0970d6564', quantization='Q8_0', sha256='c6ed6cc898d50ae1a4492809affadc6c0d023f8ac05c07a37abe20c563152560'),
        embeddings=dict(rawDimensions=2048, retainedDimensions=512, normalization='Unicode NFC; first 512 coordinates then L2 normalization', documentPrefix='Represent the document for retrieval: ', queryPrefix='Represent the query for retrieving supporting documents: '),
        runtime='llama.cpp b11865, Darwin x86_64 CPU, authenticated UNIX socket; no paid inference',
        counts=dict(families=8, embeddingInputs=64, cacheCases=40, thresholds=3, cacheArms=2),
        thresholds=[0.8, 0.9, 0.95],
        cacheArms=['model-only', 'trusted-tenant-model-policy-corpus'],
        cacheCandidates='One independently scoped cached question and YES answer per family; no cross-family competition in the cache diagnostic.',
        scores='MongoDB cosine score is (1 + cosine)/2; report raw cosine separately. Threshold comparison uses MongoDB score.',
        hypotheses=[
            'Identical cached question with a changed trusted policy revision can reuse an obsolete answer under a model-only key.',
            'Trusted revision binding excludes changed-policy cache entries, while a polarity reversal within the same revision may still reuse an incompatible answer.',
            'Raising a fixed similarity threshold may reduce both incompatible reuse and valid paraphrase hits; select no winning threshold from this authored fixture.',
            'A memory correction must change the persisted embedding as well as direct and semantic value visibility; deletion must preserve the neighboring namespace.'
        ],
        cacheMeasures=['Hits and incompatible YES reuse by variant/arm/threshold', 'Valid exact/paraphrase hit retention; report all cases and scores, including misses'],
        adapterPlan=dict(engine='Official pinned MongoDBAtlasSemanticCache and MongoDBStore; PostgreSQL exact-vector control if available', repetitions=[251,252], memoryChecks='Capture persisted old/new embeddings and semantic values; require new embedding matches recorded replacement text, old state absent after visibility; delete tenant a, retain tenant b', isolation='Only labeled disposable resources; no host-bound database ports or cloud credentials'),
        interpretationLimits=['Researcher-authored, explicitly paired questions and labels; not a population false-hit rate or independent human benchmark.', 'No generative LLM answer or autonomous extraction is run; YES/NO answers are authored cache fixtures.', 'Context binding uses trusted application metadata; namespace/filter tests are not a production authorization audit.', 'Score analysis and context-key oracle alone do not establish adapter runtime behavior; record database stages as unrun until executed.', 'No production readiness, comparative performance, cost or platform-winner claim.'],
        sources=['https://langchain-mongodb.readthedocs.io/en/latest/_modules/langchain_mongodb/cache.html', 'https://langchain-mongodb.readthedocs.io/en/latest/langgraph_store_mongodb/base/langgraph.store.mongodb.base.MongoDBStore.html'],
    )
    for name, obj in [('fixture.json',fixture),('protocol.json',protocol)]:
        (ROOT / name).write_text(json.dumps(obj,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps({'status':'frozen','fixtureSha256':protocol['fixtureSha256'],'counts':protocol['counts']}))


if __name__ == '__main__':
    main()
