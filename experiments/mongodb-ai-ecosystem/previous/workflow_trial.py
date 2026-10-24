"""Actual LangGraph adapters, separate processes, synthetic effects; no LLM calls."""
import contextlib
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import sys
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.mongodb import MongoDBSaver
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.store.mongodb import MongoDBStore
from langgraph.store.postgres import PostgresStore
from pymongo import MongoClient
import psycopg
from psycopg.rows import dict_row

os.umask(0o077)
ENGINE, PHASE, SEED, TENANT = sys.argv[1:5]
OUT = Path(os.environ['TRIAL_OUTPUT'])
PREFIX = ('seed', SEED, 'tenant')


class State(TypedDict, total=False):
    tenant: str
    task: str
    prepared: bool
    preference: str
    effect: str
    answer: str


def thread(tenant, task='approval'):
    # Trusted fixture identity, never a model/user-supplied thread name.
    return json.dumps([SEED, tenant, task], separators=(',', ':'))


def config(tenant):
    return {'configurable': {'thread_id': thread(tenant)}}


@contextlib.contextmanager
def backend():
    with contextlib.ExitStack() as stack:
        if ENGINE == 'mongo':
            client = stack.enter_context(MongoClient(os.environ['MONGO_URI'], serverSelectionTimeoutMS=10000))
            db = client.ai_probe
            saver = MongoDBSaver(client, db_name='ai_probe')
            store = MongoDBStore(db.memories)

            def effect(key, tenant):
                db.effects.update_one({'_id': key}, {'$setOnInsert': {'tenant': tenant, 'effect': 'recorded'}, '$inc': {'attempts': 1}}, upsert=True)

            def effects():
                return list(db.effects.find({'_id': {'$regex': '^' + SEED + ':'}}, {'_id': 1, 'tenant': 1, 'effect': 1, 'attempts': 1}).sort('_id', 1))
        else:
            conn = stack.enter_context(psycopg.connect(os.environ['PG_URI'], autocommit=True, row_factory=dict_row))
            saver = PostgresSaver(conn)
            store = PostgresStore(conn)
            if PHASE == 'bootstrap':
                saver.setup()
                store.setup()
                conn.execute('CREATE TABLE IF NOT EXISTS trial_effects(id text PRIMARY KEY, tenant text NOT NULL, effect text NOT NULL, attempts int NOT NULL)')

            def effect(key, tenant):
                conn.execute("INSERT INTO trial_effects VALUES (%s,%s,'recorded',1) ON CONFLICT(id) DO UPDATE SET attempts=trial_effects.attempts+1", (key, tenant))

            def effects():
                return [dict(r) for r in conn.execute('SELECT id AS _id,tenant,effect,attempts FROM trial_effects WHERE id LIKE %s ORDER BY id', (SEED + ':%',)).fetchall()]
        yield saver, store, effect, effects


def make_graph(saver, store, effect, *, pause=False):
    def prepare(state):
        memory = store.get((*PREFIX, state['tenant'], 'preferences'), 'policy')
        assert memory and memory.value['tenant'] == state['tenant']
        return {'prepared': True, 'preference': memory.value['policy']}

    def tool_effect(state):
        key = SEED + ':' + state['tenant'] + ':' + state['task']
        effect(key, state['tenant'])
        if PHASE == 'crash':
            # Exit after durable simulated tool effect, before this node checkpoints.
            print(json.dumps({'phase': PHASE, 'effectAcknowledged': True, 'exitCode': 73}), flush=True)
            os._exit(73)
        return {'effect': 'recorded'}

    graph = StateGraph(State)
    graph.add_node('prepare', prepare)
    graph.add_node('tool', tool_effect)
    graph.add_node('finish', lambda state: {'answer': state['tenant'] + ':' + state['preference']})
    graph.add_edge(START, 'prepare')
    graph.add_edge('prepare', 'tool')
    graph.add_edge('tool', 'finish')
    graph.add_edge('finish', END)
    return graph.compile(checkpointer=saver, store=store, interrupt_after=['prepare'] if pause else [])


with backend() as (saver, store, effect, effects):
    receipt = {'engine': ENGINE, 'phase': PHASE, 'seed': SEED, 'tenant': TENANT, 'pid': os.getpid()}
    if PHASE == 'bootstrap':
        for tenant in ['a', 'b']:
            store.put((*PREFIX, tenant, 'preferences'), 'policy', {'tenant': tenant, 'policy': 'policy-' + tenant})
        # Negative controls: shared identifiers do not authenticate callers.
        store.put(('seed', SEED, 'shared'), 'private', {'tenant': 'a', 'value': 'A-only fixture'})
        shared = store.get(('seed', SEED, 'shared'), 'private')
        assert shared.value['tenant'] == 'a'
        collision = StateGraph(State)
        collision.add_node('identity', lambda state: state)
        collision.add_edge(START, 'identity')
        collision.add_edge('identity', END)
        graph = collision.compile(checkpointer=saver)
        same = {'configurable': {'thread_id': json.dumps([SEED, 'unscoped'])}}
        graph.invoke({'tenant': 'a', 'answer': 'A-only fixture'}, same)
        shared_state = graph.get_state(same).values
        assert shared_state['tenant'] == 'a'
        receipt.update(negativeControls={'unscopedMemoryReadable': shared.value, 'unscopedThreadReadable': shared_state},
                       scopedPreferences={t: store.get((*PREFIX, t, 'preferences'), 'policy').value for t in ['a', 'b']})
    elif PHASE in ['prepare', 'crash', 'resume']:
        graph = make_graph(saver, store, effect, pause=PHASE == 'prepare')
        before = graph.get_state(config(TENANT))
        receipt['before'] = {'values': before.values, 'next': list(before.next)}
        if PHASE == 'prepare':
            graph.invoke({'tenant': TENANT, 'task': 'approval'}, config(TENANT))
        else:
            assert before.next == ('tool',)
            assert 'effect' not in before.values
            graph.invoke(None, config(TENANT))
        after = graph.get_state(config(TENANT))
        receipt['after'] = {'values': after.values, 'next': list(after.next)}
        receipt['effects'] = effects()
        if PHASE == 'prepare':
            assert after.next == ('tool',)
            assert 'effect' not in after.values
        else:
            assert not after.next
            assert after.values['answer'] == TENANT + ':policy-' + TENANT
            own = [r for r in effects() if r['tenant'] == TENANT]
            assert len(own) == 1 and own[0]['attempts'] == 2
            receipt['historyLength'] = len(list(graph.get_state_history(config(TENANT))))
    elif PHASE == 'memory':
        a = (*PREFIX, 'a', 'preferences')
        b = (*PREFIX, 'b', 'preferences')
        neighbor = store.get(b, 'policy').value
        assert store.get(a, 'policy').value == {'tenant': 'a', 'policy': 'policy-a'}
        store.put(a, 'policy', {'tenant': 'a', 'policy': 'updated'})
        scoped = store.search((*PREFIX, 'a'), filter={'tenant': 'a'})
        assert len(scoped) == 1 and scoped[0].value['policy'] == 'updated'
        store.delete(a, 'policy')
        assert store.get(a, 'policy') is None
        assert store.get(b, 'policy').value == neighbor
        receipt.update(updatedSearch=[r.value for r in scoped], deletedTenantA=True, neighbor=neighbor, effects=effects())
    else:
        raise ValueError(PHASE)
    (OUT / f'{ENGINE}-{SEED}-{TENANT}-{PHASE}.json').write_text(json.dumps(receipt, indent=2, default=str) + '\n')
    print(json.dumps({'engine': ENGINE, 'phase': PHASE, 'seed': SEED, 'tenant': TENANT, 'status': 'passed'}))
