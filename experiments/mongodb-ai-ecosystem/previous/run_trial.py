"""Bounded private, internal-network local integration experiment. No host DB ports."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import uuid

os.umask(0o077)
HERE = Path(__file__).resolve().parent
RUN = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:6]
OUT = HERE / ('run-' + RUN)
OUT.mkdir(mode=0o700)
LABEL = 'odin.mongo-ai-experiment'
NAMES = {kind: 'mongo-ai-' + kind + '-' + RUN.lower() for kind in ['mongo', 'postgres', 'worker']}
NETWORK = 'mongo-ai-' + RUN.lower()
PASSWORDS = {kind: secrets.token_urlsafe(30) for kind in ['mongo', 'postgres']}
OWNED = []
report = {'run': RUN, 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': 'python run_trial.py', 'visibility': 'private', 'productionOrHostedCalls': False, 'cleanup': [], 'phases': []}


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, default=str) + '\n')


def cmd(args, *, env=None, stdin=None, timeout=300, expect=0):
    p = subprocess.run(args, input=stdin, text=True, capture_output=True, env=env, timeout=timeout)
    output = p.stdout + p.stderr
    for secret in PASSWORDS.values():
        output = output.replace(secret, '[REDACTED]')
    if p.returncode != expect:
        raise RuntimeError(f'{args[0]} returned {p.returncode}, expected {expect}: {output[-4000:]}')
    return output


def ready(fn, timeout=180):
    start = time.monotonic()
    last = None
    while time.monotonic() - start < timeout:
        try:
            return fn()
        except RuntimeError as exc:
            last = str(exc)
        time.sleep(2)
    raise RuntimeError('readiness timeout: ' + str(last))


def phase(engine, stage, seed='841', tenant='a', expect=0):
    key = f'{engine}-{seed}-{tenant}-{stage}'
    output = cmd(['docker', 'exec', NAMES['worker'], 'python', '/work/workflow_trial.py', engine, stage, seed, tenant], expect=expect)
    (OUT / (key + '.log')).write_text(output)
    report['phases'].append({'engine': engine, 'phase': stage, 'seed': seed, 'tenant': tenant, 'exit': expect})
    save('progress.json', report)
    print(key + (' expected process exit observed' if expect else ' passed'), flush=True)


try:
    # Images already on this machine; resolve mutable names to actual local image IDs.
    images = {}
    for kind, tag in [('mongo', 'mongodb/mongodb-atlas-local:preview'), ('postgres', 'pgvector/pgvector:pg17'), ('worker', 'odin-mongo-ai-probe:20261024')]:
        data = json.loads(cmd(['docker', 'image', 'inspect', tag]))[0]
        images[kind] = {'tag': tag, 'id': data['Id'], 'repoDigests': data.get('RepoDigests', [])}
    report['images'] = images
    report['protocol'] = {'revision': 2, 'fixtureRepetitions': [841, 842], 'repetitionNote': 'The seed field is a namespace label, not a random corpus seed; fixture content is unchanged.', 'tenants': ['a', 'b'], 'workflow': 'prepare checkpoint -> new process -> tool ledger write -> os._exit(73) before checkpoint -> new process -> resume', 'matchedControl': 'same LangGraph state graph and official MongoDB/PostgreSQL saver/store adapters', 'gates': ['pending tool survives worker exit', 'one idempotent ledger effect despite two attempts', 'tenant-specific preference survives new process', 'memory update/delete preserves neighbor', 'shared-ID negative controls reproduce missing intrinsic tenancy', 'exact and semantic cache negative controls reproduce shared private answer; scoped alternatives pass', 'actual vector/hybrid/semantic Store integrations return fixture-correct tenant'], 'vectors': 'deterministic four-dimensional keyword fixtures; not semantic relevance', 'spend': 'no LLM/embedding API calls; no cloud provisioning', 'resources': {'mongo': {'cpus': 2, 'memoryMiB': 1024}, 'postgres': {'cpus': 2, 'memoryMiB': 512}, 'worker': {'cpus': 2, 'memoryMiB': 768}}, 'limits': ['functional comparison only; resources differ, no speed/cost winner', 'synthetic identities and privileged disposable DB users; no production authorization proof', 'simulated idempotent ledger effect; arbitrary tools are not made exactly-once', 'no model inference or extraction pipeline', 'single-node local development images; no HA, PITR or platform deployment claim']}
    report['sourceHashes'] = {}
    for name in ['workflow_trial.py', 'retrieval_trial.py', 'run_trial.py', 'requirements.lock', 'Dockerfile']:
        raw = (HERE / name).read_bytes()
        report['sourceHashes'][name] = hashlib.sha256(raw).hexdigest()
        (OUT / name).write_bytes(raw)
    save('protocol.json', report)
    report['priorProbeContainersAtStart'] = cmd(['docker', 'ps', '-a', '--filter', 'label=odin.platform-capability-probe', '--format', '{{.Names}}']).splitlines()
    cmd(['docker', 'network', 'create', '--internal', '--label', LABEL + '=' + RUN, NETWORK])
    for kind, memory in [('mongo', '1024m'), ('postgres', '512m')]:
        env = dict(os.environ)
        args = ['docker', 'run', '-d', '--name', NAMES[kind], '--hostname', NAMES[kind], '--network', NETWORK, '--cpus', '2', '--memory', memory, '--label', LABEL + '=' + RUN]
        if kind == 'mongo':
            env.update(MONGODB_INITDB_ROOT_USERNAME='probe', MONGODB_INITDB_ROOT_PASSWORD=PASSWORDS[kind], JAVA_TOOL_OPTIONS='-Xms128m -Xmx256m')
            for key in ['MONGODB_INITDB_ROOT_USERNAME', 'MONGODB_INITDB_ROOT_PASSWORD', 'JAVA_TOOL_OPTIONS']:
                args += ['-e', key]
        else:
            env.update(POSTGRES_USER='probe', POSTGRES_PASSWORD=PASSWORDS[kind])
            args += ['-e', 'POSTGRES_USER', '-e', 'POSTGRES_PASSWORD']
        cmd(args + [images[kind]['id']], env=env)
        OWNED.append(NAMES[kind])
    def mongo_healthy():
        state = json.loads(cmd(['docker', 'inspect', '--format', '{{json .State}}', NAMES['mongo']]))
        if state.get('Health', {}).get('Status') != 'healthy':
            raise RuntimeError('Atlas Local startup health: ' + state.get('Health', {}).get('Status', 'missing'))
        return True
    ready(mongo_healthy, timeout=240)
    ready(lambda: cmd(['docker', 'exec', NAMES['mongo'], 'mongosh', '--quiet', '--eval', "db.getSiblingDB('admin').auth('probe',process.env.MONGODB_INITDB_ROOT_PASSWORD);if(db.adminCommand({ping:1}).ok!==1)quit(2)"]))
    ready(lambda: cmd(['docker', 'exec', NAMES['postgres'], 'psql', '-X', '-U', 'probe', '-Atc', 'SELECT 1']))
    env = dict(os.environ)
    # Atlas Local binds mongod to loopback. Share its isolated network namespace
    # rather than widening its listener or publishing a host database port.
    env.update(MONGO_URI='mongodb://probe:' + PASSWORDS['mongo'] + '@127.0.0.1:27017/?authSource=admin&directConnection=true', PG_URI='postgresql://probe:' + PASSWORDS['postgres'] + '@' + NAMES['postgres'] + ':5432/probe', TRIAL_OUTPUT='/out')
    cmd(['docker', 'run', '-d', '--name', NAMES['worker'], '--network', 'container:' + NAMES['mongo'], '--cpus', '2', '--memory', '768m', '--label', LABEL + '=' + RUN, '-e', 'MONGO_URI', '-e', 'PG_URI', '-e', 'TRIAL_OUTPUT', '-v', str(OUT) + ':/work:ro', '-v', str(OUT) + ':/out', images['worker']['id'], 'sleep', '2400'], env=env)
    OWNED.append(NAMES['worker'])
    report['runtimeIsolation'] = {}
    for kind in ['mongo', 'postgres', 'worker']:
        d = json.loads(cmd(['docker', 'inspect', NAMES[kind]]))[0]
        assert not d['HostConfig']['PortBindings']
        report['runtimeIsolation'][kind] = {'hostPortBindings': d['HostConfig']['PortBindings'], 'networkMode': d['HostConfig']['NetworkMode'], 'image': d['Image']}
    assert json.loads(cmd(['docker', 'network', 'inspect', NETWORK]))[0]['Internal']
    report['versions'] = {
        'mongo': cmd(['docker', 'exec', NAMES['mongo'], 'mongosh', '--quiet', '--eval', "db.getSiblingDB('admin').auth('probe',process.env.MONGODB_INITDB_ROOT_PASSWORD);print(db.version())"]).strip(),
        'postgres': cmd(['docker', 'exec', NAMES['postgres'], 'psql', '-X', '-U', 'probe', '-Atc', 'SHOW server_version']).strip(),
        'pythonPackages': json.loads(cmd(['docker', 'exec', NAMES['worker'], 'python', '-m', 'pip', 'list', '--format=json']))}
    for seed in ['841', '842']:
        for engine in (['mongo', 'postgres'] if seed == '841' else ['postgres', 'mongo']):
            phase(engine, 'bootstrap', seed)
            for tenant in ['a', 'b']:
                phase(engine, 'prepare', seed, tenant)
                phase(engine, 'crash', seed, tenant, expect=73)
                phase(engine, 'resume', seed, tenant)
            phase(engine, 'memory', seed)
    output = cmd(['docker', 'exec', NAMES['worker'], 'python', '/work/retrieval_trial.py'], timeout=900)
    (OUT / 'retrieval-cache.log').write_text(output)
    print(output.strip(), flush=True)
    report['outcome'] = 'functional-ecosystem-trial-passed; no model-quality or platform-winner verdict'
except Exception as exc:
    report['outcome'] = 'failed'
    report['error'] = str(exc)
    print('Trial failed: ' + str(exc), flush=True)
    for name in OWNED:
        try:
            save(name + '-state.json', json.loads(cmd(['docker', 'inspect', '--format', '{{json .State}}', name])))
            (OUT / (name + '-logs.txt')).write_text(cmd(['docker', 'logs', '--tail', '100', name]))
        except Exception as diagnostic_error:
            report.setdefault('diagnosticErrors', []).append(str(diagnostic_error))
finally:
    for name in reversed(OWNED):
        try:
            # Remove only this run's label-verified containers and anonymous fixture volumes.
            info = json.loads(cmd(['docker', 'inspect', name]))[0]
            assert info['Config']['Labels'].get(LABEL) == RUN
            cmd(['docker', 'rm', '-fv', name])
            remaining = cmd(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']).strip()
            report['cleanup'].append({'container': name, 'removed': not remaining})
        except Exception as exc:
            report['cleanup'].append({'container': name, 'removed': False, 'error': str(exc)})
    try:
        cmd(['docker', 'network', 'rm', NETWORK])
        report['networkRemoved'] = not cmd(['docker', 'network', 'ls', '--filter', 'name=^' + NETWORK + '$', '--format', '{{.Name}}']).strip()
    except Exception as exc:
        report['networkRemoved'] = False
        report['networkCleanupError'] = str(exc)
    report['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('result.json', report)
    (HERE / 'latest-run.json').write_text(json.dumps({'run': RUN, 'path': OUT.name, 'outcome': report['outcome']}, indent=2) + '\n')
print(json.dumps({'run': RUN, 'outcome': report['outcome'], 'cleanup': report['cleanup']}))
sys.exit(0 if report['outcome'].startswith('functional') and report.get('networkRemoved') and all(r['removed'] for r in report['cleanup']) else 1)
