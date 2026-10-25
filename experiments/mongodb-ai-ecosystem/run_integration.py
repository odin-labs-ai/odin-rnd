"""Isolated local integration runner; no cloud services or host database ports."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import uuid

os.umask(0o077)
ROOT = Path(__file__).resolve().parent
RUN = uuid.uuid4().hex[:10]
OUT = ROOT / ('integration-' + RUN)
OUT.mkdir(mode=0o700)
LABEL = 'odin.mongo-ai-followon'
NETWORK = 'mai-' + RUN
NAMES = {k: 'mai-' + k + '-' + RUN for k in ['mongo', 'postgres', 'worker']}
PASSWORDS = {k: secrets.token_urlsafe(30) for k in ['mongo', 'postgres']}
owned = []
report = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'command': 'python run_integration.py', 'run': RUN, 'images': {}, 'sources': {}, 'cleanup': [], 'resources': {'mongoMemoryMiB': 1024, 'postgresMemoryMiB': 512, 'workerMemoryMiB': 768, 'cpusPerContainer': 2}, 'limitations': 'Unequal local resources; functional results only, no comparative performance/cost verdict.'}


def command(args, *, env=None, timeout=240):
    p = subprocess.run(args, env=env, text=True, capture_output=True, timeout=timeout)
    output = p.stdout + p.stderr
    for password in PASSWORDS.values():
        output = output.replace(password, '[REDACTED]')
    if p.returncode:
        raise RuntimeError(str(args[:3]) + ' exited ' + str(p.returncode) + ': ' + output[-5000:])
    return output


try:
    for name in ['database_trial.py', 'run_integration.py', 'fixture.json', 'protocol.json', 'model-result.json']:
        raw = (ROOT / name).read_bytes()
        (OUT / name).write_bytes(raw)
        report['sources'][name] = hashlib.sha256(raw).hexdigest()
    assert json.loads((OUT / 'model-result.json').read_text())['status'] == 'passed'
    command(['docker', 'network', 'create', '--internal', '--label', LABEL + '=' + RUN, NETWORK])
    for kind, tag, memory in [('mongo', 'mongodb/mongodb-atlas-local:preview', '1024m'), ('postgres', 'pgvector/pgvector:pg17', '512m'), ('worker', 'odin-mongo-ai-probe:20261024', '768m')]:
        image = json.loads(command(['docker', 'image', 'inspect', tag]))[0]
        report['images'][kind] = {'tag': tag, 'id': image['Id'], 'repoDigests': image.get('RepoDigests', [])}
        env = dict(os.environ)
        args = ['docker', 'run', '-d', '--name', NAMES[kind], '--network', 'container:' + NAMES['mongo'] if kind == 'worker' else NETWORK, '--cpus', '2', '--memory', memory, '--label', LABEL + '=' + RUN]
        if kind == 'mongo':
            env.update(MONGODB_INITDB_ROOT_USERNAME='probe', MONGODB_INITDB_ROOT_PASSWORD=PASSWORDS[kind], JAVA_TOOL_OPTIONS='-Xms128m -Xmx256m')
            for key in ['MONGODB_INITDB_ROOT_USERNAME', 'MONGODB_INITDB_ROOT_PASSWORD', 'JAVA_TOOL_OPTIONS']:
                args += ['-e', key]
        elif kind == 'postgres':
            env.update(POSTGRES_USER='probe', POSTGRES_PASSWORD=PASSWORDS[kind])
            args += ['-e', 'POSTGRES_USER', '-e', 'POSTGRES_PASSWORD']
        else:
            env.update(MONGO_URI='mongodb://probe:' + PASSWORDS['mongo'] + '@127.0.0.1:27017/?authSource=admin&directConnection=true', PG_URI='postgresql://probe:' + PASSWORDS['postgres'] + '@' + NAMES['postgres'] + ':5432/probe')
            args += ['-e', 'MONGO_URI', '-e', 'PG_URI', '-v', str(OUT) + ':/work:ro', '-v', str(OUT) + ':/out']
        args += [image['Id']]
        if kind == 'worker':
            args += ['sleep', '1800']
        command(args, env=env)
        owned.append(NAMES[kind])
    for _ in range(120):
        state = json.loads(command(['docker', 'inspect', '--format', '{{json .State}}', NAMES['mongo']]))
        if state.get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(2)
    else:
        raise RuntimeError('Atlas Local not healthy within 240 seconds')
    report['runtimeIsolation'] = {}
    for kind in NAMES:
        info = json.loads(command(['docker', 'inspect', NAMES[kind]]))[0]
        assert not info['HostConfig']['PortBindings']
        report['runtimeIsolation'][kind] = {'hostPortBindings': info['HostConfig']['PortBindings'], 'networkMode': info['HostConfig']['NetworkMode']}
    assert json.loads(command(['docker', 'network', 'inspect', NETWORK]))[0]['Internal']
    report['versions'] = {'mongo': command(['docker', 'exec', NAMES['mongo'], 'mongosh', '--quiet', '--eval', "db.getSiblingDB('admin').auth('probe',process.env.MONGODB_INITDB_ROOT_PASSWORD);print(db.version())"]).strip(), 'postgres': command(['docker', 'exec', NAMES['postgres'], 'psql', '-X', '-U', 'probe', '-Atc', 'SHOW server_version']).strip()}
    output = command(['docker', 'exec', NAMES['worker'], 'python', '/work/database_trial.py'], timeout=900)
    (OUT / 'integration-console.log').write_text(output)
    report['status'] = 'passed'
    print(output.strip(), flush=True)
except Exception as exc:
    report.update(status='failed', error=str(exc))
    print(str(exc), flush=True)
    for name in owned:
        try:
            (OUT / (name + '-state.json')).write_text(command(['docker', 'inspect', '--format', '{{json .State}}', name]))
            (OUT / (name + '-logs.txt')).write_text(command(['docker', 'logs', '--tail', '60', name]))
        except Exception:
            pass
finally:
    for name in reversed(owned):
        info = json.loads(command(['docker', 'inspect', name]))[0]
        assert info['Config']['Labels'][LABEL] == RUN
        command(['docker', 'rm', '-fv', name])
        remains = command(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']).strip()
        report['cleanup'].append({'container': name, 'removed': not remains})
    command(['docker', 'network', 'rm', NETWORK])
    report['networkRemoved'] = not command(['docker', 'network', 'ls', '--filter', 'name=^' + NETWORK + '$', '--format', '{{.Name}}']).strip()
    report['endedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (OUT / 'runtime-receipt.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'latest-integration.json').write_text(json.dumps({'path': OUT.name, 'status': report['status']}, indent=2) + '\n')
assert report['status'] == 'passed' and report['networkRemoved'] and all(x['removed'] for x in report['cleanup'])
print(json.dumps({'run': RUN, 'status': report['status'], 'cleaned': True}))
